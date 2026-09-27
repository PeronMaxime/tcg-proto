import { doc, getDoc, onSnapshot, runTransaction } from 'firebase/firestore';
import { parseCatalog } from '../game/catalogSchema';
import { DEFAULT_CATALOG } from '../game/defaultCatalog';
import type { Catalog } from '../game/types';
import { DEFAULT_GAME_VERSION, GAME_VERSION_LABELS, type GameVersion } from '../game/versions';
import { getDb, hasFirebaseConfig } from './firebase';

// Stockage du catalogue de cartes, édité depuis le panneau d'administration et lu par tous
// les joueurs. Même bascule que `roomStore` : Firestore si la configuration est présente,
// sinon localStorage, pour que le mode local du README continue de marcher sans compte.
//
// Un document par version du jeu (`game/versions.ts`) plutôt qu'un document par carte : la
// lecture est atomique (jamais un demi-catalogue), l'écriture tient en une opération, et c'est
// exactement l'objet recopié dans chaque `Room`.
//
// La V1 garde les emplacements d'avant les versions (`catalog/current`, `tcg-catalog`) : le
// catalogue déjà enregistré devient la V1 sans migration. Les suivantes prennent le nom de leur
// version (`catalog/v2`, `tcg-catalog-v2`), couvertes par la même règle `firestore.rules`.

function docPath(version: GameVersion): [string, string] {
  return ['catalog', version === 'v1' ? 'current' : version];
}

function localKey(version: GameVersion): string {
  return version === 'v1' ? 'tcg-catalog' : `tcg-catalog-${version}`;
}

// Catalogue absent du stockage : l'admin proposera de l'amorcer avec `DEFAULT_CATALOG`. On
// distingue « pas encore enregistré » de « enregistré mais illisible », qui est une erreur.
export class CatalogError extends Error {}

// Chaque opération porte sur le catalogue d'UNE version du jeu, indépendant des autres.
export interface CatalogStore {
  // `null` = aucun catalogue enregistré (la V1 retombe alors sur `DEFAULT_CATALOG`).
  load(version: GameVersion): Promise<Catalog | null>;
  // Écrit `catalog` en refusant d'écraser une version strictement plus récente (deux onglets
  // d'admin ouverts). Rend le catalogue tel qu'il a été écrit, `version` incrémentée.
  save(version: GameVersion, catalog: Catalog): Promise<Catalog>;
  subscribe(version: GameVersion, cb: (catalog: Catalog | null) => void): () => void;
  readonly isLocal: boolean;
}

// Les données lues sont NON FIABLES (document public, écrit par une autre version du code) :
// une carte malformée ferait planter le rendu du plateau. On valide systématiquement.
function decode(raw: unknown, source: string): Catalog {
  const parsed = parseCatalog(raw);
  if (!parsed.ok) {
    throw new CatalogError(
      `Catalogue illisible (${source}) :\n${parsed.errors.slice(0, 5).join('\n')}`,
    );
  }
  return parsed.value;
}

function bumped(catalog: Catalog, previousVersion: number): Catalog {
  return { ...catalog, version: Math.max(catalog.version, previousVersion) + 1 };
}

const firebaseCatalogStore: CatalogStore = {
  isLocal: false,

  async load(version) {
    const snap = await getDoc(doc(getDb(), ...docPath(version)));
    return snap.exists() ? decode(snap.data(), 'Firestore') : null;
  },

  async save(version, catalog) {
    return runTransaction(getDb(), async (tx) => {
      const ref = doc(getDb(), ...docPath(version));
      const snap = await tx.get(ref);
      const currentVersion = snap.exists() ? Number((snap.data() as Catalog).version) || 0 : 0;
      if (currentVersion > catalog.version) {
        throw new CatalogError(
          'Le catalogue a été modifié ailleurs entre-temps. Recharge la page pour repartir de la dernière version.',
        );
      }
      const next = bumped(catalog, currentVersion);
      tx.set(ref, next);
      return next;
    });
  },

  subscribe(version, cb) {
    return onSnapshot(doc(getDb(), ...docPath(version)), (snap) => {
      cb(snap.exists() ? decode(snap.data(), 'Firestore') : null);
    });
  },
};

