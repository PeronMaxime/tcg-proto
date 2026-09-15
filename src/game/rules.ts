// Règles v1 — voir PLAN-tcg-proto-regles-v1.md ; hypothèses marquées `Hn`.
// Règles v2 (combat en cycles, riposte, capacités) — voir PLAN-effets-triggers.md ;
// nouvelles hypothèses marquées `En`.
// Module pur : pas d'accès réseau, pas de React, pas de Date.now(). Le seul hasard
// (mélange des decks) passe par le paramètre `random` pour rester testable.

import { buildStarterDeck, getCardDef, isElementEffective, isMonster } from './cards';
import type {
  Action,
  AbilityEffect,
  CardInstance,
  CombatStep,
  EffectLog,
  GameState,
  MonsterZone,
  PlayerState,
  Seat,
  Slot,
  Trigger,
  Zone,
} from './types';

export const RULES_VERSION = 7;
export const STARTING_HP = 10;
// Pièces en stock au début de la partie (demande utilisateur), avant le gain du 1er tour.
export const STARTING_COINS = 2;
// Pièce de départ en plus pour le second joueur (p2), contre l'avantage de jouer en premier.
export const SECOND_PLAYER_BONUS_COINS = 1;
// Dégâts infligés au héros par chaque attaquant qui perce (demande utilisateur) : fixes,
// quelle que soit son attaque effective.
export const BREAKTHROUGH_DAMAGE = 1;
export const MARKET_SIZE = 3;
export const ZONE_SIZES: Record<Zone, number> = { attack: 5, defense: 5, enchant: 3 };
// Fusion dorée (ajoutée à la demande de l'utilisateur) : une carte en main fusionne avec
// FUSION_COUNT - 1 exemplaires normaux du même monstre posés sur le board de son
// propriétaire (action `fuse`) ; elle devient un monstre doré, dont les stats de base sont
// multipliées par GOLDEN_MULTIPLIER.
export const FUSION_COUNT = 3;
export const GOLDEN_MULTIPLIER = 2;
// E16 : l'attaque effective d'un monstre vaut au moins 1 (c'est la stat qui est plancher,
// pas les dégâts — un `shield` peut encore réduire un coup à 0).
export const MIN_ATTACK = 1;
// E16 : filet de sécurité purement défensif contre un combat qui ne se terminerait jamais
// (aucun effet actuel ne peut réduire la riposte sous 1, donc ce cas n'est pas atteignable
// avec les règles actuelles ; il le sera peut-être avec de futures capacités).
export const MAX_COMBAT_CYCLES = 20;
// Éléments (demande utilisateur) : un monstre dont l'élément est efficace contre celui du
// monstre qu'il touche lui inflige ce bonus, sur le coup comme sur la riposte (mêlée
// seulement : le héros n'a pas d'élément, la percée n'en profite donc jamais).
export const ELEMENT_ADVANTAGE_BONUS = 1;

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

  function freshPlayer(bonusCoins = 0): PlayerState {
    return {
      hp: STARTING_HP,
      coins: STARTING_COINS + bonusCoins,
      turnsPlayed: 0,
      deck: shuffle(buildStarterDeck(makeUid), random),
      market: [],
      hand: [],
      zones: emptyZones(),
      discard: [],
    };
  }

  // H6 : pas de main de départ, p1 (créateur de la room) commence. `beginTurn` (T3)
  // démarre le premier tour comme tous les autres — pas de mise en place ici.
  return {
    rulesVersion: RULES_VERSION,
    turn: 'p1',
    phase: 'start',
    turnNumber: 1,
    players: { p1: freshPlayer(), p2: freshPlayer(SECOND_PLAYER_BONUS_COINS) },
    winner: null,
    eventSeq: 0,
    lastEvent: null,
  };
}

// Stats de base d'un monstre, avant enchantements : doublées pour un monstre doré.
export function getBaseMonsterStats(cardId: string, golden = false): { attack: number; defense: number } {
  const def = getCardDef(cardId);
  if (!isMonster(def)) throw new Error(`Carte non-monstre: ${cardId}`);
  const multiplier = golden ? GOLDEN_MULTIPLIER : 1;
  return { attack: def.attack * multiplier, defense: def.defense * multiplier };
}

