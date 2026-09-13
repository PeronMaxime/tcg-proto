// Règles PROVISOIRES du prototype, à remplacer par les vraies règles du jeu.
// Module pur : pas d'accès réseau, pas de React, pas de Date.now(). Le seul hasard
// (mélange des decks) passe par le paramètre `random` pour rester testable.

import { buildStarterDeck, getCardDef } from './cards';
import type { Action, CardInstance, GameState, PlayerState, Seat, Target } from './types';

const STARTING_HP = 20;
const MAX_MANA = 10;
const MAX_BOARD_SIZE = 7;
const MAX_HAND_SIZE = 10;

function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function drawOne(player: PlayerState): void {
  const card = player.deck.pop();
  if (!card) return; // deck vide : rien ne se passe
  if (player.hand.length >= MAX_HAND_SIZE) return; // main pleine : la carte est brûlée
  player.hand.push(card);
}

function startTurn(state: GameState, seat: Seat): void {
  const player = state.players[seat];
  player.maxMana = Math.min(player.maxMana + 1, MAX_MANA);
  player.mana = player.maxMana;
  drawOne(player);
  for (const card of player.board) card.canAttack = true;
}

function opponentOf(seat: Seat): Seat {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function createInitialState(random: () => number = Math.random): GameState {
  let uidCounter = 0;
  const makeUid = () => `c${uidCounter++}`;

  const players: Record<Seat, PlayerState> = {
    p1: {
      hp: STARTING_HP,
      mana: 0,
      maxMana: 0,
      deck: shuffle(buildStarterDeck(makeUid), random),
      hand: [],
      board: [],
    },
    p2: {
      hp: STARTING_HP,
      mana: 0,
      maxMana: 0,
      deck: shuffle(buildStarterDeck(makeUid), random),
      hand: [],
      board: [],
    },
  };

  for (let i = 0; i < 3; i++) drawOne(players.p1);
  for (let i = 0; i < 4; i++) drawOne(players.p2);

  const state: GameState = {
    turn: 'p1',
    turnNumber: 1,
    players,
    winner: null,
    eventSeq: 0,
    lastEvent: null,
    lastDeaths: [],
  };

  startTurn(state, 'p1');

  return state;
}

function isActionLegal(state: GameState, seat: Seat, action: Action): boolean {
  const player = state.players[seat];
  switch (action.type) {
    case 'play': {
      const card = player.hand.find((c) => c.uid === action.uid);
      if (!card) return false;
      if (player.board.length >= MAX_BOARD_SIZE) return false;
      return getCardDef(card.cardId).cost <= player.mana;
    }
    case 'attack': {
      const attacker = player.board.find((c) => c.uid === action.attackerUid);
      if (!attacker || !attacker.canAttack) return false;
      const target = action.target;
      if (target.kind === 'minion') {
        const targetCard = state.players[opponentOf(seat)].board.find((c) => c.uid === target.uid);
        if (!targetCard) return false;
      }
      return true;
    }
    case 'endTurn':
      return true;
  }
}

function applyPlay(next: GameState, seat: Seat, uid: string): void {
  const player = next.players[seat];
  const idx = player.hand.findIndex((c) => c.uid === uid);
  const card = player.hand[idx];
  player.hand.splice(idx, 1);
  player.mana -= getCardDef(card.cardId).cost;
  card.canAttack = false;
  player.board.push(card);
  next.lastEvent = { id: next.eventSeq, type: 'play', seat, uid };
}

function applyAttack(next: GameState, seat: Seat, attackerUid: string, target: Target): void {
  const opponentSeat = opponentOf(seat);
  const attackerPlayer = next.players[seat];
  const opponentPlayer = next.players[opponentSeat];
  const attacker = attackerPlayer.board.find((c) => c.uid === attackerUid) as CardInstance;
  attacker.canAttack = false;

  if (target.kind === 'hero') {
    opponentPlayer.hp = Math.max(0, opponentPlayer.hp - attacker.attack);
    if (opponentPlayer.hp <= 0) next.winner = seat;
  } else {
    const targetCard = opponentPlayer.board.find((c) => c.uid === target.uid) as CardInstance;
    const attackerDamage = attacker.attack;
    const targetDamage = targetCard.attack;
    targetCard.health -= attackerDamage;
    attacker.health -= targetDamage;

    if (targetCard.health <= 0) {
      opponentPlayer.board = opponentPlayer.board.filter((c) => c.uid !== targetCard.uid);
      next.lastDeaths.push({ owner: opponentSeat, card: targetCard });
    }
    if (attacker.health <= 0) {
      attackerPlayer.board = attackerPlayer.board.filter((c) => c.uid !== attacker.uid);
      next.lastDeaths.push({ owner: seat, card: attacker });
    }
  }

  next.lastEvent = { id: next.eventSeq, type: 'attack', seat, attackerUid, target };
}

function applyEndTurn(next: GameState, seat: Seat): void {
  const opponentSeat = opponentOf(seat);
  next.turn = opponentSeat;
  next.turnNumber += 1;
  startTurn(next, opponentSeat);
  next.lastEvent = { id: next.eventSeq, type: 'turn', seat: opponentSeat };
}

export function applyAction(state: GameState, seat: Seat, action: Action): GameState | null {
  if (state.winner) return null;
  if (state.turn !== seat) return null;
  if (!isActionLegal(state, seat, action)) return null;

  const next = structuredClone(state);
  next.lastDeaths = [];
  next.eventSeq += 1;

  switch (action.type) {
    case 'play':
      applyPlay(next, seat, action.uid);
      break;
    case 'attack':
      applyAttack(next, seat, action.attackerUid, action.target);
      break;
    case 'endTurn':
      applyEndTurn(next, seat);
      break;
  }

  return next;
}
