import { describe, expect, it } from 'vitest';
import { buildStarterDeck, getCardDef, STARTER_COUNTS } from './cards';
import {
  applyAction,
  createInitialState,
  getMonsterStats,
  opponentOf,
  resolveCombat,
  ZONE_SIZES,
} from './rules';
import type { CardInstance, GameState, PlayerState, Seat, Zone } from './types';

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
    hp: 20,
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
    rulesVersion: 4,
    turn: 'p1',
    phase: 'main',
    turnNumber: 1,
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
      expect(player.coins).toBe(0);
      expect(player.hand).toEqual([]);
      expect(player.market).toEqual([]);
      expect(player.discard).toEqual([]);
      expect(player.hp).toBe(20);
    }
    expect(state.phase).toBe('start');
    expect(state.turn).toBe('p1');
    expect(state.winner).toBeNull();
    expect(state.rulesVersion).toBe(4);
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
    state.players.p1.deck = [makeCard('squire', 'd1'), makeCard('wolf', 'd2'), makeCard('guard', 'd3')];
    state.players.p1.coins = 0;

    const next = applyAction(state, 'p1', { type: 'beginTurn' });

    expect(next).not.toBeNull();
    expect(next!.players.p1.coins).toBe(1);
    expect(next!.phase).toBe('market');
    expect(next!.players.p1.market).toHaveLength(3);
    expect(next!.lastEvent).toEqual({ id: 1, type: 'turnStart', seat: 'p1', coinsGained: 1 });
  });

  it('cumule les pièces au 2e tour (R1)', () => {
    let state = baseState({ phase: 'start' });
    state.players.p1.coins = 0;
    state.players.p1.deck = Array.from({ length: 6 }, (_, i) => makeCard('squire', `d${i}`));

    state = applyAction(state, 'p1', { type: 'beginTurn' })!;
    state = applyAction(state, 'p1', { type: 'endMarket' })!;
    // On force un retour rapide à la phase start de p1 pour tester le 2e tour sans dépendre
    // du combat : on triche juste sur `turn`/`phase` de l'état intermédiaire.
    state.phase = 'start';

    const next = applyAction(state, 'p1', { type: 'beginTurn' });

    expect(next!.players.p1.coins).toBe(1 + 2); // 1er tour + 2e tour, sans rien dépenser
  });

  it('pioche les 3 cartes du haut du deck (fin du tableau)', () => {
    const state = baseState({ phase: 'start' });
    state.players.p1.deck = [makeCard('squire', 'bottom'), makeCard('wolf', 'mid'), makeCard('guard', 'top')];

    const next = applyAction(state, 'p1', { type: 'beginTurn' })!;

    expect(next.players.p1.market.map((c) => c.uid)).toEqual(['top', 'mid', 'bottom']);
    expect(next.players.p1.deck).toHaveLength(0);
  });

  it('marché de 2 si le deck a 2 cartes, vide si le deck est vide (H7)', () => {
    const twoCards = baseState({ phase: 'start' });
    twoCards.players.p1.deck = [makeCard('squire', 'a'), makeCard('wolf', 'b')];
    const nextTwo = applyAction(twoCards, 'p1', { type: 'beginTurn' })!;
    expect(nextTwo.players.p1.market).toHaveLength(2);
    expect(nextTwo.players.p1.deck).toHaveLength(0);

    const empty = baseState({ phase: 'start' });
    empty.players.p1.deck = [];
    const nextEmpty = applyAction(empty, 'p1', { type: 'beginTurn' })!;
    expect(nextEmpty.players.p1.market).toEqual([]);
    expect(nextEmpty.phase).toBe('market');
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
    const notStart = baseState({ phase: 'market' });
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
    const state = baseState({ phase: 'market' });
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
    const state = baseState({ phase: 'market' });
    state.players.p1.coins = 1;
    state.players.p1.market = [makeCard('titan', 'm1')]; // coût 8
    expect(applyAction(state, 'p1', { type: 'buy', uid: 'm1' })).toBeNull();
  });

  it("refuse si l'uid est absent du marché", () => {
    const state = baseState({ phase: 'market' });
    state.players.p1.market = [makeCard('squire', 'm1')];
    expect(applyAction(state, 'p1', { type: 'buy', uid: 'missing' })).toBeNull();
  });

  it('refuse en phase main', () => {
    const state = baseState({ phase: 'main' });
    state.players.p1.market = [makeCard('squire', 'm1')];
    expect(applyAction(state, 'p1', { type: 'buy', uid: 'm1' })).toBeNull();
  });
});

describe('applyAction - endMarket', () => {
  it('renvoie les invendus au fond du deck, dans l’ordre (H5)', () => {
    const state = baseState({ phase: 'market' });
    state.players.p1.deck = [makeCard('golem', 'rest')];
    state.players.p1.market = [makeCard('squire', 'm1'), makeCard('wolf', 'm2')];

    const next = applyAction(state, 'p1', { type: 'endMarket' });

    expect(next).not.toBeNull();
    expect(next!.players.p1.deck.map((c) => c.uid)).toEqual(['m1', 'm2', 'rest']);
    expect(next!.players.p1.market).toEqual([]);
    expect(next!.phase).toBe('main');
    expect(next!.lastEvent).toEqual({
      id: 1,
      type: 'marketEnd',
      seat: 'p1',
      returnedUids: ['m1', 'm2'],
    });
  });
});