// Stats effectives d'un monstre posé : base (doublée s'il est doré) + buff permanent (E9,
// non doublé) + somme des `monsterBuff` des enchantements posés par SON propriétaire (R3 :
// les effets se cumulent et ne touchent que le board de leur propriétaire, non doublés non
// plus). L'attaque a un plancher de `MIN_ATTACK` (E16) ; la défense n'en a pas (E17 : un
// monstre à défense ≤ 0 est filtré ailleurs, pas ici).
export function getMonsterStats(
  player: PlayerState,
  card: CardInstance,
  zone: MonsterZone,
): { attack: number; defense: number } {
  let { attack, defense } = getBaseMonsterStats(card.cardId, card.golden === true);
  if (card.buff) {
    attack += card.buff.attack;
    defense += card.buff.defense;
  }
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
  return { attack: Math.max(MIN_ATTACK, attack), defense };
}

// Exemplaires posés (attaque puis défense, de gauche à droite) avec lesquels `card` peut
// fusionner : même monstre, non dorés, sur le board de `player`.
function fusionPartners(player: PlayerState, card: CardInstance): { zone: MonsterZone; slot: number }[] {
  const partners: { zone: MonsterZone; slot: number }[] = [];
  for (const zone of ['attack', 'defense'] as MonsterZone[]) {
    player.zones[zone].forEach((s, slot) => {
      if (s && s.cardId === card.cardId && !s.golden) partners.push({ zone, slot });
    });
  }
  return partners;
}

// `card` (en main) est un monstre normal avec assez d'exemplaires posés pour fusionner.
function canFuse(player: PlayerState, card: CardInstance): boolean {
  if (card.golden || !isMonster(getCardDef(card.cardId))) return false;
  return fusionPartners(player, card).length >= FUSION_COUNT - 1;
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
      // Le marché reste accessible pendant toute la phase principale, jusqu'au combat
      // (demande utilisateur) : on peut vendre une carte posée pour racheter avec la pièce.
      if (state.phase !== 'main') return false;
      const card = player.market.find((c) => c.uid === action.uid);
      if (!card) return false;
      return getCardDef(card.cardId).cost <= player.coins;
    }

    case 'place': {
      if (state.phase !== 'main') return false;
      const card = player.hand.find((c) => c.uid === action.uid);
      if (!card) return false;
      const size = ZONE_SIZES[action.zone];
      if (!Number.isInteger(action.slot) || action.slot < 0 || action.slot >= size) return false;
      // H10 : pas de défausse ni de retrait gratuit d'une carte posée — si toutes les zones
      // légales sont pleines, cette action est simplement refusée et la carte reste en main.
      // (le retrait contre 1 pièce, `sell` ci-dessous, a été ajouté après coup à la demande
      // explicite de l'utilisateur : H10 ne portait que sur un retrait/une défausse gratuits.)
      if (player.zones[action.zone][action.slot] !== null) return false;
      const def = getCardDef(card.cardId);
      if (action.zone === 'enchant') return def.kind === 'enchantment';
      // Une carte qui peut fusionner (2 exemplaires normaux déjà posés) ne sert qu'à la
      // fusion : elle ne se pose pas (demande utilisateur).
      return def.kind === 'monster' && !canFuse(player, card);
    }

    case 'move': {
      // Repositionne une carte déjà posée à l'intérieur de SA zone (attaque ou défense)
      // uniquement : pas de changement de zone (demande utilisateur).
      if (state.phase !== 'main') return false;
      if (!Number.isInteger(action.slot)) return false;
      for (const zone of ['attack', 'defense'] as MonsterZone[]) {
        const from = player.zones[zone].findIndex((s) => s?.uid === action.uid);
        if (from === -1) continue;
        if (action.slot === from) return false; // pas de no-op
        if (action.slot < 0 || action.slot >= ZONE_SIZES[zone]) return false;
        return player.zones[zone][action.slot] === null;
      }
      return false;
    }

    case 'fuse': {
      // Ne demande pas d'emplacement libre : la carte dorée reste en main, à reposer ensuite
      // (on peut donc fusionner même avec un board plein).
      if (state.phase !== 'main') return false;
      const card = player.hand.find((c) => c.uid === action.uid);
      return card !== undefined && canFuse(player, card);
    }

    case 'sell':
      return (['attack', 'defense', 'enchant'] as Zone[]).some((zone) =>
        player.zones[zone].some((s) => s?.uid === action.uid),
      );

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

  next.phase = 'main';
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

