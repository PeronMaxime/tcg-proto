import { afterEach, describe, expect, it } from 'vitest';
import {
  buildStarterDeck,
  cardPower,
  cardRarity,
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

describe('rareté', () => {
  it('donne la rareté de la carte, « commune » quand elle n’en porte pas', () => {
    expect(cardRarity(getCardDef('titan'))).toBe('legendary');
    // `CUSTOM` est écrit sans `rarity`, comme un catalogue d'avant cette fonctionnalité.
    setActiveCatalog(CUSTOM);
    expect(cardRarity(getCardDef('testMonster'))).toBe('common');
  });

  it('chaque carte livrée avec le jeu porte une rareté explicite', () => {
    for (const card of DEFAULT_CATALOG.cards) {
      expect(card.rarity, card.id).toBeDefined();
    }
  });
});

describe('puissance', () => {
  it('additionne attaque et défense, 2 points par habileté, 1 par capacité', () => {
    // Golem de pierre : 1/8, habileté Protection, une capacité → 9 + 2 + 1 = 12.
    expect(cardPower(getCardDef('golem'))).toEqual({
      total: 12,
      stats: 9,
      keywords: 2,
      abilities: 1,
      aura: 0,
    });
  });

  it('compte l’aura pour un point', () => {
    setActiveCatalog({
      ...CUSTOM,
      cards: [
        {
          kind: 'monster',
          id: 'aurique',
          name: 'Aurique',
          cost: 3,
          element: 'air',
          attack: 2,
          defense: 3,
          aura: { attack: 1, defense: 1 },
        },
      ],
    });
    expect(cardPower(getCardDef('aurique'))).toMatchObject({ total: 6, stats: 5, aura: 1 });
  });

  it('un enchantement n’a ni stats ni habileté : seules ses capacités comptent', () => {
    // Étendard de guerre : son effet continu n'est pas une capacité, il ne vaut donc rien ici.
    expect(cardPower(getCardDef('banner'))).toEqual({
      total: 0,
      stats: 0,
      keywords: 0,
      abilities: 0,
      aura: 0,
    });
  });
});