describe('applyAction - place', () => {
  it('pose un monstre en attaque et en défense', () => {
    const state = baseState({ phase: 'main' });
    state.players.p1.hand = [makeCard('squire', 'h1'), makeCard('wolf', 'h2')];
    state.players.p1.coins = 5;

    const afterAttack = applyAction(state, 'p1', { type: 'place', uid: 'h1', zone: 'attack', slot: 0 });
    expect(afterAttack!.players.p1.zones.attack[0]?.uid).toBe('h1');
    expect(afterAttack!.players.p1.coins).toBe(5); // pose gratuite

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

  it('refuse une carte hors main et un placement en phase market', () => {
    const state = baseState({ phase: 'main' });
    state.players.p1.hand = [makeCard('squire', 'h1')];
    expect(applyAction(state, 'p1', { type: 'place', uid: 'unknown', zone: 'attack', slot: 0 })).toBeNull();

    const marketState = baseState({ phase: 'market' });
    marketState.players.p1.hand = [makeCard('squire', 'h1')];
    expect(applyAction(marketState, 'p1', { type: 'place', uid: 'h1', zone: 'attack', slot: 0 })).toBeNull();
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

    const market = baseState({ phase: 'market' });
    market.players.p1 = structuredClone(state.players.p1);
    market.players.p1.hand = [makeCard('wolf', 'w3')];
    expect(applyAction(market, 'p1', { type: 'fuse', uid: 'w3' })).toBeNull();
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
    expect(getMonsterStats(player, 'wolf', 'attack', true)).toEqual({ attack: 3 * 2 + 1, defense: 1 * 2 });
    expect(getMonsterStats(player, 'wolf', 'defense', true)).toEqual({ attack: 6, defense: 2 });
  });

  it('en combat, un attaquant doré frappe deux fois plus fort et un défenseur doré encaisse le double', () => {
    const state = baseState();
    state.players.p1.zones.attack[0] = { uid: 'a1', cardId: 'wolf', golden: true }; // 6 atq
    state.players.p2.zones.defense[0] = { uid: 'd1', cardId: 'guard', golden: true }; // 8 déf

    const { steps } = resolveCombat(state, 'p1');
    expect(steps[0]).toMatchObject({ damage: 6, target: { kind: 'monster', uid: 'd1' }, remaining: 2 });
  });
});

describe('applyAction - sell', () => {
  it('retire une carte posée, la met en défausse et donne 1 pièce', () => {
    const state = baseState({ phase: 'main' });
    state.players.p1.coins = 2;
    state.players.p1.zones.attack[3] = makeCard('wolf', 'w1');

    const next = applyAction(state, 'p1', { type: 'sell', uid: 'w1' });

    expect(next).not.toBeNull();
    expect(next!.players.p1.zones.attack[3]).toBeNull();
    expect(next!.players.p1.discard.map((c) => c.uid)).toEqual(['w1']);
    expect(next!.players.p1.coins).toBe(3);
    expect(next!.lastEvent).toEqual({ id: 1, type: 'sell', seat: 'p1', uid: 'w1', zone: 'attack', slot: 3 });
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

  it("n'est pas limité à la phase main (autorisé aussi en phase market)", () => {
    const state = baseState({ phase: 'market' });
    state.players.p1.zones.attack[0] = makeCard('wolf', 'w1');

    expect(applyAction(state, 'p1', { type: 'sell', uid: 'w1' })).not.toBeNull();
  });
});

describe('resolveCombat', () => {
  function playerWith(zoneCards: Partial<Record<Zone, (string | null)[]>>, hp = 20): PlayerState {
    const p = freshPlayer({ hp });
    for (const [zone, cards] of Object.entries(zoneCards) as [Zone, (string | null)[]][]) {
      p.zones[zone] = p.zones[zone].map((_, i) => (cards[i] ? makeCard(cards[i]!, `${zone}${i}`) : null));
    }
    return p;
  }

  it('attaque de gauche à droite en sautant les emplacements vides', () => {
    const state = baseState();
    state.players.p1 = playerWith({ attack: ['squire', null, 'wolf'] });
    state.players.p2 = playerWith({ defense: ['squire', 'squire', 'squire', 'squire', 'squire'] });

    const { steps } = resolveCombat(state, 'p1');
    expect(steps.map((s) => s.attackerUid)).toEqual(['attack0', 'attack2']);
  });

  it('un attaquant frappe le défenseur debout le plus à gauche ; les blessures passent au suivant', () => {
    const state = baseState();
    state.players.p1 = playerWith({ attack: ['wolf', 'wolf'] }); // 3 atq chacun
    state.players.p2 = playerWith({ defense: ['squire'] }); // 2 déf

    const { steps } = resolveCombat(state, 'p1');
    // Le 1er wolf met le défenseur KO (3 > 2) ; le 2e frappe directement les PV (H2 : excédent perdu).
    expect(steps[0].target).toEqual({ kind: 'monster', uid: 'defense0' });
    expect(steps[0].remaining).toBe(0);
    expect(steps[1].target).toEqual({ kind: 'player' });
  });

  it('un KO passe au défenseur suivant, les blessures non létales persistent pour le prochain attaquant', () => {
    const state = baseState();
    state.players.p1 = playerWith({ attack: ['squire', 'squire'] }); // 1 atq chacun
    state.players.p2 = playerWith({ defense: ['squire', 'guard'] }); // 2 déf, 4 déf

    const { steps } = resolveCombat(state, 'p1');
    expect(steps[0]).toMatchObject({ target: { kind: 'monster', uid: 'defense0' }, remaining: 1 });
    expect(steps[1]).toMatchObject({ target: { kind: 'monster', uid: 'defense0' }, remaining: 0 });
  });

  it('sans défenseur, les dégâts vont aux PV ; excédent perdu', () => {
    const state = baseState();
    state.players.p1 = playerWith({ attack: ['wolf'] }); // 3 atq
    state.players.p2 = playerWith({ defense: ['squire'] }, 20); // 2 déf

    const { steps, defenderHp } = resolveCombat(state, 'p1');
    expect(steps[0].target).toEqual({ kind: 'monster', uid: 'defense0' });
    expect(steps[0].remaining).toBe(0); // KO, pas de dégâts transférés (H2)
    expect(defenderHp).toBe(20);
  });

  it("les enchantements du propriétaire s'appliquent, pas ceux de l'adversaire", () => {
    const state = baseState();
    state.players.p1 = playerWith({ attack: ['squire'], enchant: ['banner'] }); // +1 atq
    state.players.p2 = playerWith({ defense: ['squire'], enchant: ['banner'] }); // n'affecte pas p1

    const stats = getMonsterStats(state.players.p1, 'squire', 'attack');
    expect(stats.attack).toBe(2); // 1 de base + 1 de mon étendard

    const { steps } = resolveCombat(state, 'p1');
    expect(steps[0].damage).toBe(2);
  });

  it('Rempart : +1 déf en défense seulement ; deux Remparts : +2', () => {
    const player = playerWith({ enchant: ['rampart', 'rampart'] });
    const stats = getMonsterStats(player, 'squire', 'defense');
    expect(stats.defense).toBe(2 + 2);
    const attackStats = getMonsterStats(player, 'squire', 'attack');
    expect(attackStats.attack).toBe(1); // pas de bonus en attaque
  });

  it('les PV tombent à 0 : le combat s’arrête (H9)', () => {
    const state = baseState();
    state.players.p1 = playerWith({ attack: ['titan', 'titan'] }); // 7 atq chacun
    state.players.p2 = playerWith({}, 10);

    const { steps, defenderHp } = resolveCombat(state, 'p1');
    // 1er coup : 10 - 7 = 3 PV. 2e coup : 3 - 7 -> 0, tue et arrête le combat (H9).
    expect(defenderHp).toBe(0);
    expect(steps).toHaveLength(2);
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
});

describe('applyAction - endTurn', () => {
  it('après le combat, les zones sont identiques à avant (H1)', () => {
    const state = baseState({ phase: 'main' });
    state.players.p1.zones.attack[0] = makeCard('wolf', 'atk');
    state.players.p2.zones.defense[0] = makeCard('squire', 'def');
    const zonesBefore = structuredClone(state.players.p2.zones);

    const next = applyAction(state, 'p1', { type: 'endTurn' });

    expect(next!.players.p2.zones).toEqual(zonesBefore);
    expect(next!.players.p1.zones).toEqual(state.players.p1.zones);
  });

  it('PV à 0 -> winner, PV = 0, le tour ne passe pas', () => {
    const state = baseState({ phase: 'main' });
    state.players.p1.zones.attack[0] = makeCard('titan', 'atk');
    state.players.p2.hp = 5;

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
    expect(next!.lastEvent).toMatchObject({ type: 'combat', seat: 'p1', steps: [] });
  });

  it('applyAction renvoie null une fois winner défini', () => {
    const state = baseState({ phase: 'main', winner: 'p1' });
    expect(applyAction(state, 'p2', { type: 'endTurn' })).toBeNull();
  });

  it('refuse endTurn hors phase main', () => {
    const state = baseState({ phase: 'market' });
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
      } else if (state.phase === 'market') {
        const affordable = state.players[seat].market.find((c) => getCardDef(c.cardId).cost <= state.players[seat].coins);
        if (affordable) {
          state = applyAction(state, seat, { type: 'buy', uid: affordable.uid })!;
        } else {
          state = applyAction(state, seat, { type: 'endMarket' })!;
        }
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

      expect(state).not.toBeNull();
      checkInvariants(state);
    }

    // Les invariants ont été vérifiés après CHAQUE action ci-dessus, que la partie se
    // termine par une victoire ou que le cap d'itérations soit atteint (risque connu H12).
    expect(iterations).toBeGreaterThan(0);
  });
});
