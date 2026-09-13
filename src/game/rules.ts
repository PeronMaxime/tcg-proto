// Règles v1 — voir PLAN-tcg-proto-regles-v1.md ; hypothèses marquées `Hn`.
// Module pur : pas d'accès réseau, pas de React, pas de Date.now(). Le seul hasard
// (mélange des decks) passe par le paramètre `random` pour rester testable.

import { buildStarterDeck, getCardDef, isMonster } from './cards';
import type {
  Action,
  CombatStep,
  CombatTarget,
  GameState,
  MonsterZone,
  PlayerState,
  Seat,
  Slot,
  Zone,
} from './types';

export const RULES_VERSION = 2;
export const STARTING_HP = 20;
export const MARKET_SIZE = 3;
export const ZONE_SIZES: Record<Zone, number> = { attack: 5, defense: 5, enchant: 3 };

function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function opponentOf(seat: Seat): Seat {
  return seat === 'p1' ? 'p2' : 'p1';
}

function emptyZones(): Record<Zone, Slot[]> {
  return {
    attack: new Array(ZONE_SIZES.attack).fill(null),
    defense: new Array(ZONE_SIZES.defense).fill(null),
    enchant: new Array(ZONE_SIZES.enchant).fill(null),
  };
}

export function createInitialState(random: () => number = Math.random): GameState {
  let uidCounter = 0;
  const makeUid = () => `c${uidCounter++}`;

  function freshPlayer(): PlayerState {
    return {
      hp: STARTING_HP,
      coins: 0,
      turnsPlayed: 0,
      deck: shuffle(buildStarterDeck(makeUid), random),
      market: [],
      hand: [],
      zones: emptyZones(),
    };
  }

  // H6 : pas de main de départ, p1 (créateur de la room) commence. `beginTurn` (T3)
  // démarre le premier tour comme tous les autres — pas de mise en place ici.
  return {
    rulesVersion: RULES_VERSION,
    turn: 'p1',
    phase: 'start',
    turnNumber: 1,
    players: { p1: freshPlayer(), p2: freshPlayer() },
    winner: null,
    eventSeq: 0,
    lastEvent: null,
  };
}

// Stats effectives d'un monstre : base + somme des `monsterBuff` des enchantements posés
// par SON propriétaire (R3 : les effets se cumulent et ne touchent que le board de leur
// propriétaire).
export function getMonsterStats(
  player: PlayerState,
  cardId: string,
  zone: MonsterZone,
): { attack: number; defense: number } {
  const def = getCardDef(cardId);
  if (!isMonster(def)) throw new Error(`Carte non-monstre: ${cardId}`);

  let attack = def.attack;
  let defense = def.defense;
  for (const slot of player.zones.enchant) {
    if (!slot) continue;
    const enchantDef = getCardDef(slot.cardId);
    if (enchantDef.kind !== 'enchantment') continue;
    const effect = enchantDef.effect;
    if (effect.type === 'monsterBuff' && (effect.zone === 'all' || effect.zone === zone)) {
      attack += effect.attack;
      defense += effect.defense;
    }
  }
  return { attack, defense };
}

function coinsPerTurnBonus(player: PlayerState): number {
  let bonus = 0;
  for (const slot of player.zones.enchant) {
    if (!slot) continue;
    const def = getCardDef(slot.cardId);
    if (def.kind === 'enchantment' && def.effect.type === 'coinsPerTurn') {
      bonus += def.effect.amount;
    }
  }
  return bonus;
}

export function isActionLegal(state: GameState, seat: Seat, action: Action): boolean {
  if (state.winner !== null) return false;
  if (state.turn !== seat) return false;

  const player = state.players[seat];
  switch (action.type) {
    case 'beginTurn':
      return state.phase === 'start';

    case 'buy': {
      if (state.phase !== 'market') return false;
      const card = player.market.find((c) => c.uid === action.uid);
      if (!card) return false;
      return getCardDef(card.cardId).cost <= player.coins;
    }

    case 'endMarket':
      return state.phase === 'market';

    case 'place': {
      if (state.phase !== 'main') return false;
      const card = player.hand.find((c) => c.uid === action.uid);
      if (!card) return false;
      const size = ZONE_SIZES[action.zone];
      if (!Number.isInteger(action.slot) || action.slot < 0 || action.slot >= size) return false;
      // H10 : pas de défausse, vente ni retrait d'une carte posée — si toutes les zones
      // légales sont pleines, cette action est simplement refusée et la carte reste en main.
      if (player.zones[action.zone][action.slot] !== null) return false;
      const def = getCardDef(card.cardId);
      if (action.zone === 'enchant') return def.kind === 'enchantment';
      return def.kind === 'monster';
    }

    case 'endTurn':
      return state.phase === 'main';
  }
}

function applyBeginTurn(next: GameState, seat: Seat): void {
  const player = next.players[seat];
  player.turnsPlayed += 1;
  const gain = player.turnsPlayed + coinsPerTurnBonus(player); // R1 : base sur le n-ième tour DE CE JOUEUR
  player.coins += gain;

  const drawCount = Math.min(MARKET_SIZE, player.deck.length); // H7
  const market = [];
  for (let i = 0; i < drawCount; i++) {
    market.push(player.deck.pop()!);
  }
  player.market = market;

  next.phase = 'market';
  next.lastEvent = { id: next.eventSeq, type: 'turnStart', seat, coinsGained: gain };
}