function applyPlace(next: GameState, seat: Seat, uid: string, zone: Zone, slot: number): void {
  const player = next.players[seat];
  const idx = player.hand.findIndex((c) => c.uid === uid);
  const card = player.hand[idx];
  player.hand.splice(idx, 1);
  // H3 : un monstre posé pendant la phase principale combat dès la phase de combat du même
  // tour — `place` ne fait qu'écrire dans `zones`, et `resolveCombat` (plus bas) lit l'état
  // des zones tel qu'il est au moment de l'appel, donc juste après la phase principale.
  player.zones[zone][slot] = card;
  // E3 : Invoqué se déclenche après que la carte a rejoint le board (elle en fait donc partie).
  const effects = fireTrigger(next, seat, card, 'summon');
  next.lastEvent = { id: next.eventSeq, type: 'place', seat, uid, zone, slot, effects };
}

// Repositionne une carte déjà posée dans un autre emplacement libre de SA zone (attaque ou
// défense) : pas de déclenchement de capacité (la carte ne quitte pas le board, E3/E4 ne
// s'appliquent qu'à la pose/vente), pas de changement de zone (`isActionLegal` l'impose déjà).
function applyMove(next: GameState, seat: Seat, uid: string, slot: number): void {
  const player = next.players[seat];
  for (const zone of ['attack', 'defense'] as MonsterZone[]) {
    const from = player.zones[zone].findIndex((s) => s?.uid === uid);
    if (from === -1) continue;
    const card = player.zones[zone][from]!;
    player.zones[zone][from] = null;
    player.zones[zone][slot] = card;
    next.lastEvent = { id: next.eventSeq, type: 'move', seat, uid, zone, from, to: slot };
    return;
  }
}

// Fusion dorée : la carte en main devient dorée (elle reste en main) et absorbe les
// FUSION_COUNT - 1 premiers exemplaires posés, qui partent en défausse (le total de 50
// cartes par joueur reste donc intact). Un monstre doré ne fusionne plus.
function applyFuse(next: GameState, seat: Seat, uid: string): void {
  const player = next.players[seat];
  const card = player.hand.find((c) => c.uid === uid)!;
  const fusedUids: string[] = [];
  for (const { zone, slot } of fusionPartners(player, card).slice(0, FUSION_COUNT - 1)) {
    const absorbed = player.zones[zone][slot]!;
    player.zones[zone][slot] = null;
    clearBuff(absorbed); // E9 : le buff disparaît, la carte quitte le board (fusion)
    player.discard.push(absorbed);
    fusedUids.push(absorbed.uid);
  }
  card.golden = true;
  next.lastEvent = { id: next.eventSeq, type: 'fuse', seat, uid, fusedUids };
}

// Vente d'une carte posée : elle quitte son emplacement, rejoint la défausse (jamais
// mélangée au deck) et rapporte 1 pièce à son propriétaire (ajouté à la demande explicite
// de l'utilisateur, voir la note sur H10 plus haut).
function applySell(next: GameState, seat: Seat, uid: string): void {
  const player = next.players[seat];
  for (const zone of ['attack', 'defense', 'enchant'] as Zone[]) {
    const slot = player.zones[zone].findIndex((s) => s?.uid === uid);
    if (slot === -1) continue;
    const card = player.zones[zone][slot]!;
    player.zones[zone][slot] = null;
    clearBuff(card); // E9 : le buff disparaît, la carte quitte le board (vente)
    player.discard.push(card);
    player.coins += 1;
    // E4 : Vendu se déclenche après que la carte a quitté le board, la pièce versée, en défausse.
    const effects = fireTrigger(next, seat, card, 'sold');
    next.lastEvent = { id: next.eventSeq, type: 'sell', seat, uid, zone, slot, effects };
    return;
  }
}

// ---------------------------------------------------------------------------------------
// Effets déclenchés (§3.2-§3.3 du plan) — E1 à E12
// ---------------------------------------------------------------------------------------

// Seul point d'entrée des dégâts au héros (E7) : fixe le vainqueur au premier 0. Les appels
// une fois `winner` fixé sont des no-op (E7 : on arrête de résoudre quoi que ce soit).
function damageHero(state: GameState, seat: Seat, amount: number): void {
  if (state.winner !== null) return;
  const player = state.players[seat];
  player.hp = Math.max(0, player.hp - amount);
  if (player.hp === 0) state.winner = opponentOf(seat);
}

// E8 : soins plafonnés à STARTING_HP.
function healHero(state: GameState, seat: Seat, amount: number): void {
  const player = state.players[seat];
  player.hp = Math.min(STARTING_HP, player.hp + amount);
}

