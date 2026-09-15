import { describe, expect, it } from 'vitest';
import {
  buildStarterDeck,
  CARD_CATALOG,
  ELEMENT_BEATS,
  getCardDef,
  isAbilityAllowed,
  isElementEffective,
  isMonster,
  STARTER_COUNTS,
} from './cards';
import {
  applyAction,
  BREAKTHROUGH_DAMAGE,
  createInitialState,
  ELEMENT_ADVANTAGE_BONUS,
  getMonsterStats,
  isFirstTurnOfGame,
  MIN_ATTACK,
  opponentOf,
  resolveCombat,
  STARTING_COINS,
  STARTING_HP,
  ZONE_SIZES,
} from './rules';
import type { CardElement, CardInstance, GameState, PlayerState, Seat, Zone } from './types';

// PRNG déterministe pour des tests reproductibles (mélange du deck).
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeCard(cardId: string, uid = cardId): CardInstance {
  return { uid, cardId };
}

function emptyZones(): PlayerState['zones'] {
  return {
    attack: new Array(ZONE_SIZES.attack).fill(null),
    defense: new Array(ZONE_SIZES.defense).fill(null),
    enchant: new Array(ZONE_SIZES.enchant).fill(null),
  };
}

function freshPlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    hp: STARTING_HP,
    coins: 5,
    turnsPlayed: 0,
    deck: [],
    market: [],
    hand: [],
    zones: emptyZones(),
    discard: [],
    ...overrides,
  };
}

function baseState(overrides: Partial<GameState> = {}): GameState {
  return {
    rulesVersion: 7,
    turn: 'p1',
    phase: 'main',
    turnNumber: 2, // pas 1 : le tout premier tour de la partie n'a pas de combat

    players: { p1: freshPlayer(), p2: freshPlayer() },
    winner: null,
    eventSeq: 0,
    lastEvent: null,
    ...overrides,
  };
}

