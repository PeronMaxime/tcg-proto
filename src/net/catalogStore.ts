import { doc, getDoc, onSnapshot, runTransaction } from 'firebase/firestore';
import { parseCatalog } from '../game/catalogSchema';
import { DEFAULT_CATALOG } from '../game/defaultCatalog';
import type { Catalog } from '../game/types';
import { getDb, hasFirebaseConfig } from './firebase';

// Stockage du catalogue de cartes, édité depuis le panneau d'administration et lu par tous
// les joueurs. Même bascule que `roomStore` : Firestore si la configuration est présente,
// sinon localStorage, pour que le mode local du README continue de marcher sans compte.
//
// Un document UNIQUE (`catalog/current`) plutôt qu'un document par carte : la lecture est
// atomique (jamais un demi-catalogue), l'écriture tient en une opération, et c'est exactement
// l'objet recopié dans chaque `Room`.

const DOC_PATH = ['catalog', 'current'] as const;
const LOCAL_KEY = 'tcg-catalog';

// Catalogue absent du stockage : l'admin proposera de l'amorcer avec `DEFAULT_CATALOG`. On
// distingue « pas encore enregistré » de « enregistré mais illisible », qui est une erreur.
export class CatalogError extends Error {}

export interface CatalogStore {
  // `null` = aucun catalogue enregistré (le jeu retombe alors sur `DEFAULT_CATALOG`).
  load(): Promise<Catalog | null>;
  // Écrit `catalog` en refusant d'écraser une version strictement plus récente (deux onglets
  // d'admin ouverts). Rend le catalogue tel qu'il a été écrit, `version` incrémentée.
  save(catalog: Catalog): Promise<Catalog>;
  subscribe(cb: (catalog: Catalog | null) => void): () => void;
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

  async load() {
    const snap = await getDoc(doc(getDb(), ...DOC_PATH));
    return snap.exists() ? decode(snap.data(), 'Firestore') : null;
  },

  async save(catalog) {
    return runTransaction(getDb(), async (tx) => {
      const ref = doc(getDb(), ...DOC_PATH);
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

  subscribe(cb) {
    return onSnapshot(doc(getDb(), ...DOC_PATH), (snap) => {
      cb(snap.exists() ? decode(snap.data(), 'Firestore') : null);
    });
  },
};

type Listener = (catalog: Catalog | null) => void;
const localListeners = new Set<Listener>();

function readLocal(): Catalog | null {
  const raw = localStorage.getItem(LOCAL_KEY);
  return raw === null ? null : decode(JSON.parse(raw), 'localStorage');
}

const localCatalogStore: CatalogStore = {
  isLocal: true,

  async load() {
    return readLocal();
  },

  async save(catalog) {
    const current = localStorage.getItem(LOCAL_KEY);
    const currentVersion = current ? (Number((JSON.parse(current) as Catalog).version) || 0) : 0;
    if (currentVersion > catalog.version) {
      throw new CatalogError(
        'Le catalogue a été modifié dans un autre onglet. Recharge la page pour repartir de la dernière version.',
      );
    }
    const next = bumped(catalog, currentVersion);
    localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
    // L'évènement `storage` ne se déclenche que dans les AUTRES onglets, jamais dans celui
    // qui écrit : on prévient les abonnés de cet onglet à la main (comme `localStore`).
    for (const cb of localListeners) cb(next);
    return next;
  },

  subscribe(cb) {
    localListeners.add(cb);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== LOCAL_KEY) return;
      cb(e.newValue === null ? null : decode(JSON.parse(e.newValue), 'localStorage'));
    };
    window.addEventListener('storage', onStorage);
    cb(readLocal());
    return () => {
      localListeners.delete(cb);
      window.removeEventListener('storage', onStorage);
    };
  },
};

export const catalogStore: CatalogStore = hasFirebaseConfig
  ? firebaseCatalogStore
  : localCatalogStore;

// Catalogue à utiliser pour une nouvelle partie : celui du stockage partagé, ou le catalogue
// livré avec le code tant que rien n'a été enregistré depuis l'admin. Ne lève jamais : une
// panne réseau ou un document corrompu ne doit pas empêcher de jouer, on retombe sur
// `DEFAULT_CATALOG` en journalisant la cause.
export async function loadPlayableCatalog(): Promise<Catalog> {
  try {
    return (await catalogStore.load()) ?? DEFAULT_CATALOG;
  } catch (e) {
    console.warn('Catalogue partagé inutilisable, repli sur le catalogue livré.', e);
    return DEFAULT_CATALOG;
  }
}

// Amorçage de la migration : écrit les cartes livrées avec le jeu comme premier catalogue
// partagé. Appelé uniquement sur action explicite dans l'admin, jamais automatiquement.
export async function seedCatalogFromDefaults(): Promise<Catalog> {
  return catalogStore.save(DEFAULT_CATALOG);
}