// E9 : buff permanent cumulable, stocké sur l'instance ; n'écrit rien pour un buff nul.
function addBuff(card: CardInstance, attack: number, defense: number): void {
  if (attack === 0 && defense === 0) return;
  card.buff = { attack: (card.buff?.attack ?? 0) + attack, defense: (card.buff?.defense ?? 0) + defense };
}

// E9 : le buff disparaît quand la carte quitte le board (vente, fusion) — jamais de champ
// `buff` explicite sur une carte qui n'en a pas.
function clearBuff(card: CardInstance): void {
  delete card.buff;
}

// E10 : les valeurs d'effet ne sont PAS doublées pour un monstre doré en v1 (seules les
// stats de base le sont, via `getBaseMonsterStats`). Centralisé ici pour pouvoir changer
// d'avis facilement sans toucher chaque site d'appel.
function effectAmount(_card: CardInstance, value: number): number {
  return value;
}

interface HitModifiers {
  bonusDamage: number;
  damageReduction: number;
}

function applyAbilityEffect(
  state: GameState,
  seat: Seat,
  card: CardInstance,
  effect: AbilityEffect,
  hit: HitModifiers | undefined,
): void {
  switch (effect.type) {
    case 'gainCoins':
      state.players[seat].coins += effectAmount(card, effect.amount);
      break;
    case 'damageOpponent':
      damageHero(state, opponentOf(seat), effectAmount(card, effect.amount));
      break;
    case 'healSelf':
      healHero(state, seat, effectAmount(card, effect.amount));
      break;
    case 'drawCard': {
      const player = state.players[seat];
      const count = effectAmount(card, effect.count);
      for (let i = 0; i < count; i++) {
        const drawn = player.deck.pop(); // E11 : le dessus du deck est la fin du tableau
        if (drawn) player.hand.push(drawn);
      }
      break;
    }
    case 'buff': {
      const attack = effectAmount(card, effect.attack);
      const defense = effectAmount(card, effect.defense);
      if (effect.target === 'self') {
        addBuff(card, attack, defense);
      } else {
        const player = state.players[seat];
        for (const zone of ['attack', 'defense'] as MonsterZone[]) {
          for (const slot of player.zones[zone]) {
            if (slot && slot.uid !== card.uid) addBuff(slot, attack, defense);
          }
        }
      }
      break;
    }
    case 'bonusDamage': // E12 : Attaque uniquement
      if (hit) hit.bonusDamage += effectAmount(card, effect.amount);
      break;
    case 'shield': // E12 : Défend uniquement
      if (hit) hit.damageReduction += effectAmount(card, effect.amount);
      break;
  }
}

// Résout toutes les capacités `trigger` de `card` (propriétaire `seat`), dans l'ordre du
// tableau `abilities` (E2), en mutant `state`. S'arrête dès que `state.winner` est fixé
// (E7). `hit` n'est fourni que pour Attaque / Défend ; `bonusDamage` / `shield` l'alimentent
// (E12).
function fireTrigger(
  state: GameState,
  seat: Seat,
  card: CardInstance,
  trigger: Trigger,
  hit?: HitModifiers,
): EffectLog[] {
  const def = getCardDef(card.cardId);
  const logs: EffectLog[] = [];
  for (const ability of def.abilities ?? []) {
    if (ability.trigger !== trigger) continue;
    if (state.winner !== null) break; // E7
    applyAbilityEffect(state, seat, card, ability.effect, hit);
    logs.push({ seat, sourceUid: card.uid, cardId: card.cardId, trigger, effect: ability.effect });
    if (state.winner !== null) break; // E7
  }
  return logs;
}

// ---------------------------------------------------------------------------------------
// Combat (§1bis, §3.5) — E13 à E17
// ---------------------------------------------------------------------------------------

interface Fighter {
  card: CardInstance;
  seat: Seat;
  damageTaken: number;
  ko: boolean;
}

// Défense restante = max(0, défense effective (relue à chaque fois, E9) − dégâts subis).
// H2 : l'excédent de dégâts au-delà de 0 est perdu, dans les deux sens (coup et riposte).
function currentDefense(state: GameState, fighter: Fighter, zone: MonsterZone): number {
  const effective = getMonsterStats(state.players[fighter.seat], fighter.card, zone).defense;
  return Math.max(0, effective - fighter.damageTaken);
}