describe('catalogue et deck de départ', () => {
  it('fait 50 cartes (40 monstres, 10 enchantements), uids uniques', () => {
    let n = 0;
    const deck = buildStarterDeck(() => `u${n++}`);
    expect(deck).toHaveLength(50);

    const monsters = deck.filter((c) => getCardDef(c.cardId).kind === 'monster');
    const enchantments = deck.filter((c) => getCardDef(c.cardId).kind === 'enchantment');
    expect(monsters).toHaveLength(40);
    expect(enchantments).toHaveLength(10);

    const uids = new Set(deck.map((c) => c.uid));
    expect(uids.size).toBe(50);

    const total = Object.values(STARTER_COUNTS).reduce((a, b) => a + b, 0);
    expect(total).toBe(50);
  });

  it('tout monstre a une attaque de base >= 1 (cohérent avec le plancher MIN_ATTACK, E16)', () => {
    for (const def of CARD_CATALOG) {
      if (isMonster(def)) expect(def.attack).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('createInitialState', () => {
  it('met en place decks, zones et compteurs de départ', () => {
    const state = createInitialState(seededRandom(1));

    for (const seat of ['p1', 'p2'] as Seat[]) {
      const player = state.players[seat];
      expect(player.deck).toHaveLength(50);
      expect(player.zones.attack).toEqual(new Array(5).fill(null));
      expect(player.zones.defense).toEqual(new Array(5).fill(null));
      expect(player.zones.enchant).toEqual(new Array(3).fill(null));
      expect(player.coins).toBe(STARTING_COINS);
      expect(STARTING_COINS).toBe(2);
      expect(player.hand).toEqual([]);
      expect(player.market).toEqual([]);
      expect(player.discard).toEqual([]);
      expect(player.hp).toBe(10);
    }
    expect(state.phase).toBe('start');
    expect(state.turn).toBe('p1');
    expect(state.winner).toBeNull();
    expect(state.rulesVersion).toBe(7);
  });

  it('est déterministe pour une même graine', () => {
    const a = createInitialState(seededRandom(42));
    const b = createInitialState(seededRandom(42));
    expect(a.players.p1.deck.map((c) => c.cardId)).toEqual(b.players.p1.deck.map((c) => c.cardId));
  });
});

describe('applyAction - beginTurn', () => {
  it('donne 1 pièce au 1er tour', () => {
    const state = baseState({ phase: 'start' });
    state.players.p1.deck = [makeCard('rampart', 'd1'), makeCard('banner', 'd2'), makeCard('blessing', 'd3')];
    state.players.p1.coins = 0;

    const next = applyAction(state, 'p1', { type: 'beginTurn' });

    expect(next).not.toBeNull();
    expect(next!.players.p1.coins).toBe(1);
    expect(next!.phase).toBe('main');
    expect(next!.players.p1.market).toHaveLength(3);
    expect(next!.lastEvent).toEqual({ id: 1, type: 'turnStart', seat: 'p1', coinsGained: 1 });
  });

  it('cumule les pièces au 2e tour (R1)', () => {
    let state = baseState({ phase: 'start' });
    state.players.p1.coins = 0;
    state.players.p1.deck = Array.from({ length: 6 }, (_, i) => makeCard('rampart', `d${i}`));

    state = applyAction(state, 'p1', { type: 'beginTurn' })!;
    // On force un retour rapide à la phase start de p1 pour tester le 2e tour sans dépendre
    // du combat : on triche juste sur `turn`/`phase` de l'état intermédiaire.
    state.phase = 'start';

    const next = applyAction(state, 'p1', { type: 'beginTurn' });

    expect(next!.players.p1.coins).toBe(1 + 2); // 1er tour + 2e tour, sans rien dépenser
  });

  it('pioche les 3 cartes du haut du deck (fin du tableau)', () => {
    const state = baseState({ phase: 'start' });
    state.players.p1.deck = [makeCard('rampart', 'bottom'), makeCard('banner', 'mid'), makeCard('blessing', 'top')];

    const next = applyAction(state, 'p1', { type: 'beginTurn' })!;

    expect(next.players.p1.market.map((c) => c.uid)).toEqual(['top', 'mid', 'bottom']);
    expect(next.players.p1.deck).toHaveLength(0);
  });

  it('marché de 2 si le deck a 2 cartes, vide si le deck est vide (H7)', () => {
    const twoCards = baseState({ phase: 'start' });
    twoCards.players.p1.deck = [makeCard('rampart', 'a'), makeCard('banner', 'b')];
    const nextTwo = applyAction(twoCards, 'p1', { type: 'beginTurn' })!;
    expect(nextTwo.players.p1.market).toHaveLength(2);
    expect(nextTwo.players.p1.deck).toHaveLength(0);

    const empty = baseState({ phase: 'start' });
    empty.players.p1.deck = [];
    const nextEmpty = applyAction(empty, 'p1', { type: 'beginTurn' })!;
    expect(nextEmpty.players.p1.market).toEqual([]);
    expect(nextEmpty.phase).toBe('main');
  });

  it('une Trésorerie posée ajoute +1, deux en ajoutent +2', () => {
    const state = baseState({ phase: 'start' });
    state.players.p1.coins = 0;
    state.players.p1.zones.enchant[0] = makeCard('treasury', 't1');
    state.players.p1.zones.enchant[1] = makeCard('treasury', 't2');

    const next = applyAction(state, 'p1', { type: 'beginTurn' })!;

    expect(next.players.p1.coins).toBe(1 + 2); // 1 pièce du tour + 2 de Trésorerie
  });

  it('refuse hors de la phase start et hors de son tour', () => {
    const notStart = baseState({ phase: 'main' });
    expect(applyAction(notStart, 'p1', { type: 'beginTurn' })).toBeNull();

    const notMyTurn = baseState({ phase: 'start', turn: 'p2' });
    expect(applyAction(notMyTurn, 'p1', { type: 'beginTurn' })).toBeNull();
  });

  it("le compteur global turnNumber n'influence pas le gain", () => {
    const state = baseState({ phase: 'start', turnNumber: 50 });
    state.players.p1.coins = 0;
    const next = applyAction(state, 'p1', { type: 'beginTurn' })!;
    expect(next.players.p1.coins).toBe(1);
  });
});

describe('applyAction - buy', () => {
  it('achète une carte du marché : main +1, pièces débitées', () => {
    const state = baseState({ phase: 'main' });
    state.players.p1.coins = 5;
    state.players.p1.market = [makeCard('archer', 'm1')]; // coût 3

    const next = applyAction(state, 'p1', { type: 'buy', uid: 'm1' });

    expect(next).not.toBeNull();
    expect(next!.players.p1.coins).toBe(2);
    expect(next!.players.p1.hand.map((c) => c.uid)).toEqual(['m1']);
    expect(next!.players.p1.market).toEqual([]);
    expect(next!.lastEvent).toEqual({ id: 1, type: 'buy', seat: 'p1', uid: 'm1' });
  });

  it('refuse si les pièces sont insuffisantes', () => {
    const state = baseState({ phase: 'main' });
    state.players.p1.coins = 1;
    state.players.p1.market = [makeCard('titan', 'm1')]; // coût 8
    expect(applyAction(state, 'p1', { type: 'buy', uid: 'm1' })).toBeNull();
  });

  it("refuse si l'uid est absent du marché", () => {
    const state = baseState({ phase: 'main' });
    state.players.p1.market = [makeCard('squire', 'm1')];
    expect(applyAction(state, 'p1', { type: 'buy', uid: 'missing' })).toBeNull();
  });

  it('refuse hors de la phase main', () => {
    const state = baseState({ phase: 'start' });
    state.players.p1.market = [makeCard('squire', 'm1')];
    expect(applyAction(state, 'p1', { type: 'buy', uid: 'm1' })).toBeNull();
  });

  // Le marché reste accessible pendant TOUTE la phase principale (demande utilisateur) : on
  // peut vendre une carte posée pour racheter avec la pièce obtenue, sans étape séparée.
  it('reste accessible après avoir posé des cartes, dans la même phase main', () => {
    let state = baseState({ phase: 'main' });
    state.players.p1.coins = 5;
    state.players.p1.market = [makeCard('archer', 'm1'), makeCard('squire', 'm2')];
    state.players.p1.hand = [makeCard('wolf', 'h1')];

    state = applyAction(state, 'p1', { type: 'place', uid: 'h1', zone: 'attack', slot: 0 })!;
    const next = applyAction(state, 'p1', { type: 'buy', uid: 'm2' });

    expect(next).not.toBeNull();
    expect(next!.players.p1.hand.map((c) => c.uid)).toEqual(['m2']);
  });

  it("permet de vendre une carte posée puis de racheter avec la pièce obtenue", () => {
    let state = baseState({ phase: 'main' });
    state.players.p1.coins = 0;
    state.players.p1.coins = 1;
    state.players.p1.market = [makeCard('squire', 'm1')]; // coût 2
    state.players.p1.zones.attack[0] = makeCard('guard', 'g1');

    expect(applyAction(state, 'p1', { type: 'buy', uid: 'm1' })).toBeNull();
    state = applyAction(state, 'p1', { type: 'sell', uid: 'g1' })!;
    expect(state.players.p1.coins).toBe(2);

    const next = applyAction(state, 'p1', { type: 'buy', uid: 'm1' });
    expect(next).not.toBeNull();
    expect(next!.players.p1.coins).toBe(0);
  });

  it("les invendus retournent au fond du deck au moment d'endTurn (H5)", () => {
    const state = baseState({ phase: 'main' });
    state.players.p1.deck = [makeCard('golem', 'rest')];
    state.players.p1.market = [makeCard('squire', 'm1'), makeCard('wolf', 'm2')];

    const next = applyAction(state, 'p1', { type: 'endTurn' });

    expect(next).not.toBeNull();
    expect(next!.players.p1.deck.map((c) => c.uid)).toEqual(['m1', 'm2', 'rest']);
    expect(next!.players.p1.market).toEqual([]);
  });
});

describe('applyAction - place', () => {
  it('pose un monstre en attaque et en défense (rampart : pas de capacité)', () => {
    const state = baseState({ phase: 'main' });
    state.players.p1.hand = [makeCard('guard', 'h1'), makeCard('drake', 'h2')];
    state.players.p1.coins = 5;

    const afterAttack = applyAction(state, 'p1', { type: 'place', uid: 'h1', zone: 'attack', slot: 0 });
    expect(afterAttack!.players.p1.zones.attack[0]?.uid).toBe('h1');
    expect(afterAttack!.players.p1.coins).toBe(5); // pose gratuite, ni guard ni drake n'ont de capacité Invoqué
    expect(afterAttack!.lastEvent).toMatchObject({ type: 'place', effects: [] });

    const afterDefense = applyAction(afterAttack!, 'p1', { type: 'place', uid: 'h2', zone: 'defense', slot: 2 });
    expect(afterDefense!.players.p1.zones.defense[2]?.uid).toBe('h2');
    expect(afterDefense!.players.p1.hand).toEqual([]);
  });

  it('refuse un monstre sur enchant et un enchantement en attaque', () => {
    const state = baseState({ phase: 'main' });
    state.players.p1.hand = [makeCard('squire', 'h1'), makeCard('banner', 'h2')];

    expect(applyAction(state, 'p1', { type: 'place', uid: 'h1', zone: 'enchant', slot: 0 })).toBeNull();
    expect(applyAction(state, 'p1', { type: 'place', uid: 'h2', zone: 'attack', slot: 0 })).toBeNull();
  });

  it('refuse un emplacement occupé', () => {
    const state = baseState({ phase: 'main' });
    state.players.p1.hand = [makeCard('squire', 'h1')];
    state.players.p1.zones.attack[0] = makeCard('wolf', 'existing');

    expect(applyAction(state, 'p1', { type: 'place', uid: 'h1', zone: 'attack', slot: 0 })).toBeNull();
  });

  it('refuse les index de slot invalides', () => {
    const state = baseState({ phase: 'main' });
    state.players.p1.hand = [makeCard('squire', 'h1'), makeCard('banner', 'h2')];

    expect(applyAction(state, 'p1', { type: 'place', uid: 'h1', zone: 'attack', slot: -1 })).toBeNull();
    expect(applyAction(state, 'p1', { type: 'place', uid: 'h1', zone: 'attack', slot: 5 })).toBeNull();
    expect(applyAction(state, 'p1', { type: 'place', uid: 'h2', zone: 'enchant', slot: 3 })).toBeNull();
    expect(applyAction(state, 'p1', { type: 'place', uid: 'h1', zone: 'attack', slot: 1.5 })).toBeNull();
  });

  it('refuse une carte hors main et un placement hors phase main', () => {
    const state = baseState({ phase: 'main' });
    state.players.p1.hand = [makeCard('squire', 'h1')];
    expect(applyAction(state, 'p1', { type: 'place', uid: 'unknown', zone: 'attack', slot: 0 })).toBeNull();

    const startState = baseState({ phase: 'start' });
    startState.players.p1.hand = [makeCard('squire', 'h1')];
    expect(applyAction(startState, 'p1', { type: 'place', uid: 'h1', zone: 'attack', slot: 0 })).toBeNull();
  });
});

describe('applyAction - move', () => {
  it('déplace une carte posée vers un autre emplacement libre de la même zone', () => {
    const state = baseState({ phase: 'main' });
    state.players.p1.zones.attack[0] = makeCard('wolf', 'w1');

    const next = applyAction(state, 'p1', { type: 'move', uid: 'w1', slot: 3 });

    expect(next).not.toBeNull();
    expect(next!.players.p1.zones.attack[0]).toBeNull();
    expect(next!.players.p1.zones.attack[3]?.uid).toBe('w1');
    expect(next!.lastEvent).toEqual({ id: 1, type: 'move', seat: 'p1', uid: 'w1', zone: 'attack', from: 0, to: 3 });
  });

  it('refuse un emplacement occupé, un slot identique, ou hors phase main', () => {
    const state = baseState({ phase: 'main' });
    state.players.p1.zones.defense[0] = makeCard('wolf', 'w1');
    state.players.p1.zones.defense[1] = makeCard('guard', 'g1');

    expect(applyAction(state, 'p1', { type: 'move', uid: 'w1', slot: 1 })).toBeNull(); // occupé
    expect(applyAction(state, 'p1', { type: 'move', uid: 'w1', slot: 0 })).toBeNull(); // no-op

    const startState = baseState({ phase: 'start' });
    startState.players.p1.zones.defense[0] = makeCard('wolf', 'w1');
    expect(applyAction(startState, 'p1', { type: 'move', uid: 'w1', slot: 1 })).toBeNull();
  });

  it("refuse une carte qui n'est pas sur le board (main, marché) ou qui n'existe pas", () => {
    const state = baseState({ phase: 'main' });
    state.players.p1.hand = [makeCard('squire', 'h1')];
    expect(applyAction(state, 'p1', { type: 'move', uid: 'h1', slot: 0 })).toBeNull();
    expect(applyAction(state, 'p1', { type: 'move', uid: 'unknown', slot: 0 })).toBeNull();
  });
});

describe('fusion dorée', () => {
  it('la carte en main devient dorée et reste en main, les 2 exemplaires posés partent en défausse', () => {
    const state = baseState({ phase: 'main' });
    state.players.p1.zones.attack[0] = makeCard('wolf', 'w1');
    state.players.p1.zones.defense[3] = makeCard('wolf', 'w2');
    state.players.p1.hand = [makeCard('squire', 's1'), makeCard('wolf', 'w3')];

    const next = applyAction(state, 'p1', { type: 'fuse', uid: 'w3' })!;

    const p1 = next.players.p1;
    expect(p1.hand).toEqual([makeCard('squire', 's1'), { uid: 'w3', cardId: 'wolf', golden: true }]);
    expect(p1.zones.attack[0]).toBeNull();
    expect(p1.zones.defense[3]).toBeNull();
    expect(p1.discard.map((c) => c.uid)).toEqual(['w1', 'w2']);
    expect(next.lastEvent).toEqual({ id: 1, type: 'fuse', seat: 'p1', uid: 'w3', fusedUids: ['w1', 'w2'] });
  });

  it('fonctionne même avec un board plein, puis la carte dorée se repose normalement', () => {
    const state = baseState({ phase: 'main' });
    const p1 = state.players.p1;
    p1.zones.attack = ['wolf', 'wolf', 'squire', 'squire', 'guard'].map((id, i) => makeCard(id, `a${i}`));
    p1.zones.defense = ['guard', 'guard', 'archer', 'archer', 'knight'].map((id, i) => makeCard(id, `d${i}`));
    p1.hand = [makeCard('wolf', 'w3')];
    expect(applyAction(state, 'p1', { type: 'place', uid: 'w3', zone: 'attack', slot: 0 })).toBeNull();

    const fused = applyAction(state, 'p1', { type: 'fuse', uid: 'w3' })!;
    expect(fused.players.p1.zones.attack[0]).toBeNull();
    expect(fused.players.p1.zones.attack[1]).toBeNull();

    const placed = applyAction(fused, 'p1', { type: 'place', uid: 'w3', zone: 'attack', slot: 1 })!;
    expect(placed.players.p1.zones.attack[1]).toEqual({ uid: 'w3', cardId: 'wolf', golden: true });
    expect(placed.players.p1.hand).toEqual([]);
  });

  it('absorbe les 2 premiers exemplaires (attaque puis défense, de gauche à droite) s’il y en a plus', () => {
    const state = baseState({ phase: 'main' });
    state.players.p1.zones.defense[0] = makeCard('wolf', 'w1');
    state.players.p1.zones.attack[4] = makeCard('wolf', 'w2');
    state.players.p1.zones.attack[1] = makeCard('wolf', 'w3');
    state.players.p1.hand = [makeCard('wolf', 'w4')];

    const next = applyAction(state, 'p1', { type: 'fuse', uid: 'w4' })!;

    expect(next.players.p1.discard.map((c) => c.uid)).toEqual(['w3', 'w2']);
    expect(next.players.p1.zones.defense[0]?.uid).toBe('w1');
  });

  it('efface le buff des exemplaires absorbés (E9)', () => {
    const state = baseState({ phase: 'main' });
    state.players.p1.zones.attack[0] = { uid: 'w1', cardId: 'wolf', buff: { attack: 1, defense: 1 } };
    state.players.p1.zones.attack[1] = makeCard('wolf', 'w2');
    state.players.p1.hand = [makeCard('wolf', 'w3')];

    const next = applyAction(state, 'p1', { type: 'fuse', uid: 'w3' })!;
    const absorbed = next.players.p1.discard.find((c) => c.uid === 'w1')!;
    expect(absorbed.buff).toBeUndefined();
  });

  it("refuse avec 1 seul exemplaire posé ; ne compte ni les dorés ni ceux de l'adversaire", () => {
    const state = baseState({ phase: 'main' });
    state.players.p1.zones.attack[0] = { uid: 'g1', cardId: 'wolf', golden: true };
    state.players.p1.zones.attack[1] = makeCard('wolf', 'w1');
    state.players.p1.zones.attack[2] = makeCard('squire', 's1');
    state.players.p2.zones.attack[0] = makeCard('wolf', 'x1');
    state.players.p1.hand = [makeCard('wolf', 'w2')];

    expect(applyAction(state, 'p1', { type: 'fuse', uid: 'w2' })).toBeNull();
  });

  it('refuse une carte dorée, un enchantement, une carte hors main ou hors phase main', () => {
    const state = baseState({ phase: 'main' });
    state.players.p1.zones.attack[0] = makeCard('wolf', 'w1');
    state.players.p1.zones.attack[1] = makeCard('wolf', 'w2');
    state.players.p1.zones.enchant[0] = makeCard('banner', 'b1');
    state.players.p1.zones.enchant[1] = makeCard('banner', 'b2');
    state.players.p1.hand = [{ uid: 'g1', cardId: 'wolf', golden: true }, makeCard('banner', 'b3')];

    expect(applyAction(state, 'p1', { type: 'fuse', uid: 'g1' })).toBeNull();
    expect(applyAction(state, 'p1', { type: 'fuse', uid: 'b3' })).toBeNull();
    expect(applyAction(state, 'p1', { type: 'fuse', uid: 'w1' })).toBeNull();

    const startState = baseState({ phase: 'start' });
    startState.players.p1 = structuredClone(state.players.p1);
    startState.players.p1.hand = [makeCard('wolf', 'w3')];
    expect(applyAction(startState, 'p1', { type: 'fuse', uid: 'w3' })).toBeNull();
  });

  it('une carte qui peut fusionner ne peut pas être posée, même sur un emplacement libre', () => {
    const state = baseState({ phase: 'main' });
    state.players.p1.zones.attack[0] = makeCard('wolf', 'w1');
    state.players.p1.zones.attack[1] = makeCard('wolf', 'w2');
    state.players.p1.hand = [makeCard('wolf', 'w3')];

    expect(applyAction(state, 'p1', { type: 'place', uid: 'w3', zone: 'attack', slot: 2 })).toBeNull();
    expect(applyAction(state, 'p1', { type: 'place', uid: 'w3', zone: 'defense', slot: 0 })).toBeNull();
  });

  it("le 2e exemplaire se pose normalement, et un exemplaire se repose dès qu'il ne peut plus fusionner", () => {
    const state = baseState({ phase: 'main' });
    state.players.p1.zones.attack[0] = makeCard('wolf', 'w1');
    state.players.p1.hand = [makeCard('wolf', 'w2'), makeCard('wolf', 'w3')];

    const afterSecond = applyAction(state, 'p1', { type: 'place', uid: 'w2', zone: 'attack', slot: 1 })!;
    expect(afterSecond.players.p1.zones.attack[1]?.uid).toBe('w2');
    expect(applyAction(afterSecond, 'p1', { type: 'place', uid: 'w3', zone: 'attack', slot: 2 })).toBeNull();

    const afterSell = applyAction(afterSecond, 'p1', { type: 'sell', uid: 'w1' })!;
    expect(applyAction(afterSell, 'p1', { type: 'place', uid: 'w3', zone: 'attack', slot: 2 })).not.toBeNull();
  });

  it('un monstre doré a ses stats de base doublées, enchantements ajoutés ensuite', () => {
    const player = freshPlayer();
    player.zones.enchant[0] = makeCard('banner', 'b1'); // +1 atq en attaque
    const golden: CardInstance = { uid: 'w', cardId: 'wolf', golden: true };
    expect(getMonsterStats(player, golden, 'attack')).toEqual({ attack: 3 * 2 + 1, defense: 1 * 2 });
    expect(getMonsterStats(player, golden, 'defense')).toEqual({ attack: 6, defense: 2 });
  });

  it('en combat, un attaquant doré frappe deux fois plus fort et un défenseur doré encaisse le double', () => {
    // titan/archer n'ont qu'une capacité Invoqué (aucune capacité de combat), donc ce
    // combat n'en déclenche aucune : les chiffres sont uniquement ceux du doublement doré.
    const state = baseState();
    state.players.p1.zones.attack[0] = { uid: 'a1', cardId: 'titan', golden: true }; // 14 atq
    state.players.p2.zones.defense[0] = { uid: 'd1', cardId: 'archer', golden: true }; // 4 déf, 6 atq

    const { steps } = resolveCombat(state, 'p1');
    expect(steps[0]).toMatchObject({
      damage: 14,
      target: { kind: 'monster', uid: 'd1' },
      remaining: 0,
      retaliation: 6,
      attackerRemaining: 14 - 6,
    });
  });
});

describe('applyAction - sell', () => {
  it('retire une carte posée, la met en défausse, donne 1 pièce et déclenche Vendu (Loup : +1 PV)', () => {
    const state = baseState({ phase: 'main' });
    state.players.p1.coins = 2;
    state.players.p1.hp = 5;
    state.players.p1.zones.attack[3] = makeCard('wolf', 'w1');

    const next = applyAction(state, 'p1', { type: 'sell', uid: 'w1' });

    expect(next).not.toBeNull();
    expect(next!.players.p1.zones.attack[3]).toBeNull();
    expect(next!.players.p1.discard.map((c) => c.uid)).toEqual(['w1']);
    expect(next!.players.p1.coins).toBe(3);
    expect(next!.players.p1.hp).toBe(6); // E8 : Loup - Vendu : +1 PV
    expect(next!.lastEvent).toEqual({
      id: 1,
      type: 'sell',
      seat: 'p1',
      uid: 'w1',
      zone: 'attack',
      slot: 3,
      effects: [{ seat: 'p1', sourceUid: 'w1', cardId: 'wolf', trigger: 'sold', effect: { type: 'healSelf', amount: 1 } }],
    });
  });

  it('Trésorerie : 1 (vente) + 1 (Vendu) pièces, moins que son coût', () => {
    const state = baseState({ phase: 'main' });
    state.players.p1.coins = 0;
    state.players.p1.zones.enchant[0] = makeCard('treasury', 't1');

    const next = applyAction(state, 'p1', { type: 'sell', uid: 't1' })!;
    expect(next.players.p1.coins).toBe(2);
    expect(next.players.p1.coins).toBeLessThan(getCardDef('treasury').cost);
  });

  it('efface le buff de la carte vendue (E9)', () => {
    const state = baseState({ phase: 'main' });
    state.players.p1.zones.attack[0] = { uid: 'g1', cardId: 'guard', buff: { attack: 1, defense: 1 } };

    const next = applyAction(state, 'p1', { type: 'sell', uid: 'g1' })!;
    expect(next.players.p1.discard[0].buff).toBeUndefined();
  });

  it('fonctionne pour un monstre en défense et un enchantement', () => {
    const state = baseState({ phase: 'main' });
    state.players.p1.zones.defense[1] = makeCard('guard', 'g1');
    state.players.p1.zones.enchant[2] = makeCard('banner', 'b1');

    const afterDefense = applyAction(state, 'p1', { type: 'sell', uid: 'g1' });
    expect(afterDefense!.players.p1.zones.defense[1]).toBeNull();
    expect(afterDefense!.players.p1.discard.map((c) => c.uid)).toEqual(['g1']);

    const afterEnchant = applyAction(afterDefense!, 'p1', { type: 'sell', uid: 'b1' });
    expect(afterEnchant!.players.p1.zones.enchant[2]).toBeNull();
    expect(afterEnchant!.players.p1.discard.map((c) => c.uid)).toEqual(['g1', 'b1']);
  });

  it("refuse une carte qui n'est pas sur le board (main, marché) ou qui n'existe pas", () => {
    const state = baseState({ phase: 'main' });
    state.players.p1.hand = [makeCard('squire', 'h1')];
    state.players.p1.market = [makeCard('wolf', 'm1')];

    expect(applyAction(state, 'p1', { type: 'sell', uid: 'h1' })).toBeNull();
    expect(applyAction(state, 'p1', { type: 'sell', uid: 'm1' })).toBeNull();
    expect(applyAction(state, 'p1', { type: 'sell', uid: 'unknown' })).toBeNull();
  });

  it("refuse de vendre une carte de l'adversaire", () => {
    const state = baseState({ phase: 'main' });
    state.players.p2.zones.attack[0] = makeCard('wolf', 'w1');

    expect(applyAction(state, 'p1', { type: 'sell', uid: 'w1' })).toBeNull();
  });

  it("n'est pas limité à la phase main (autorisé aussi en phase start)", () => {
    const state = baseState({ phase: 'start' });
    state.players.p1.zones.attack[0] = makeCard('guard', 'g1');

    expect(applyAction(state, 'p1', { type: 'sell', uid: 'g1' })).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------------------
// Combat : riposte et cycles (§7.1) — cartes neutres en combat : Archère et Titan n'ont
// qu'une capacité Invoqué (aucune capacité de combat), donc leurs échanges ne déclenchent
// rien et isolent la mécanique pure de `resolveCombat`. L'Écuyer (Invoqué/KO) est neutre
// aussi tant que son deck est vide (pioche sans effet).
// ---------------------------------------------------------------------------------------

describe('combat : riposte et cycles', () => {
  function playerWith(zoneCards: Partial<Record<Zone, (string | null)[]>>, hp = STARTING_HP): PlayerState {
    const p = freshPlayer({ hp });
    for (const [zone, cards] of Object.entries(zoneCards) as [Zone, (string | null)[]][]) {
      p.zones[zone] = p.zones[zone].map((_, i) => (cards[i] ? makeCard(cards[i]!, `${zone}${i}`) : null));
    }
    return p;
  }

  it('riposte : dégâts simultanés dans les deux sens (E13)', () => {
    const state = baseState();
    state.players.p1 = playerWith({ attack: ['archer'] }); // 3 atq / 2 déf
    state.players.p2 = playerWith({ defense: ['titan'] }); // 7 atq / 7 déf

    const { steps } = resolveCombat(state, 'p1');
    expect(steps[0]).toMatchObject({
      cycle: 1,
      damage: 3,
      remaining: 4, // 7 - 3
      retaliation: 7,
      attackerRemaining: 0, // 2 - 7, clampé (H2)
    });
  });

  it('un défenseur mis KO par le coup reçoit quand même sa riposte (E5, E13)', () => {
    const state = baseState();
    state.players.p1 = playerWith({ attack: ['archer'] }); // 3 atq / 2 déf
    state.players.p2 = playerWith({ defense: ['squire'] }); // 1 atq / 2 déf

    const { steps } = resolveCombat(state, 'p1');
    expect(steps[0]).toMatchObject({ damage: 3, remaining: 0, retaliation: 1, attackerRemaining: 1 });
  });

  it('cycles : deux Écuyers s’affrontent sur 2 cycles jusqu’au KO mutuel, puis aucune percée', () => {
    const state = baseState();
    state.players.p1 = playerWith({ attack: ['squire'] }); // 1 atq / 2 déf
    state.players.p2 = playerWith({ defense: ['squire'] }, 20);

    const { steps, stalemate } = resolveCombat(state, 'p1');
    expect(steps.map((s) => s.cycle)).toEqual([1, 2]);
    expect(steps[0]).toMatchObject({ damage: 1, remaining: 1, retaliation: 1, attackerRemaining: 1 });
    expect(steps[1]).toMatchObject({ damage: 1, remaining: 0, retaliation: 1, attackerRemaining: 0 });
    expect(stalemate).toBe(false);
    // Tous les attaquants KO -> aucune percée, PV du défenseur inchangés.
    expect(state.players.p2.hp).toBe(20);
  });

  it("un attaquant KO par riposte au cycle 1 n'apparaît plus dans les coups suivants", () => {
    const state = baseState();
    // Golem : 1 atq / 8 déf, aucune capacité Attaque (seulement Défend) -> neutre ici.
    state.players.p1 = playerWith({ attack: ['archer', 'golem'] }); // 3/2 puis 1/8
    state.players.p2 = playerWith({ defense: ['titan'] }); // 7 atq / 7 déf

    const { steps } = resolveCombat(state, 'p1');
    // Cycle 1 : les deux attaquants frappent (le défenseur survit aux deux coups) ;
    // l'archère (2 déf) meurt à la riposte du titan (7 atq), le golem (8 déf) survit.
    // Golem (terre) contre Titan (eau) : +1 dégât élémentaire, soit 2 par coup.
    expect(steps[0]).toMatchObject({ cycle: 1, attackerUid: 'attack0', damage: 3, remaining: 4, attackerRemaining: 0 });
    expect(steps[1]).toMatchObject({ cycle: 1, attackerUid: 'attack1', damage: 2, remaining: 2, attackerRemaining: 1 });
    // Cycle 2 : seul le golem attaque encore (l'archère est KO, absente des coups suivants).
    expect(steps[2]).toMatchObject({ cycle: 2, attackerUid: 'attack1', damage: 2, remaining: 0, attackerRemaining: 0 });
    expect(steps.filter((s) => s.cycle === 2).every((s) => s.attackerUid !== 'attack0')).toBe(true);
  });

  it('le dernier défenseur tombe en milieu de cycle -> les attaquants suivants frappent en percée, chacun une fois, y compris ceux qui avaient déjà frappé (E15)', () => {
    const state = baseState();
    state.players.p1 = playerWith({ attack: ['titan', 'archer'] }); // 7/7 puis 3/2
    state.players.p2 = playerWith({ defense: ['squire'] }, 20); // 1/2, seul défenseur

    const { steps } = resolveCombat(state, 'p1');
    // Mêlée cycle 1 : seul le titan frappe (le défenseur tombe), l'archère n'a plus de cible.
    const melee = steps.filter((s) => s.target.kind === 'monster');
    expect(melee).toHaveLength(1);
    expect(melee[0]).toMatchObject({ attackerUid: 'attack0', remaining: 0 });
    // Percée : titan ET archère frappent le héros, chacun une fois (cycle = dernier cycle + 1).
    const breakthrough = steps.filter((s) => s.target.kind === 'player');
    expect(breakthrough.map((s) => s.attackerUid)).toEqual(['attack0', 'attack1']);
    expect(breakthrough.every((s) => s.cycle === 2)).toBe(true);
    expect(state.players.p2.hp).toBe(20 - 2 * BREAKTHROUGH_DAMAGE);
  });

  it('aucun défenseur au départ -> chaque attaquant frappe le héros une fois (comportement conservé)', () => {
    const state = baseState();
    state.players.p1 = playerWith({ attack: ['archer', 'titan'] });
    state.players.p2 = playerWith({});

    const { steps } = resolveCombat(state, 'p1');
    expect(steps).toHaveLength(2);
    expect(steps.every((s) => s.target.kind === 'player' && s.cycle === 1)).toBe(true);
    expect(state.players.p2.hp).toBe(STARTING_HP - 2 * BREAKTHROUGH_DAMAGE);
  });

  it("percée : chaque attaquant inflige toujours 1 dégât au héros, quelle que soit son attaque", () => {
    const state = baseState();
    state.players.p1 = playerWith({ attack: ['titan', 'squire'] }); // 7 atq puis 1 atq
    state.players.p2 = playerWith({});

    const { steps } = resolveCombat(state, 'p1');
    expect(BREAKTHROUGH_DAMAGE).toBe(1);
    expect(steps.map((s) => s.damage)).toEqual([1, 1]);
    expect(state.players.p2.hp).toBe(STARTING_HP - 2);
  });

  it("percée : ce n'est pas une attaque, aucune capacité Attaque ne se déclenche", () => {
    const state = baseState();
    state.players.p1 = playerWith({ attack: ['knight'] }); // Attaque : +1 atq permanent
    state.players.p2 = playerWith({});

    const { steps } = resolveCombat(state, 'p1');
    expect(steps).toHaveLength(1);
    expect(steps[0].effects).toEqual([]);
    expect(state.players.p1.zones.attack[0]!.buff).toBeUndefined();
    expect(state.players.p2.hp).toBe(STARTING_HP - 1);
  });

  it('attaque minimum 1 (E16) : un buff négatif ne fait jamais descendre en dessous de MIN_ATTACK', () => {
    const player = freshPlayer();
    const debuffed: CardInstance = { uid: 'x', cardId: 'squire', buff: { attack: -99, defense: 0 } };
    expect(getMonsterStats(player, debuffed, 'attack').attack).toBe(MIN_ATTACK);
    expect(MIN_ATTACK).toBe(1);
  });

  it('combat nul (E16) : inatteignable avec les règles actuelles — un bouclier absorbe le coup mais pas la riposte', () => {
    const state = baseState();
    state.players.p1 = playerWith({ attack: ['squire'] }); // 1 atq
    state.players.p2 = playerWith({ defense: ['guard'] }, 20); // Défend : shield 1 -> absorbe le coup de 1

    const { steps, stalemate } = resolveCombat(state, 'p1');
    expect(steps[0].damage).toBe(0); // coup entièrement absorbé (shield >= dégâts)
    expect(steps[0].retaliation).toBeGreaterThan(0); // la riposte n'est pas affectée par shield
    expect(stalemate).toBe(false);
  });

  it('excédent de dégâts perdu (H2), dans les deux sens', () => {
    const state = baseState();
    state.players.p1 = playerWith({ attack: ['squire'] }); // 1 atq / 2 déf
    state.players.p2 = playerWith({ defense: ['titan'] }, 20); // 7 atq / 7 déf

    const { steps } = resolveCombat(state, 'p1');
    // Le titan (7 atq) inflige une riposte largement supérieure aux 2 déf de l'écuyer.
    expect(steps[0]).toMatchObject({ damage: 1, remaining: 6, retaliation: 7, attackerRemaining: 0 });
  });

  it('H1 : après le combat, aucune trace de dégât ne persiste sur les monstres', () => {
    const state = baseState();
    state.players.p1 = playerWith({ attack: ['squire'] });
    state.players.p2 = playerWith({ defense: ['squire'] });

    resolveCombat(state, 'p1'); // mute `state` (comme `applyEndTurn` le fait sur un clone)

    const survivorCard = state.players.p1.zones.attack[0];
    const opponentCard = state.players.p2.zones.defense[0];
    // Les instances de carte ne portent aucune trace de dégâts : `damageTaken` est purement
    // interne à `resolveCombat` (les deux monstres sont posés sans capacité de combat autre
    // qu'un KO sans effet ici car leur deck est vide, donc rien d'autre n'a pu muter la carte).
    expect(survivorCard).toEqual({ uid: 'attack0', cardId: 'squire' });
    expect(opponentCard).toEqual({ uid: 'defense0', cardId: 'squire' });
  });

  it("victoire en percée : le combat s'arrête au 0 PV, les coups suivants ne sont pas résolus (H9)", () => {
    const state = baseState();
    state.players.p1 = playerWith({ attack: ['titan', 'titan', 'titan'] }); // 7 atq chacun
    state.players.p2 = playerWith({}, 2);

    const { steps } = resolveCombat(state, 'p1');
    // 2 - 1 = 1, puis 1 - 1 -> 0 (tue, H9) : le 3e titan ne frappe pas.
    expect(steps).toHaveLength(2);
    expect(state.players.p2.hp).toBe(0);
    expect(state.winner).toBe('p1');
  });

  it('zone d’attaque vide -> steps vide', () => {
    const state = baseState();
    state.players.p1 = playerWith({});
    state.players.p2 = playerWith({ defense: ['squire'] });
    expect(resolveCombat(state, 'p1').steps).toEqual([]);
  });

  it('opponentOf renvoie le siège opposé', () => {
    expect(opponentOf('p1')).toBe('p2');
    expect(opponentOf('p2')).toBe('p1');
  });

  it("les enchantements du propriétaire s'appliquent, pas ceux de l'adversaire", () => {
    const state = baseState();
    state.players.p1 = playerWith({ attack: ['squire'], enchant: ['banner'] }); // +1 atq
    state.players.p2 = playerWith({ defense: ['squire'], enchant: ['banner'] }); // n'affecte pas p1

    const stats = getMonsterStats(state.players.p1, makeCard('squire'), 'attack');
    expect(stats.attack).toBe(2); // 1 de base + 1 de mon étendard

    const { steps } = resolveCombat(state, 'p1');
    expect(steps[0].damage).toBe(2);
  });

  it('Rempart : +1 déf en défense seulement ; deux Remparts : +2', () => {
    const player = playerWith({ enchant: ['rampart', 'rampart'] });
    const stats = getMonsterStats(player, makeCard('squire'), 'defense');
    expect(stats.defense).toBe(2 + 2);
    const attackStats = getMonsterStats(player, makeCard('squire'), 'attack');
    expect(attackStats.attack).toBe(1); // pas de bonus en attaque
  });

  it('E17 : un monstre à défense effective <= 0 ne participe pas au combat', () => {
    const state = baseState();
    state.players.p1 = playerWith({ attack: ['squire', 'archer'] });
    // L'écuyer attaquant a une défense effective nulle (debuff manuel) : il est exclu.
    state.players.p1.zones.attack[0] = { uid: 'weak', cardId: 'squire', buff: { attack: 0, defense: -5 } };
    state.players.p2 = playerWith({ defense: ['titan'] });

    const { steps } = resolveCombat(state, 'p1');
    expect(steps.every((s) => s.attackerUid !== 'weak')).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------
// Éléments (demande utilisateur) : eau > feu > air > terre > eau, +1 dégât en mêlée.
// Titan (eau), Archère (air) et Chevalier (feu, Attaque seulement) ne déclenchent aucune
// capacité dans les échanges ci-dessous.
// ---------------------------------------------------------------------------------------

describe('éléments', () => {
  it("roue : chaque élément domine le suivant, jamais l'inverse, ni lui-même, ni l'opposé", () => {
    const wheel: CardElement[] = ['water', 'fire', 'air', 'earth'];
    wheel.forEach((element, i) => {
      const next = wheel[(i + 1) % wheel.length];
      const opposite = wheel[(i + 2) % wheel.length];
      expect(isElementEffective(element, next)).toBe(true);
      expect(isElementEffective(next, element)).toBe(false);
      expect(isElementEffective(element, element)).toBe(false);
      expect(isElementEffective(element, opposite)).toBe(false);
    });
  });

  it('chaque carte du catalogue a un élément de la roue', () => {
    for (const def of CARD_CATALOG) {
      expect(Object.keys(ELEMENT_BEATS)).toContain(def.element);
    }
  });

  it('attaquant avantagé : +1 dégât sur son coup, riposte inchangée', () => {
    const state = baseState();
    state.players.p1.zones.attack[0] = makeCard('golem', 'g1'); // terre, 1 atq / 8 déf
    state.players.p2.zones.defense[0] = makeCard('titan', 't1'); // eau, 7 atq / 7 déf

    const { steps } = resolveCombat(state, 'p1');
    expect(steps[0]).toMatchObject({
      damage: 1 + ELEMENT_ADVANTAGE_BONUS,
      retaliation: 7,
      effective: true,
      retaliationEffective: false,
    });
  });

  it('défenseur avantagé : +1 dégât sur sa riposte, coup inchangé', () => {
    const state = baseState();
    state.players.p1.zones.attack[0] = makeCard('archer', 'a1'); // air, 3 atq / 2 déf
    state.players.p2.zones.defense[0] = makeCard('knight', 'k1'); // feu, 4 atq / 4 déf

    const { steps } = resolveCombat(state, 'p1');
    expect(steps[0]).toMatchObject({
      damage: 3,
      remaining: 1,
      retaliation: 4 + ELEMENT_ADVANTAGE_BONUS,
      effective: false,
      retaliationEffective: true,
    });
  });

  it('éléments neutres (opposés sur la roue) : aucun bonus', () => {
    const state = baseState();
    state.players.p1.zones.attack[0] = makeCard('archer', 'a1'); // air
    state.players.p2.zones.defense[0] = makeCard('titan', 't1'); // eau

    const { steps } = resolveCombat(state, 'p1');
    expect(steps[0]).toMatchObject({ damage: 3, retaliation: 7, effective: false, retaliationEffective: false });
  });

  it('le bouclier peut absorber le bonus élémentaire', () => {
    const state = baseState();
    state.players.p1.zones.attack[0] = makeCard('golem', 'g1'); // terre, 1 atq
    state.players.p2.zones.defense[0] = makeCard('guard', 'd1'); // eau, Défend : shield 1

    const { steps } = resolveCombat(state, 'p1');
    expect(steps[0].damage).toBe(1 + ELEMENT_ADVANTAGE_BONUS - 1);
    expect(steps[0].effective).toBe(true); // sans l'élément, le bouclier aurait tout absorbé
  });

  it("pas de bonus en percée : le héros n'a pas d'élément", () => {
    const state = baseState();
    state.players.p1.zones.attack[0] = makeCard('golem', 'g1'); // terre, 1 atq
    state.players.p2 = freshPlayer({ hp: 20 });

    const { steps } = resolveCombat(state, 'p1');
    expect(steps[0]).toMatchObject({ target: { kind: 'player' }, damage: 1, effective: false });
  });
});

// ---------------------------------------------------------------------------------------
// Effets déclenchés (§7.2)
// ---------------------------------------------------------------------------------------

describe('effets déclenchés', () => {
  it('catalogue : toutes les capacités respectent isAbilityAllowed ; le deck fait toujours 50', () => {
    for (const def of CARD_CATALOG) {
      for (const ability of def.abilities ?? []) {
        expect(isAbilityAllowed(def, ability)).toBe(true);
      }
    }
    const total = Object.values(STARTER_COUNTS).reduce((a, b) => a + b, 0);
    expect(total).toBe(50);
  });

  it('Invoqué : Écuyer posé -> +1 pièce, logué dans lastEvent.effects', () => {
    const state = baseState({ phase: 'main' });
    state.players.p1.coins = 0;
    state.players.p1.hand = [makeCard('squire', 's1')];

    const next = applyAction(state, 'p1', { type: 'place', uid: 's1', zone: 'attack', slot: 0 })!;

    expect(next.players.p1.coins).toBe(1);
    expect(next.lastEvent).toMatchObject({
      type: 'place',
      effects: [{ seat: 'p1', sourceUid: 's1', cardId: 'squire', trigger: 'summon', effect: { type: 'gainCoins', amount: 1 } }],
    });
  });

  it("Invoqué : Archère posée avec l'adversaire à 1 PV -> victoire immédiate", () => {
    const state = baseState({ phase: 'main' });
    state.players.p1.hand = [makeCard('archer', 'a1')];
    state.players.p2.hp = 1;

    const next = applyAction(state, 'p1', { type: 'place', uid: 'a1', zone: 'attack', slot: 0 })!;

    expect(next.winner).toBe('p1');
    expect(next.players.p2.hp).toBe(0);
  });

  it('Invoqué : Titan -> +1/+1 sur les autres monstres, pas sur lui-même', () => {
    const state = baseState({ phase: 'main' });
    state.players.p1.zones.attack[0] = makeCard('squire', 's1');
    state.players.p1.hand = [makeCard('titan', 't1')];

    const next = applyAction(state, 'p1', { type: 'place', uid: 't1', zone: 'defense', slot: 0 })!;

    const squire = next.players.p1.zones.attack[0]!;
    expect(squire.buff).toEqual({ attack: 1, defense: 1 });
    const titan = next.players.p1.zones.defense[0]!;
    expect(titan.buff).toBeUndefined();
    expect(getMonsterStats(next.players.p1, squire, 'attack')).toEqual({ attack: 2, defense: 3 });
  });

  it('Vendu : Loup -> +1 PV (E8, plafonné à STARTING_HP)', () => {
    const state = baseState({ phase: 'main' });
    state.players.p1.hp = STARTING_HP - 1;
    state.players.p1.zones.attack[0] = makeCard('wolf', 'w1');

    const next = applyAction(state, 'p1', { type: 'sell', uid: 'w1' })!;
    expect(next.players.p1.hp).toBe(STARTING_HP); // plafonné, pas 21
  });

  it('Vendu/fusion : le buff est supprimé sur la carte qui part en défausse', () => {
    const state = baseState({ phase: 'main' });
    state.players.p1.zones.attack[0] = { uid: 'g1', cardId: 'guard', buff: { attack: 2, defense: 2 } };

    const next = applyAction(state, 'p1', { type: 'sell', uid: 'g1' })!;
    expect(next.players.p1.discard[0].buff).toBeUndefined();
  });

  it('Attaque : Loup (3 atq) contre un monstre -> +2 dégâts (bonusDamage) sans changer la riposte', () => {
    const state = baseState();
    state.players.p1.zones.attack[0] = makeCard('wolf', 'w1');
    state.players.p1.zones.attack[1] = makeCard('wolf', 'w2');
    state.players.p2.zones.defense[0] = makeCard('titan', 't1'); // 7 atq / 7 déf, pas de capacité de combat

    const { steps } = resolveCombat(state, 'p1');
    // 3 + 2 (bonusDamage) + 1 (élément : Loup terre > Titan eau), riposte inchangée.
    expect(steps[0]).toMatchObject({ damage: 6, retaliation: 7 });
  });

  it('Attaque : le Chevalier gagne +1 attaque à chaque cycle, buff conservé au combat suivant', () => {
    const state = baseState();
    state.players.p1.zones.attack[0] = makeCard('knight', 'k1'); // 4 atq / 4 déf
    state.players.p2.zones.defense[0] = makeCard('titan', 't1'); // 7 atq / 7 déf : encaisse plusieurs cycles

    resolveCombat(state, 'p1');
    const knight = state.players.p1.zones.attack[0]!;
    expect(knight.buff?.attack).toBeGreaterThanOrEqual(1);
    const attacksLanded = knight.buff!.attack;

    // Combat suivant : le buff est toujours là et continue de grandir.
    state.players.p1.zones.attack[0] = knight; // même instance, buff conservé (E9)
    state.players.p2.zones.defense[0] = makeCard('titan', 't2');
    resolveCombat(state, 'p1');
    expect(knight.buff!.attack).toBeGreaterThan(attacksLanded);
  });

  it('Défend : le Garde absorbe une partie du coup à chaque cycle, sa riposte est inchangée', () => {
    const state = baseState();
    state.players.p1.zones.attack[0] = makeCard('archer', 'a1'); // 3 atq / 2 déf
    state.players.p2.zones.defense[0] = makeCard('guard', 'g1'); // 1 atq / 4 déf, Défend : shield 1

    const { steps } = resolveCombat(state, 'p1');
    expect(steps[0]).toMatchObject({ damage: 2, remaining: 2, retaliation: 1 }); // 3 - 1 (shield)
  });

  it("Défend : Golem inflige des dégâts au héros adverse dès la riposte, peut faire perdre l'attaquant avant tout coup", () => {
    const state = baseState({ phase: 'main', turnNumber: 4 });
    state.players.p1.hp = 1; // l'attaquant actif
    state.players.p1.zones.attack[0] = makeCard('squire', 'a1');
    state.players.p2.zones.defense[0] = makeCard('golem', 'g1'); // Défend : 1 dégât au héros adverse

    const next = applyAction(state, 'p1', { type: 'endTurn' })!;

    expect(next.winner).toBe('p2');
    expect(next.players.p1.hp).toBe(0);
    // H9 généralisé (E7) : ni le tour ni la phase ne changent.
    expect(next.turn).toBe('p1');
    expect(next.phase).toBe('main');
    const step = next.lastEvent as Extract<typeof next.lastEvent, { type: 'combat' }>;
    expect(step.steps[0]).toMatchObject({ damage: 0, retaliation: 0 });
  });

  it("KO : l'Écuyer défenseur mis KO pioche la carte du dessus de son deck ; deck vide -> rien", () => {
    const state = baseState();
    state.players.p1.zones.attack[0] = makeCard('titan', 't1'); // 7 atq, tue l'écuyer d'un coup
    state.players.p2.zones.defense[0] = makeCard('squire', 's1');
    state.players.p2.deck = [makeCard('rampart', 'top')];

    resolveCombat(state, 'p1');
    expect(state.players.p2.hand.map((c) => c.uid)).toEqual(['top']);
    expect(state.players.p2.deck).toEqual([]);

    const emptyDeckState = baseState();
    emptyDeckState.players.p1.zones.attack[0] = makeCard('titan', 't1');
    emptyDeckState.players.p2.zones.defense[0] = makeCard('squire', 's1');
    resolveCombat(emptyDeckState, 'p1');
    expect(emptyDeckState.players.p2.hand).toEqual([]);
  });

  it("KO : l'Écuyer attaquant mis KO par riposte pioche aussi (son propriétaire est le joueur actif)", () => {
    const state = baseState();
    state.players.p1.zones.attack[0] = makeCard('squire', 's1'); // 1 atq / 2 déf
    state.players.p1.deck = [makeCard('rampart', 'top')];
    state.players.p2.zones.defense[0] = makeCard('titan', 't1'); // riposte 7 : tue l'écuyer

    resolveCombat(state, 'p1');
    expect(state.players.p1.hand.map((c) => c.uid)).toEqual(['top']);
  });

  it('KO : déclenché une seule fois par combat même si le combat continue', () => {
    const state = baseState();
    state.players.p1.zones.attack[0] = makeCard('titan', 't1'); // tue le défenseur immédiatement
    state.players.p1.zones.attack[1] = makeCard('archer', 'a1'); // frappera en percée, pas le même défenseur
    state.players.p2.zones.defense[0] = makeCard('squire', 's1');
    state.players.p2.deck = [makeCard('rampart', 'x1'), makeCard('rampart', 'x2')];

    resolveCombat(state, 'p1');
    // Une seule pioche malgré 2 attaquants dans le combat : le KO de l'écuyer ne se
    // déclenche qu'une fois (il n'est plus une cible valide ensuite).
    expect(state.players.p2.hand).toHaveLength(1);
  });

  it('KO : Drake -> +2 PV (plafond STARTING_HP)', () => {
    const state = baseState();
    state.players.p1.hp = STARTING_HP - 1;
    state.players.p1.zones.attack[0] = makeCard('drake', 'd1'); // 5 atq / 4 déf
    state.players.p2.zones.defense[0] = makeCard('titan', 't1'); // riposte 7 : tue le drake

    resolveCombat(state, 'p1');
    expect(state.players.p1.hp).toBe(STARTING_HP); // plafonné
  });

  it('Ordre des effets dans un échange : Attaque puis KO du défenseur (E5, E2)', () => {
    const state = baseState();
    state.players.p1.zones.attack[0] = makeCard('knight', 'k1'); // Attaque : buff self
    state.players.p2.zones.defense[0] = makeCard('squire', 's1'); // KO : pioche (pas de Défend)

    const { steps } = resolveCombat(state, 'p1');
    expect(steps[0].effects.map((e) => e.trigger)).toEqual(['attack', 'ko']);
  });

  it('CombatStep.hp et hpBefore restent cohérents avec les PV finaux', () => {
    const state = baseState();
    state.players.p1.zones.attack[0] = makeCard('titan', 't1');
    state.players.p2 = { ...state.players.p2, hp: 20, zones: emptyZones() } as PlayerState;

    const next = applyAction(state, 'p1', { type: 'endTurn' })!;
    const combatEvent = next.lastEvent as Extract<typeof next.lastEvent, { type: 'combat' }>;
    expect(combatEvent.hpBefore).toEqual({ p1: STARTING_HP, p2: 20 });
    expect(combatEvent.steps.at(-1)!.hp).toEqual({ p1: next.players.p1.hp, p2: next.players.p2.hp });
  });

  it('Doré : un Écuyer doré posé donne toujours +1 pièce (E10 : les effets ne sont pas doublés)', () => {
    const state = baseState({ phase: 'main' });
    state.players.p1.coins = 0;
    state.players.p1.hand = [{ uid: 's1', cardId: 'squire', golden: true }];

    const next = applyAction(state, 'p1', { type: 'place', uid: 's1', zone: 'attack', slot: 0 })!;
    expect(next.players.p1.coins).toBe(1);
  });
});

describe('applyAction - endTurn', () => {
  it('après le combat, les zones sont identiques à avant (H1)', () => {
    const state = baseState({ phase: 'main' });
    state.players.p1.zones.attack[0] = makeCard('archer', 'atk');
    state.players.p2.zones.defense[0] = makeCard('titan', 'def');
    const zonesBefore = structuredClone(state.players.p2.zones);

    const next = applyAction(state, 'p1', { type: 'endTurn' });

    expect(next!.players.p2.zones).toEqual(zonesBefore);
    expect(next!.players.p1.zones).toEqual(state.players.p1.zones);
  });

  it('PV à 0 -> winner, PV = 0, le tour ne passe pas', () => {
    const state = baseState({ phase: 'main' });
    state.players.p1.zones.attack[0] = makeCard('titan', 'atk');
    state.players.p2.hp = 1;

    const next = applyAction(state, 'p1', { type: 'endTurn' });

    expect(next!.winner).toBe('p1');
    expect(next!.players.p2.hp).toBe(0);
    expect(next!.turn).toBe('p1');
    expect(next!.phase).toBe('main');
  });

  it('sinon : tour adverse, phase start, turnNumber + 1, événement combat', () => {
    const state = baseState({ phase: 'main', turnNumber: 4 });

    const next = applyAction(state, 'p1', { type: 'endTurn' });

    expect(next!.turn).toBe('p2');
    expect(next!.phase).toBe('start');
    expect(next!.turnNumber).toBe(5);
    expect(next!.lastEvent).toMatchObject({ type: 'combat', seat: 'p1', steps: [], stalemate: false });
  });

  it("premier tour de la partie : pas de combat, même avec des attaquants et aucun défenseur", () => {
    const state = baseState({ phase: 'main', turnNumber: 1 });
    state.players.p1.zones.attack[0] = makeCard('titan', 'atk');
    state.players.p1.zones.attack[1] = makeCard('knight', 'k1'); // Attaque : buff self
    expect(isFirstTurnOfGame(state)).toBe(true);

    const next = applyAction(state, 'p1', { type: 'endTurn' })!;

    expect(next.players.p2.hp).toBe(STARTING_HP);
    expect(next.players.p1.zones.attack[1]!.buff).toBeUndefined();
    expect(next.lastEvent).toMatchObject({ type: 'combat', seat: 'p1', steps: [], stalemate: false });
    expect(next.turn).toBe('p2');
    expect(next.turnNumber).toBe(2);

    // Le second joueur, lui, combat dès son premier tour.
    expect(isFirstTurnOfGame(next)).toBe(false);
  });

  it('applyAction renvoie null une fois winner défini', () => {
    const state = baseState({ phase: 'main', winner: 'p1' });
    expect(applyAction(state, 'p2', { type: 'endTurn' })).toBeNull();
  });

  it('refuse endTurn hors phase main', () => {
    const state = baseState({ phase: 'start' });
    expect(applyAction(state, 'p1', { type: 'endTurn' })).toBeNull();
  });
});

describe('partie simulée (invariants)', () => {
  it('un bot déterministe joue jusqu’à la victoire ou 200 tours sans violer les invariants', () => {
    let state = createInitialState(seededRandom(7));
    let iterations = 0;
    // Marge généreuse : un tour peut enchaîner plusieurs achats et poses avant `endTurn`.
    // H12 (backlog) : la partie peut ne jamais se terminer (défenses qui se régénèrent
    // entièrement, H1) — ce test vérifie les invariants à chaque action, pas la victoire.
    const maxIterations = 200 * 40;

    function checkInvariants(s: GameState) {
      for (const seat of ['p1', 'p2'] as Seat[]) {
        const p = s.players[seat];
        const placed =
          p.zones.attack.filter(Boolean).length +
          p.zones.defense.filter(Boolean).length +
          p.zones.enchant.filter(Boolean).length;
        expect(p.deck.length + p.market.length + p.hand.length + placed + p.discard.length).toBe(50);
        const uids = new Set([
          ...p.deck.map((c) => c.uid),
          ...p.market.map((c) => c.uid),
          ...p.hand.map((c) => c.uid),
          ...p.discard.map((c) => c.uid),
          ...p.zones.attack.filter((c): c is CardInstance => c !== null).map((c) => c.uid),
          ...p.zones.defense.filter((c): c is CardInstance => c !== null).map((c) => c.uid),
          ...p.zones.enchant.filter((c): c is CardInstance => c !== null).map((c) => c.uid),
        ]);
        expect(uids.size).toBe(50);
        expect(p.coins).toBeGreaterThanOrEqual(0);
        expect(p.zones.attack).toHaveLength(5);
        expect(p.zones.defense).toHaveLength(5);
        expect(p.zones.enchant).toHaveLength(3);
        expect(p.hp).toBeGreaterThanOrEqual(0);
        expect(p.hp).toBeLessThanOrEqual(20);
      }
      expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    }

    function firstLegalSlot(s: GameState, seat: Seat, zone: Zone): number | null {
      const zones = s.players[seat].zones[zone];
      const idx = zones.findIndex((slot) => slot === null);
      return idx === -1 ? null : idx;
    }

    while (state.winner === null && iterations < maxIterations) {
      iterations++;
      const seat = state.turn;

      if (state.phase === 'start') {
        state = applyAction(state, seat, { type: 'beginTurn' })!;
      } else {
        // Phase main : le marché reste ouvert tout du long, le bot achète d'abord si possible.
        const affordable = state.players[seat].market.find((c) => getCardDef(c.cardId).cost <= state.players[seat].coins);
        if (affordable) {
          state = applyAction(state, seat, { type: 'buy', uid: affordable.uid })!;
        } else {
          const card = state.players[seat].hand[0];
          if (!card) {
            state = applyAction(state, seat, { type: 'endTurn' })!;
          } else if (applyAction(state, seat, { type: 'fuse', uid: card.uid })) {
            // Une carte fusionnable ne peut pas être posée : le bot fusionne.
            state = applyAction(state, seat, { type: 'fuse', uid: card.uid })!;
          } else {
            const def = getCardDef(card.cardId);
            const zone: Zone = def.kind === 'enchantment' ? 'enchant' : 'attack';
            const slot = firstLegalSlot(state, seat, zone) ?? firstLegalSlot(state, seat, 'defense');
            if (slot === null) {
              state = applyAction(state, seat, { type: 'endTurn' })!;
            } else {
              const actualZone: Zone = zone === 'attack' && firstLegalSlot(state, seat, 'attack') === null ? 'defense' : zone;
              state = applyAction(state, seat, { type: 'place', uid: card.uid, zone: actualZone, slot })!;
            }
          }
        }
      }

      expect(state).not.toBeNull();
      checkInvariants(state);
    }

    // Les invariants ont été vérifiés après CHAQUE action ci-dessus, que la partie se
    // termine par une victoire ou que le cap d'itérations soit atteint (risque connu H12).
    expect(iterations).toBeGreaterThan(0);
  });
});
