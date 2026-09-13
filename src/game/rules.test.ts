import { describe, expect, it } from 'vitest';
import { getCardDef } from './cards';
import { applyAction, createInitialState } from './rules';
import type { CardInstance, GameState } from './types';

// PRNG déterministe pour des tests reproductibles (mélange du deck).
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeCard(cardId: string, overrides: Partial<CardInstance> = {}): CardInstance {
  const def = getCardDef(cardId);
  return {
    uid: cardId,
    cardId,
    attack: def.attack,
    health: def.health,
    maxHealth: def.health,
    canAttack: false,
    ...overrides,
  };
}

function baseState(): GameState {
  return {
    turn: 'p1',
    turnNumber: 1,
    players: {
      p1: { hp: 20, mana: 5, maxMana: 5, deck: [], hand: [], board: [] },
      p2: { hp: 20, mana: 5, maxMana: 5, deck: [], hand: [], board: [] },
    },
    winner: null,
    eventSeq: 0,
    lastEvent: null,
    lastDeaths: [],
  };
}

describe('createInitialState', () => {
  it('met en place les mains et le mana de départ', () => {
    const state = createInitialState(seededRandom(1));

    // p1 pioche 3 puis 1 (début de tour) = 4 ; p2 pioche 4 et attend son tour.
    expect(state.players.p1.hand).toHaveLength(4);
    expect(state.players.p2.hand).toHaveLength(4);
    expect(state.players.p1.deck).toHaveLength(16);
    expect(state.players.p2.deck).toHaveLength(16);
    expect(state.players.p1.mana).toBe(1);
    expect(state.players.p1.maxMana).toBe(1);
    expect(state.players.p2.mana).toBe(0);
    expect(state.turn).toBe('p1');
    expect(state.turnNumber).toBe(1);
    expect(state.winner).toBeNull();
  });
});

describe('applyAction - play', () => {
  it('refuse si le mana est insuffisant', () => {
    const state = baseState();
    state.players.p1.mana = 3;
    state.players.p1.hand = [makeCard('titan', { uid: 'h1' })]; // coût 8

    expect(applyAction(state, 'p1', { type: 'play', uid: 'h1' })).toBeNull();
  });

  it('refuse si le plateau est plein', () => {
    const state = baseState();
    state.players.p1.mana = 10;
    state.players.p1.hand = [makeCard('squire', { uid: 'h1' })];
    state.players.p1.board = Array.from({ length: 7 }, (_, i) => makeCard('squire', { uid: `b${i}` }));

    expect(applyAction(state, 'p1', { type: 'play', uid: 'h1' })).toBeNull();
  });

  it('déplace la carte de la main au plateau et débite le mana', () => {
    const state = baseState();
    state.players.p1.mana = 5;
    state.players.p1.hand = [makeCard('knight', { uid: 'h1' })]; // coût 4

    const next = applyAction(state, 'p1', { type: 'play', uid: 'h1' });

    expect(next).not.toBeNull();
    expect(next!.players.p1.mana).toBe(1);
    expect(next!.players.p1.hand).toHaveLength(0);
    expect(next!.players.p1.board).toHaveLength(1);
    expect(next!.players.p1.board[0].canAttack).toBe(false);
    expect(next!.lastEvent).toEqual({ id: 1, type: 'play', seat: 'p1', uid: 'h1' });
  });
});

describe('applyAction - attack', () => {
  it('inflige des dégâts mutuels et tue les deux serviteurs', () => {
    const state = baseState();
    state.players.p1.board = [makeCard('wolf', { uid: 'atk', canAttack: true })]; // 3 atq / 1 pv
    state.players.p2.board = [makeCard('squire', { uid: 'def' })]; // 1 atq / 2 pv

    const next = applyAction(state, 'p1', {
      type: 'attack',
      attackerUid: 'atk',
      target: { kind: 'minion', uid: 'def' },
    });

    expect(next).not.toBeNull();
    expect(next!.players.p1.board).toHaveLength(0);
    expect(next!.players.p2.board).toHaveLength(0);
    expect(next!.lastDeaths).toHaveLength(2);
    expect(next!.lastDeaths.map((d) => d.owner).sort()).toEqual(['p1', 'p2']);
  });

  it('mène à la victoire quand le héros adverse tombe à 0 PV', () => {
    const state = baseState();
    state.players.p1.board = [makeCard('titan', { uid: 'atk', canAttack: true })]; // 8 atq
    state.players.p2.hp = 8;

    const next = applyAction(state, 'p1', {
      type: 'attack',
      attackerUid: 'atk',
      target: { kind: 'hero' },
    });

    expect(next!.players.p2.hp).toBe(0);
    expect(next!.winner).toBe('p1');
  });
});

describe('applyAction - tour', () => {
  it('refuse une action hors de son tour', () => {
    const state = baseState();
    state.turn = 'p2';

    expect(applyAction(state, 'p1', { type: 'endTurn' })).toBeNull();
  });

  it('vide lastDeaths dès l’action suivante', () => {
    const state = baseState();
    state.players.p1.board = [makeCard('wolf', { uid: 'atk', canAttack: true })];
    state.players.p2.board = [makeCard('squire', { uid: 'def' })];

    const afterAttack = applyAction(state, 'p1', {
      type: 'attack',
      attackerUid: 'atk',
      target: { kind: 'minion', uid: 'def' },
    });
    expect(afterAttack!.lastDeaths).toHaveLength(2);

    const afterEndTurn = applyAction(afterAttack!, 'p1', { type: 'endTurn' });
    expect(afterEndTurn!.lastDeaths).toEqual([]);
  });

  it('ne pioche rien si le deck est vide en début de tour', () => {
    const state = baseState();
    state.turn = 'p2';
    state.players.p1.deck = [];
    state.players.p1.hand = [];
    state.players.p1.mana = 0;
    state.players.p1.maxMana = 0;

    const next = applyAction(state, 'p2', { type: 'endTurn' });

    expect(next).not.toBeNull();
    expect(next!.players.p1.hand).toHaveLength(0);
    expect(next!.players.p1.mana).toBe(1);
  });
});