function standingFighters(state: GameState, fighters: Fighter[], zone: MonsterZone): Fighter[] {
  return fighters.filter((f) => !f.ko && currentDefense(state, f, zone) > 0);
}

// E17 : un monstre dont la défense effective est ≤ 0 au début du combat n'y participe pas.
function buildFighters(state: GameState, seat: Seat, zone: MonsterZone): Fighter[] {
  const player = state.players[seat];
  const fighters: Fighter[] = [];
  for (const slot of player.zones[zone]) {
    if (!slot) continue;
    const fighter: Fighter = { card: slot, seat, damageTaken: 0, ko: false };
    if (currentDefense(state, fighter, zone) > 0) fighters.push(fighter);
  }
  return fighters;
}

// Bonus de dégât élémentaire de `from` quand il touche `against` (coup ou riposte).
export function elementBonus(from: CardInstance, against: CardInstance): number {
  const fromElement = getCardDef(from.cardId).element;
  const againstElement = getCardDef(against.cardId).element;
  return isElementEffective(fromElement, againstElement) ? ELEMENT_ADVANTAGE_BONUS : 0;
}

function snapshotHp(state: GameState): Record<Seat, number> {
  return { p1: state.players.p1.hp, p2: state.players.p2.hp };
}

export interface CombatResult {
  steps: CombatStep[];
  stalemate: boolean;
}

// Combat automatique (auto-battler) en cycles avec riposte (E13-E17) : les attaquants de
// `attackerSeat`, de gauche à droite, frappent le défenseur adverse debout le plus à gauche
// (R4) ; le défenseur ciblé riposte sur l'attaquant. Tant qu'il reste un attaquant ET un
// défenseur debout, un nouveau cycle démarre (E14). Quand tous les défenseurs sont tombés
// (ou qu'il n'y en avait aucun), les attaquants encore debout percent jusqu'au héros (E15).
// MUTE `state` directement (dégâts au héros, buffs, pièces, pioche...) : l'appelant doit lui
// passer un état déjà cloné (`applyEndTurn` lui passe `next`).
export function resolveCombat(state: GameState, attackerSeat: Seat): CombatResult {
  const defenderSeat = opponentOf(attackerSeat);
  const attackers = buildFighters(state, attackerSeat, 'attack');
  const defenders = buildFighters(state, defenderSeat, 'defense');

  const steps: CombatStep[] = [];
  let cycle = 0;
  let stalemate = false;

  // --- Mêlée (E14) ---
  while (
    state.winner === null &&
    standingFighters(state, attackers, 'attack').length > 0 &&
    standingFighters(state, defenders, 'defense').length > 0
  ) {
    if (cycle >= MAX_COMBAT_CYCLES) {
      stalemate = true; // E16 : filet de sécurité
      break;
    }
    cycle += 1;
    let damageThisCycle = 0;

    for (const attacker of attackers) {
      if (attacker.ko || currentDefense(state, attacker, 'attack') <= 0) continue;
      if (state.winner !== null) break; // E7
      const remainingDefenders = standingFighters(state, defenders, 'defense');
      // Le dernier défenseur est tombé en cours de cycle : la mêlée s'arrête immédiatement,
      // les attaquants suivants du cycle frapperont en percée (E14).
      if (remainingDefenders.length === 0) break;
      const target = remainingDefenders[0];

      const hit: HitModifiers = { bonusDamage: 0, damageReduction: 0 };
      let effects = fireTrigger(state, attackerSeat, attacker.card, 'attack', hit);
      if (state.winner === null) {
        effects = effects.concat(fireTrigger(state, defenderSeat, target.card, 'defend', hit));
      }

      let damage = 0;
      let retaliation = 0;
      let effective = false;
      let retaliationEffective = false;
      if (state.winner === null) {
        const attackerStats = getMonsterStats(state.players[attackerSeat], attacker.card, 'attack');
        const targetStats = getMonsterStats(state.players[defenderSeat], target.card, 'defense');
        // Le bonus élémentaire s'ajoute avant le bouclier, qui peut donc aussi l'absorber :
        // le coup n'est « efficace » que si le bonus a réellement augmenté les dégâts.
        const withoutElement = Math.max(0, attackerStats.attack + hit.bonusDamage - hit.damageReduction);
        damage = Math.max(
          0,
          attackerStats.attack + hit.bonusDamage + elementBonus(attacker.card, target.card) - hit.damageReduction,
        );
        effective = damage > withoutElement;
        // E13 : attaque effective du défenseur, plancher ≥ 1 (E16), + son bonus élémentaire.
        const retaliationBonus = elementBonus(target.card, attacker.card);
        retaliation = targetStats.attack + retaliationBonus;
        retaliationEffective = retaliationBonus > 0;
      }

      // Dégâts simultanés (E5, E13) : un défenseur mis KO par la riposte quand même.
      target.damageTaken += damage;
      attacker.damageTaken += retaliation;
      damageThisCycle += damage + retaliation;

      const targetRemaining = currentDefense(state, target, 'defense');
      if (targetRemaining === 0 && !target.ko) {
        target.ko = true;
        if (state.winner === null) effects = effects.concat(fireTrigger(state, defenderSeat, target.card, 'ko'));
      }
      const attackerRemaining = currentDefense(state, attacker, 'attack');
      if (attackerRemaining === 0 && !attacker.ko) {
        attacker.ko = true;
        if (state.winner === null) effects = effects.concat(fireTrigger(state, attackerSeat, attacker.card, 'ko'));
      }

      steps.push({
        cycle,
        attackerUid: attacker.card.uid,
        target: { kind: 'monster', uid: target.card.uid },
        damage,
        remaining: targetRemaining,
        retaliation,
        attackerRemaining,
        effective,
        retaliationEffective,
        effects,
        hp: snapshotHp(state),
      });
    }

    // E16 : un cycle complet sans le moindre dégât (des deux côtés) est un match nul.
    if (state.winner === null && damageThisCycle === 0) {
      stalemate = true;
      break;
    }
  }

  // --- Percée (E15), seulement si la mêlée s'est arrêtée faute de défenseur debout ---
  if (state.winner === null && !stalemate && standingFighters(state, defenders, 'defense').length === 0) {
    for (const attacker of attackers) {
      if (attacker.ko || currentDefense(state, attacker, 'attack') <= 0) continue;
      if (state.winner !== null) break; // E7

      // La percée n'est pas une attaque (demande utilisateur) : à la fin du combat, le héros
      // adverse perd BREAKTHROUGH_DAMAGE PV par attaquant encore debout. Aucune capacité ne se
      // déclenche, l'attaque du monstre ne compte pas, pas de riposte.
      const damage = BREAKTHROUGH_DAMAGE;
      damageHero(state, defenderSeat, damage);

      steps.push({
        cycle: cycle + 1,
        attackerUid: attacker.card.uid,
        target: { kind: 'player' },
        damage,
        remaining: state.players[defenderSeat].hp,
        retaliation: 0,
        attackerRemaining: currentDefense(state, attacker, 'attack'),
        effective: false, // le héros n'a pas d'élément
        retaliationEffective: false,
        effects: [],
        hp: snapshotHp(state),
      });
    }
  }

  return { steps, stalemate };
}