type Listener = (catalog: Catalog | null) => void;
const localListeners = new Map<GameVersion, Set<Listener>>();

function readLocal(version: GameVersion): Catalog | null {
  const raw = localStorage.getItem(localKey(version));
  return raw === null ? null : decode(JSON.parse(raw), 'localStorage');
}

const localCatalogStore: CatalogStore = {
  isLocal: true,

  async load(version) {
    return readLocal(version);
  },

  async save(version, catalog) {
    const current = localStorage.getItem(localKey(version));
    const currentVersion = current ? (Number((JSON.parse(current) as Catalog).version) || 0) : 0;
    if (currentVersion > catalog.version) {
      throw new CatalogError(
        'Le catalogue a été modifié dans un autre onglet. Recharge la page pour repartir de la dernière version.',
      );
    }
    const next = bumped(catalog, currentVersion);
    localStorage.setItem(localKey(version), JSON.stringify(next));
    // L'évènement `storage` ne se déclenche que dans les AUTRES onglets, jamais dans celui
    // qui écrit : on prévient les abonnés de cet onglet à la main (comme `localStore`).
    for (const cb of localListeners.get(version) ?? []) cb(next);
    return next;
  },

  subscribe(version, cb) {
    let listeners = localListeners.get(version);
    if (!listeners) {
      listeners = new Set();
      localListeners.set(version, listeners);
    }
    listeners.add(cb);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== localKey(version)) return;
      cb(e.newValue === null ? null : decode(JSON.parse(e.newValue), 'localStorage'));
    };
    window.addEventListener('storage', onStorage);
    cb(readLocal(version));
    return () => {
      listeners.delete(cb);
      window.removeEventListener('storage', onStorage);
    };
  },
};

export const catalogStore: CatalogStore = hasFirebaseConfig
  ? firebaseCatalogStore
  : localCatalogStore;

// Catalogue à utiliser pour une nouvelle partie de la version `version`.
//
// V1 : celui du stockage partagé, ou le catalogue livré avec le code tant que rien n'a été
// enregistré depuis l'admin. Ne lève jamais : une panne réseau ou un document corrompu ne doit
// pas empêcher de jouer, on retombe sur `DEFAULT_CATALOG` en journalisant la cause.
//
// Versions suivantes : `DEFAULT_CATALOG` contient des cartes V1, s'en servir comme repli ferait
// jouer une « V2 » avec les cartes de la V1 sans que personne ne s'en aperçoive. On lève donc
// une `CatalogError` si leur catalogue est absent ou illisible.
export async function loadPlayableCatalog(version: GameVersion = DEFAULT_GAME_VERSION): Promise<Catalog> {
  if (version !== 'v1') {
    const catalog = await catalogStore.load(version);
    if (!catalog) {
      throw new CatalogError(
        `La ${GAME_VERSION_LABELS[version]} n’a pas encore de cartes : crée-les depuis l’administration.`,
      );
    }
    return catalog;
  }
  try {
    return (await catalogStore.load(version)) ?? DEFAULT_CATALOG;
  } catch (e) {
    console.warn('Catalogue partagé inutilisable, repli sur le catalogue livré.', e);
    return DEFAULT_CATALOG;
  }
}

// Amorçage du catalogue d'une version, appelé uniquement sur action explicite dans l'admin,
// jamais automatiquement. La V1 part des cartes livrées avec le jeu ; une version suivante part
// d'une COPIE de la V1 telle qu'elle est enregistrée (un catalogue vide n'est pas valide, et
// on refait plus vite des cartes en modifiant les anciennes). La V1 n'est pas modifiée.
export async function seedCatalog(version: GameVersion): Promise<Catalog> {
  const source = version === 'v1' ? DEFAULT_CATALOG : ((await catalogStore.load('v1')) ?? DEFAULT_CATALOG);
  return catalogStore.save(version, source);
}
