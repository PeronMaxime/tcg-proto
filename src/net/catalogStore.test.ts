import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CATALOG } from '../game/defaultCatalog';
import type { Catalog } from '../game/types';

// Ces tests portent sur le magasin LOCAL : ils couvrent la sérialisation, la validation à la
// relecture et la garde anti-écrasement, qui sont écrites une fois pour les deux
// implémentations.
//
// Vitest charge `.env.local` comme Vite : sans la neutralisation ci-dessous, `hasFirebaseConfig`
// serait vrai et la suite écrirait dans le VRAI projet Firestore. `VITE_FIREBASE_PROJECT_ID`
// est donc vidée, et les modules rechargés, avant chaque test.

// `catalogStore` lit `localStorage` et `window` au chargement du module : on les installe
// avant l'import dynamique. `vi.resetModules` recharge aussi `defaultCatalog`, si bien que le
// `DEFAULT_CATALOG` importé ici n'est PAS le même objet que celui du module testé : les
// comparaisons portent donc sur la valeur (`toStrictEqual`), pas sur l'identité.
class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  clear(): void {
    this.data.clear();
  }
}

const storage = new MemoryStorage();

beforeEach(() => {
  vi.stubEnv('VITE_FIREBASE_PROJECT_ID', '');
  vi.resetModules();
  storage.clear();
  Object.assign(globalThis, {
    localStorage: storage,
    window: { addEventListener: () => {}, removeEventListener: () => {} },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  storage.clear();
});

async function store() {
  return import('./catalogStore');
}

describe('catalogStore (mode local)', () => {
  it('rend null tant que rien n’a été enregistré', async () => {
    const { catalogStore } = await store();
    await expect(catalogStore.load()).resolves.toBeNull();
  });

  it('loadPlayableCatalog retombe sur le catalogue livré quand rien n’est enregistré', async () => {
    const { loadPlayableCatalog } = await store();
    await expect(loadPlayableCatalog()).resolves.toStrictEqual(DEFAULT_CATALOG);
  });

  it('l’import initial écrit les cartes livrées et incrémente la version', async () => {
    const { seedCatalogFromDefaults, catalogStore } = await store();
    const seeded = await seedCatalogFromDefaults();
    expect(seeded.version).toBeGreaterThan(DEFAULT_CATALOG.version);
    expect(seeded.cards).toHaveLength(DEFAULT_CATALOG.cards.length);

    const reloaded = await catalogStore.load();
    expect(reloaded?.cards.map((c) => c.id)).toEqual(DEFAULT_CATALOG.cards.map((c) => c.id));
  });

  it('refuse d’écraser une version plus récente écrite ailleurs', async () => {
    const { catalogStore, CatalogError } = await store();
    const saved = await catalogStore.save(DEFAULT_CATALOG);
    // Un autre onglet enregistre après nous : notre brouillon est devenu périmé.
    await catalogStore.save(saved);
    await expect(catalogStore.save(saved)).rejects.toBeInstanceOf(CatalogError);
  });

  it('refuse de relire un catalogue corrompu plutôt que de le servir au plateau', async () => {
    const { catalogStore, CatalogError } = await store();
    await catalogStore.save(DEFAULT_CATALOG);
    storage.setItem('tcg-catalog', JSON.stringify({ version: 2, cards: [{ kind: 'dragon' }], starterCounts: {} }));
    await expect(catalogStore.load()).rejects.toBeInstanceOf(CatalogError);
  });

  it('loadPlayableCatalog ne laisse jamais un catalogue corrompu empêcher de jouer', async () => {
    const { loadPlayableCatalog } = await store();
    storage.setItem('tcg-catalog', '{"version":1}');
    await expect(loadPlayableCatalog()).resolves.toStrictEqual(DEFAULT_CATALOG);
  });

  it('conserve une carte modifiée à l’identique après un aller-retour', async () => {
    const { catalogStore } = await store();
    const edited: Catalog = {
      ...DEFAULT_CATALOG,
      cards: DEFAULT_CATALOG.cards.map((card) =>
        card.id === 'squire' ? { ...card, name: 'Écuyère', cost: 5 } : card,
      ),
    };
    await catalogStore.save(edited);
    const reloaded = await catalogStore.load();
    const squire = reloaded?.cards.find((card) => card.id === 'squire');
    expect(squire?.name).toBe('Écuyère');
    expect(squire?.cost).toBe(5);
  });
});