// Premier tour de la partie (celui de p1) : pas de phase de combat.
export function isFirstTurnOfGame(state: GameState): boolean {
  return state.turnNumber === 1;
}

function applyEndTurn(next: GameState, seat: Seat): void {
  const player = next.players[seat];
  // Le marché reste ouvert jusqu'ici (achats possibles pendant toute la phase principale) :
  // les invendus retournent au fond du deck, dans l'ordre du marché (H5), juste avant le combat.
  if (player.market.length > 0) {
    player.deck = [...player.market, ...player.deck];
    player.market = [];
  }

  const defenderSeat = opponentOf(seat);
  const hpBefore = snapshotHp(next);
  // Le premier joueur n'attaque pas à son premier tour (demande utilisateur, contre
  // l'avantage du premier joueur) : combat vide, aucun coup ni aucune capacité de combat.
  const { steps, stalemate } = isFirstTurnOfGame(next)
    ? { steps: [], stalemate: false }
    : resolveCombat(next, seat); // mute `next` (dégâts, buffs, pièces...)
  next.lastEvent = { id: next.eventSeq, type: 'combat', seat, steps, hpBefore, stalemate };

  if (next.winner !== null) return; // H9 : ni changement de tour ni de phase

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
    case 'place':
      applyPlace(next, seat, action.uid, action.zone, action.slot);
      break;
    case 'move':
      applyMove(next, seat, action.uid, action.slot);
      break;
    case 'fuse':
      applyFuse(next, seat, action.uid);
      break;
    case 'sell':
      applySell(next, seat, action.uid);
      break;
    case 'endTurn':
      applyEndTurn(next, seat);
      break;
  }

  return next;
}
