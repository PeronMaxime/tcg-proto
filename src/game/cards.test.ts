import { afterEach, describe, expect, it } from 'vitest';
import {
  buildStarterDeck,
  findCardDef,
  getActiveCatalog,
  getCardDef,
  setActiveCatalog,
} from './cards';
import { DEFAULT_CATALOG } from './defaultCatalog';
import { createInitialState } from './rules';
import type { Catalog } from './types';

// Le catalogue n'est plus codé en dur : il est installé par la couche réseau avant la création
// d'une partie, puis figé dans la room. Ces tests vérifient que le basculement porte bien sur
// tout ce qui lit des cartes.

const CUSTOM: Catalog = {
  version: 7,
  cards: [
    {
      kind: 'monster',
      id: 'testMonster',
      name: 'Monstre de test',
      cost: 1,
      element: 'fire',
      attack: 9,
      defense: 9,
    },
  ],
  starterCounts: { testMonster: 4 },
};

// Le catalogue actif est un état de module : une fuite fausserait les autres fichiers de test.
afterEach(() => setActiveCatalog(DEFAULT_CATALOG));

describe('catalogue actif', () => {
  it('par défaut, c’est le catalogue livré avec le code', () => {
    expect(getActiveCatalog()).toBe(DEFAULT_CATALOG);
    expect(getCardDef('squire').name).toBe('Écuyer');
  });

  it('setActiveCatalog change ce que getCardDef résout', () => {
    setActiveCatalog(CUSTOM);
    expect(getCardDef('testMonster').name).toBe('Monstre de test');
    // Une carte du catalogue livré n'existe plus une fois l'autre installé.
    expect(() => getCardDef('squire')).toThrow();
    expect(findCardDef('squire')).toBeNull();
  });

  it('le deck de départ est construit depuis le catalogue actif', () => {
    setActiveCatalog(CUSTOM);
    const deck = buildStarterDeck(((): (() => string) => {
      let n = 0;
      return () => `u${n++}`;
    })());
    expect(deck).toHaveLength(4);
    expect(new Set(deck.map((card) => card.cardId))).toEqual(new Set(['testMonster']));
  });

  it('une partie créée après le basculement ne contient que les cartes du nouveau catalogue', () => {
    setActiveCatalog(CUSTOM);
    const state = createInitialState();
    for (const seat of ['p1', 'p2'] as const) {
      expect(state.players[seat].deck).toHaveLength(4);
      for (const card of state.players[seat].deck) expect(card.cardId).toBe('testMonster');
    }
  });

  it('ignore un exemplaire déclaré pour une carte absente, sans faire échouer la partie', () => {
    // Cas d'un catalogue écrit par une version antérieure du code : `catalogSchema` refuse
    // cette forme à l'enregistrement, `buildStarterDeck` garde le filet.
    setActiveCatalog({ ...CUSTOM, starterCounts: { ...CUSTOM.starterCounts, fantome: 3 } });
    const deck = buildStarterDeck((() => {
      let n = 0;
      return () => `u${n++}`;
    })());
    expect(deck).toHaveLength(4);
  });

  it('revenir au catalogue livré rétablit les cartes d’origine', () => {
    setActiveCatalog(CUSTOM);
    setActiveCatalog(DEFAULT_CATALOG);
    expect(getCardDef('squire').name).toBe('Écuyer');
  });
});