function applyBuy(next: GameState, seat: Seat, uid: string): void {
  const player = next.players[seat];
  const idx = player.market.findIndex((c) => c.uid === uid);
  const card = player.market[idx];
  player.market.splice(idx, 1);
  player.coins -= getCardDef(card.cardId).cost;
  player.hand.push(card);
  next.lastEvent = { id: next.eventSeq, type: 'buy', seat, uid };
}

function applyEndMarket(next: GameState, seat: Seat): void {
  const player = next.players[seat];
  // H5 : les invendus retournent au fond du deck, dans l'ordre du marché (index 0 en premier
  // donc tout au fond ; la dernière carte du marché finit juste sous le dessus actuel).
  const returnedUids = player.market.map((c) => c.uid);
  player.deck = [...player.market, ...player.deck];
  player.market = [];
  next.phase = 'main';
  next.lastEvent = { id: next.eventSeq, type: 'marketEnd', seat, returnedUids };
}

function applyPlace(next: GameState, seat: Seat, uid: string, zone: Zone, slot: number): void {
  const player = next.players[seat];
  const idx = player.hand.findIndex((c) => c.uid === uid);
  const card = player.hand[idx];
  player.hand.splice(idx, 1);
  // H3 : un monstre posé pendant la phase principale combat dès la phase de combat du même
  // tour — `place` ne fait qu'écrire dans `zones`, et `resolveCombat` (plus bas) lit l'état
  // des zones tel qu'il est au moment de l'appel, donc juste après la phase principale.
  player.zones[zone][slot] = card;
  next.lastEvent = { id: next.eventSeq, type: 'place', seat, uid, zone, slot };
}

interface CombatResult {
  steps: CombatStep[];
  defenderHp: number;
}

// Combat automatique (auto-battler) : les attaquants de `attackerSeat`, de gauche à droite,
// frappent le défenseur adverse debout le plus à gauche (R4), ou les PV s'il n'y en a plus.
// H8 : le défenseur ne riposte jamais — seule l'attaque effective de l'attaquant compte,
// aucun dégât n'est renvoyé vers son propre camp.
export function resolveCombat(state: GameState, attackerSeat: Seat): CombatResult {
  const defenderSeat = opponentOf(attackerSeat);
  const attackerPlayer = state.players[attackerSeat];
  const defenderPlayer = state.players[defenderSeat];

  const attackers = attackerPlayer.zones.attack
    .map((slot, index) => (slot ? { uid: slot.uid, cardId: slot.cardId, index } : null))
    .filter((a): a is { uid: string; cardId: string; index: number } => a !== null);

  const defenders = defenderPlayer.zones.defense
    .map((slot, index) =>
      slot ? { uid: slot.uid, current: getMonsterStats(defenderPlayer, slot.cardId, 'defense').defense, index } : null,
    )
    .filter((d): d is { uid: string; current: number; index: number } => d !== null && d.current > 0);

  const steps: CombatStep[] = [];
  let pv = defenderPlayer.hp;

  for (const attacker of attackers) {
    const atk = Math.max(0, getMonsterStats(attackerPlayer, attacker.cardId, 'attack').attack);
    const target = defenders.find((d) => d.current > 0);

    if (target) {
      target.current = Math.max(0, target.current - atk); // H2 : excédent perdu
      const combatTarget: CombatTarget = { kind: 'monster', uid: target.uid };
      steps.push({ attackerUid: attacker.uid, target: combatTarget, damage: atk, remaining: target.current });
    } else {
      pv = Math.max(0, pv - atk);
      const combatTarget: CombatTarget = { kind: 'player' };
      steps.push({ attackerUid: attacker.uid, target: combatTarget, damage: atk, remaining: pv });
      if (pv === 0) break; // H9 : le combat s'arrête dès que les PV tombent à 0
    }
  }

  return { steps, defenderHp: pv };
}

function applyEndTurn(next: GameState, seat: Seat): void {
  const defenderSeat = opponentOf(seat);
  const { steps, defenderHp } = resolveCombat(next, seat);
  next.players[defenderSeat].hp = defenderHp; // H1 : aucune blessure ne persiste sur les monstres
  next.lastEvent = { id: next.eventSeq, type: 'combat', seat, steps };

  if (defenderHp === 0) {
    next.winner = seat; // H9 : ni changement de tour ni de phase
    return;
  }

  next.turn = defenderSeat;
  next.phase = 'start';
  next.turnNumber += 1;
}

export function applyAction(state: GameState, seat: Seat, action: Action): GameState | null {
  if (!isActionLegal(state, seat, action)) return null;

  const next = structuredClone(state);
  next.eventSeq += 1;

  switch (action.type) {
    case 'beginTurn':
      applyBeginTurn(next, seat);
      break;
    case 'buy':
      applyBuy(next, seat, action.uid);
      break;
    case 'endMarket':
      applyEndMarket(next, seat);
      break;
    case 'place':
      applyPlace(next, seat, action.uid, action.zone, action.slot);
      break;
    case 'endTurn':
      applyEndTurn(next, seat);
      break;
  }

  return next;
}
