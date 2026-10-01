// Règles propres à la V2 (modifsV2.md) — voir aussi `game/versions.ts`. `rules.ts` reste le
// point d'entrée unique (l'interface n'appelle que lui) : il délègue ici dès que le catalogue
// actif est un catalogue V2 (`isV2Active`). La V1 ne passe jamais par ce module.
//
// Ce qui change en V2 :
// - l'ARMURE (`CardInstance.armor`) : absorbe les dégâts avant la défense, sauf contre Percée ;
//   elle ne se régénère pas d'un combat à l'autre (demande utilisateur) ;
// - les ÉTATS : gelé (ne participe pas à son prochain combat, puis dégèle à la fin de ce
//   combat) et brûlé (perd 1 défense définitivement à la fin de chacun de ses combats ; à 0, il
//   quitte le board pour le fond du deck — demande utilisateur) ;
// - les DÉPLACEMENTS par effet, y compris pendant le combat (« Change de zone »), et le
//   dépassement de la capacité d'une zone, réservé aux effets ;
// - les effets à CIBLE CHOISIE par le joueur (demande utilisateur : seulement sur Invoqué /
//   Vendu) : la résolution s'interrompt sur `GameState.pendingChoice` jusqu'à l'action
//   `chooseTarget` ;
// - le COMBAT : plus de bonus d'élément, Furie frappe deux fois, Portée inflige 1 dégât aux
//   voisins de la cible en déclenchant leurs effets « Défend », Toxic et Percée.
//
// Module pur, comme `rules.ts` (dont il partage les briques : import circulaire assumé, aucune
// des deux ne lit l'autre au chargement du module, seulement à l'appel des fonctions).

import {
  getCardDef,
  hasKeywordDef,
  KEYWORD_FURY_STRIKES_V2,
  KEYWORD_PROTECTION_USES,
  KEYWORD_REACH_DAMAGE_V2,
  scaleAbilityEffect,
  tokenCardId,
} from './cards';
import {
  BREAKTHROUGH_DAMAGE,
  damageHero,
  getMonsterStats,
  GOLDEN_MULTIPLIER,
  keywordLog,
  MAX_COMBAT_CYCLES,
  opponentOf,
  resolveCommonEffect,
  snapshotHp,
  writeZone,
  zoneCards,
  type CombatResult,
} from './rules';
import type {
  AbilityEffect,
  BoardSnapshot,
  CardInstance,
  CombatStep,
  EffectLog,
  GameState,
  Keyword,
  MonsterZone,
  PendingChoice,
  PlayerState,
  Seat,
  Trigger,
} from './types';
import { needsChosenTarget } from './vocabulary';

const MONSTER_ZONES: MonsterZone[] = ['attack', 'defense'];

export function otherZone(zone: MonsterZone): MonsterZone {
  return zone === 'attack' ? 'defense' : 'attack';
}

function hasKeyword(card: CardInstance, keyword: Keyword): boolean {
  return hasKeywordDef(getCardDef(card.cardId), keyword);
}

// ---------------------------------------------------------------------------------------
// Board : localiser, déplacer, retirer
// ---------------------------------------------------------------------------------------

export interface BoardLocation {
  seat: Seat;
  zone: MonsterZone;
  index: number;
  card: CardInstance;
}

export function locateMonster(state: GameState, uid: string): BoardLocation | null {
  for (const seat of ['p1', 'p2'] as Seat[]) {
    for (const zone of MONSTER_ZONES) {
      const cards = zoneCards(state.players[seat], zone);
      const index = cards.findIndex((c) => c.uid === uid);
      if (index !== -1) return { seat, zone, index, card: cards[index] };
    }
  }
  return null;
}

function allMonsters(player: PlayerState): CardInstance[] {
  return [...zoneCards(player, 'attack'), ...zoneCards(player, 'defense')];
}

// Retire `uid` de sa zone et l'insère dans `toZone` (même propriétaire) à la position `slot`
// (bornée, `undefined` = tout à droite). La capacité de la zone n'est pas vérifiée : seuls
// les effets passent par ici, et ils peuvent la dépasser (modifsV2.md).
function relocate(state: GameState, from: BoardLocation, toZone: MonsterZone, slot?: number): void {
  const player = state.players[from.seat];
  const source = zoneCards(player, from.zone).filter((c) => c.uid !== from.card.uid);
  writeZone(player, from.zone, source);
  const target = zoneCards(player, toZone);
  const at = slot === undefined ? target.length : Math.max(0, Math.min(slot, target.length));
  target.splice(at, 0, from.card);
  writeZone(player, toZone, target);
}

// Une carte qui quitte le board perd tout ce qu'elle y avait acquis en V2 (armure, états…).
// Sans effet sur une carte V1, qui ne porte jamais ces champs.
export function clearBoardState(card: CardInstance): void {
  delete card.armor;
  delete card.shields;
  delete card.frozen;
  delete card.burn;
  delete card.wounds;
  delete card.silenced;
  delete card.rootedBy;
}

// Ne peut pas changer de zone ni de position : habileté Enraciné (contre les effets
// seulement) ou état enraciné (contre les effets ET son joueur, voir `isRootedState`).
export function isImmovableByEffect(card: CardInstance): boolean {
  return hasKeyword(card, 'rooted') || isRootedState(card);
}

export function isRootedState(card: CardInstance): boolean {
  return card.rootedBy !== undefined;
}

// Début du tour de `seat` : les monstres qu'il avait enracinés (des deux camps) sont libérés.
export function expireRoots(state: GameState, seat: Seat): void {
  for (const owner of ['p1', 'p2'] as Seat[]) {
    for (const card of allMonsters(state.players[owner])) {
      if (card.rootedBy === seat) delete card.rootedBy;
    }
  }
}

function addArmor(card: CardInstance, amount: number): void {
  if (amount <= 0) return;
  card.armor = (card.armor ?? 0) + amount;
}

// Uid neuf pour une créature invoquée : unique dans la partie (le numéro d'évènement change à
// chaque action, le compteur départage plusieurs créatures d'une même action).
function nextTokenUid(state: GameState): string {
  const prefix = `tok${state.eventSeq}x`;
  let n = 0;
  for (const seat of ['p1', 'p2'] as Seat[]) {
    for (const card of allMonsters(state.players[seat])) {
      if (card.uid.startsWith(prefix)) n = Math.max(n, Number(card.uid.slice(prefix.length)) + 1);
    }
  }
  return `${prefix}${n}`;
}

// ---------------------------------------------------------------------------------------
// Enchantements V2
// ---------------------------------------------------------------------------------------

function enchantments(player: PlayerState): { effect: ReturnType<typeof enchantEffect>; golden: boolean }[] {
  return player.zones.enchant
    .filter((s): s is CardInstance => s !== null)
    .map((slot) => ({ effect: enchantEffect(slot), golden: slot.golden === true }));
}

function enchantEffect(slot: CardInstance) {
  const def = getCardDef(slot.cardId);
  return def.kind === 'enchantment' ? def.effect : null;
}

// « Double les soins reçus » : chaque enchantement double les soins, un enchantement doré les
// quadruple (son effet est doublé, comme tout enchantement doré).
export function healMultiplier(player: PlayerState): number {
  let multiplier = 1;
  for (const { effect, golden } of enchantments(player)) {
    if (effect?.type === 'healBoost') multiplier *= golden ? 4 : 2;
  }
  return multiplier;
}

// « Ajoute X cartes au marché de façon permanente » : cartes en plus à chaque marché.
export function marketBonus(player: PlayerState): number {
  let bonus = 0;
  for (const { effect, golden } of enchantments(player)) {
    if (effect?.type === 'marketSize') bonus += effect.count * (golden ? GOLDEN_MULTIPLIER : 1);
  }
  return bonus;
}

// « Ajoute +X pièces aux prix de vente ». `exceptUid` : la carte vendue, qui ne compte pas
// pour sa propre vente (elle quitte le board en étant vendue).
export function sellBonus(player: PlayerState, exceptUid?: string): number {
  let bonus = 0;
  for (const slot of player.zones.enchant) {
    if (!slot || slot.uid === exceptUid) continue;
    const effect = enchantEffect(slot);
    if (effect?.type === 'sellBonus') bonus += effect.amount * (slot.golden ? GOLDEN_MULTIPLIER : 1);
  }
  return bonus;
}

// ---------------------------------------------------------------------------------------
// Effets de capacité V2
// ---------------------------------------------------------------------------------------

// Cibles possibles d'un effet à cible choisie, pour le joueur `seat` :
// - armure / protection : un de SES monstres ;
// - brûlure / gel : un monstre ADVERSE ;
// - changement de zone / de position : n'importe quel monstre (Air : les siens aussi), sauf
//   un Enraciné ; pour un changement de position, il faut au moins une autre carte dans sa zone.
export function choiceTargets(state: GameState, choice: Pick<PendingChoice, 'seat' | 'effect'>): string[] {
  const mine = allMonsters(state.players[choice.seat]);
  const theirs = allMonsters(state.players[opponentOf(choice.seat)]);
  switch (choice.effect.type) {
    case 'armorChosen':
    case 'grantShield':
      return mine.map((c) => c.uid);
    case 'burn':
    case 'freeze':
    case 'silence':
      return theirs.map((c) => c.uid);
    case 'extinguish':
      return mine.filter((c) => (c.burn ?? 0) > 0).map((c) => c.uid); // seulement un monstre brûlé
    case 'root':
      return [...mine, ...theirs].map((c) => c.uid);
    case 'moveZone':
      return [...mine, ...theirs].filter((c) => !isImmovableByEffect(c)).map((c) => c.uid);
    case 'moveSlot':
      return [...mine, ...theirs]
        .filter((c) => !isImmovableByEffect(c))
        .filter((c) => {
          const location = locateMonster(state, c.uid)!;
          return zoneCards(state.players[location.seat], location.zone).length > 1;
        })
        .map((c) => c.uid);
    default:
      return [];
  }
}

// Effets propres à la V2, et soin (doublé par « Double les soins reçus »). Les autres effets
// communs passent par `resolveCommonEffect` de `rules.ts`. `target` / `slot` : la cible
// choisie par le joueur, pour un effet à cible choisie.
function applyEffectV2(
  state: GameState,
  seat: Seat,
  card: CardInstance,
  effect: AbilityEffect,
  target?: string,
  slot?: number,
): void {
  const player = state.players[seat];
  const here = locateMonster(state, card.uid);
  const chosen = target ? locateMonster(state, target) : null;
  switch (effect.type) {
    case 'healSelf':
      resolveCommonEffect(state, seat, card, { type: 'healSelf', amount: effect.amount * healMultiplier(player) });
      return;
    case 'armorSelf':
      if (here) addArmor(here.card, effect.amount);
      return;
    case 'armorZone':
      if (here) for (const c of zoneCards(player, here.zone)) addArmor(c, effect.amount);
      return;
    case 'armorBoard':
      for (const c of allMonsters(player)) addArmor(c, effect.amount);
      return;
    case 'armorChosen':
      if (chosen) addArmor(chosen.card, effect.amount);
      return;
    case 'grantShield':
      if (chosen) chosen.card.shields = (chosen.card.shields ?? 0) + 1;
      return;
    case 'burn':
      // Cumulable : chaque brûlure ajoute 1 à la défense perdue à chaque combat.
      if (chosen) chosen.card.burn = (chosen.card.burn ?? 0) + 1;
      return;
    case 'extinguish':
      if (chosen) delete chosen.card.burn;
      return;
    case 'silence':
      if (chosen) chosen.card.silenced = true;
      return;
    case 'root':
      if (chosen) chosen.card.rootedBy = seat;
      return;
    case 'freeze':
      if (chosen) chosen.card.frozen = true;
      return;
    case 'summonToken': {
      if (!here) return;
      const def = getCardDef(card.cardId);
      const token: CardInstance = {
        uid: nextTokenUid(state),
        cardId: tokenCardId(def.element, effect.attack, effect.defense),
        token: true,
      };
      const cards = zoneCards(player, here.zone);
      cards.splice(here.index + 1, 0, token); // juste à droite de la carte qui l'invoque
      writeZone(player, here.zone, cards);
      return;
    }
    case 'switchZone':
      if (here && !isImmovableByEffect(here.card)) relocate(state, here, otherZone(here.zone));
      return;
    case 'moveZone':
      if (chosen && !isImmovableByEffect(chosen.card)) relocate(state, chosen, otherZone(chosen.zone));
      return;
    case 'moveSlot':
      if (chosen && slot !== undefined && !isImmovableByEffect(chosen.card)) {
        relocate(state, chosen, chosen.zone, slot);
      }
      return;
    default:
      resolveCommonEffect(state, seat, card, effect);
  }
}

// Résout les effets `effects` (déjà multipliés pour une carte dorée) d'une capacité de `card`,
// dans l'ordre (E2). Un effet à cible choisie suspend la résolution sur `pendingChoice`, avec
// les effets restants en file — sauf s'il n'a aucune cible possible : il est alors sans effet.
// En combat (`inCombat`), un tel effet est ignoré : le joueur ne peut pas choisir (la
// validation du catalogue l'interdit de toute façon).
function resolveEffects(
  state: GameState,
  seat: Seat,
  card: CardInstance,
  trigger: Trigger,
  effects: AbilityEffect[],
  inCombat: boolean,
): EffectLog[] {
  const logs: EffectLog[] = [];
  for (const [i, effect] of effects.entries()) {
    if (state.winner !== null) break; // E7
    if (needsChosenTarget(effect.type)) {
      if (inCombat) continue;
      const choice: PendingChoice = {
        seat,
        sourceUid: card.uid,
        cardId: card.cardId,
        trigger,
        effect,
        queue: effects.slice(i + 1),
      };
      if (choiceTargets(state, choice).length === 0) continue; // aucune cible : sans effet
      state.pendingChoice = choice;
      break;
    }
    applyEffectV2(state, seat, card, effect);
    logs.push({ seat, sourceUid: card.uid, cardId: card.cardId, trigger, effect });
  }
  return logs;
}

// Pendant de `fireTrigger` (rules.ts) pour la V2. `firedThisCombat` : capacités `oncePerCombat`
// déjà déclenchées pendant le combat en cours (absent hors combat).
export function fireTriggerV2(
  state: GameState,
  seat: Seat,
  card: CardInstance,
  trigger: Trigger,
  firedThisCombat?: Set<string>,
): EffectLog[] {
  if (card.silenced) return []; // Silence : aucune capacité ne se déclenche
  const def = getCardDef(card.cardId);
  const effects: AbilityEffect[] = [];
  for (const [index, ability] of (def.abilities ?? []).entries()) {
    if (ability.trigger !== trigger) continue;
    if (ability.oncePerCombat && firedThisCombat) {
      const key = `${card.uid}:${index}`;
      if (firedThisCombat.has(key)) continue;
      firedThisCombat.add(key);
    }
    effects.push(scaleAbilityEffect(ability.effect, card.golden ? GOLDEN_MULTIPLIER : 1));
  }
  return resolveEffects(state, seat, card, trigger, effects, firedThisCombat !== undefined);
}

export function isChoiceLegal(state: GameState, seat: Seat, uid: string | null, slot?: number): boolean {
  const choice = state.pendingChoice;
  if (!choice || choice.seat !== seat) return false;
  if (uid === null) return true; // renoncer à l'effet est toujours permis
  if (!choiceTargets(state, choice).includes(uid)) return false;
  if (choice.effect.type !== 'moveSlot') return slot === undefined;
  const location = locateMonster(state, uid)!;
  const count = zoneCards(state.players[location.seat], location.zone).length;
  return slot !== undefined && Number.isInteger(slot) && slot >= 0 && slot < count && slot !== location.index;
}

// Applique le choix du joueur (ou l'abandon, `uid: null`) puis reprend la résolution des
// effets restants de la même capacité, qui peut s'interrompre à nouveau sur un autre choix.
export function applyChooseTarget(next: GameState, seat: Seat, uid: string | null, slot?: number): void {
  const choice = next.pendingChoice!;
  delete next.pendingChoice;
  // La carte source peut avoir quitté le board (Vendu) : on la retrouve où qu'elle soit, et
  // une copie minimale suffit sinon (seuls son uid et son id servent).
  const source = locateMonster(next, choice.sourceUid)?.card ?? { uid: choice.sourceUid, cardId: choice.cardId };
  const effects: EffectLog[] = [];
  if (uid !== null) {
    applyEffectV2(next, seat, source, choice.effect, uid, slot);
    effects.push({ seat, sourceUid: source.uid, cardId: source.cardId, trigger: choice.trigger, effect: choice.effect });
  }
  effects.push(...resolveEffects(next, seat, source, choice.trigger, choice.queue, false));
  next.lastEvent = { id: next.eventSeq, type: 'choice', seat, uid, effects };
}

// ---------------------------------------------------------------------------------------
// Combat V2
// ---------------------------------------------------------------------------------------

interface Fighter {
  card: CardInstance;
  seat: Seat;
  damageTaken: number;
  ko: boolean;
  out: boolean; // défense effective ≤ 0 en rejoignant le combat (E17) : il n'y participe pas
  protection: number; // Protection (habileté) encore disponible pendant CE combat
}

export interface CombatResultV2 extends CombatResult {
  boardBefore: BoardSnapshot;
  boardAfterStart: BoardSnapshot;
  burnedOut: { seat: Seat; uid: string; cardId: string }[];
}

export function snapshotBoard(state: GameState): BoardSnapshot {
  const snap = (seat: Seat) => ({
    attack: structuredClone(zoneCards(state.players[seat], 'attack')),
    defense: structuredClone(zoneCards(state.players[seat], 'defense')),
  });
  return { p1: snap('p1'), p2: snap('p2') };
}

// Combat automatique V2. Même déroulé qu'en V1 (cycles, riposte, percée, E13-E17), avec les
// règles de modifsV2.md. Le board peut changer pendant le combat (créature invoquée, monstre
// qui change de zone) : les participants se relisent donc dans les zones à chaque coup — un
// monstre qui quitte la zone d'attaque n'attaque plus, celui qui rejoint la défense peut être
// ciblé. MUTE `state`, comme `resolveCombat`.
export function resolveCombatV2(state: GameState, attackerSeat: Seat): CombatResultV2 {
  const defenderSeat = opponentOf(attackerSeat);
  const fighters = new Map<string, Fighter>();
  const boardBefore = snapshotBoard(state);
  const steps: CombatStep[] = [];
  const firedThisCombat = new Set<string>();

  function zoneOf(card: CardInstance): MonsterZone | null {
    return locateMonster(state, card.uid)?.zone ?? null;
  }

  function currentDefense(f: Fighter): number {
    const zone = zoneOf(f.card) ?? 'defense';
    return Math.max(0, getMonsterStats(state.players[f.seat], f.card, zone).defense - f.damageTaken);
  }

  function fighterOf(card: CardInstance, seat: Seat): Fighter {
    let fighter = fighters.get(card.uid);
    if (!fighter) {
      fighter = {
        card,
        seat,
        damageTaken: 0,
        ko: false,
        out: false,
        protection: hasKeyword(card, 'protection') ? KEYWORD_PROTECTION_USES : 0,
      };
      fighter.out = currentDefense(fighter) <= 0; // E17
      fighters.set(card.uid, fighter);
    }
    return fighter;
  }

  // Participants debout d'une zone : ni gelés, ni KO, ni hors combat (E17).
  function standing(seat: Seat, zone: MonsterZone): Fighter[] {
    return zoneCards(state.players[seat], zone)
      .filter((c) => !c.frozen)
      .map((c) => fighterOf(c, seat))
      .filter((f) => !f.out && !f.ko && currentDefense(f) > 0);
  }

  function isStandingIn(f: Fighter, zone: MonsterZone): boolean {
    return standing(f.seat, zone).includes(f);
  }

  // Provocation (défense uniquement) : le défenseur provocateur le plus à gauche passe avant
  // tous les autres ; sinon, le défenseur debout le plus à gauche (R4).
  function pickTarget(defenders: Fighter[]): Fighter | undefined {
    return defenders.find((f) => hasKeyword(f.card, 'taunt')) ?? defenders[0];
  }

  // Dégâts `amount` portés à `f` par `dealer`. Ordre : Protection (habileté) puis protection
  // reçue par effet annulent le coup entier ; l'armure absorbe ensuite, sauf si `dealer` a
  // Percée ; enfin Toxic tue dès qu'au moins 1 dégât atteint la défense. Ne touche pas encore
  // `damageTaken` (dégâts simultanés, E13) : rend les dégâts à appliquer à la défense.
  function computeHit(
    f: Fighter,
    amount: number,
    dealer: CardInstance,
    dealerSeat: Seat,
    effects: EffectLog[],
    absorbedUids: string[],
  ): { damage: number; progress: number } {
    if (amount <= 0) return { damage: 0, progress: 0 };
    if (f.protection > 0 || (f.card.shields ?? 0) > 0) {
      if (f.protection > 0) f.protection -= 1;
      else if (f.card.shields! > 1) f.card.shields! -= 1;
      else delete f.card.shields;
      absorbedUids.push(f.card.uid);
      effects.push(keywordLog(f.seat, f.card, 'protection'));
      return { damage: 0, progress: 1 };
    }
    let rest = amount;
    let armorLost = 0;
    const armor = f.card.armor ?? 0;
    if (armor > 0) {
      if (hasKeyword(dealer, 'pierce')) {
        effects.push(keywordLog(dealerSeat, dealer, 'pierce'));
      } else {
        armorLost = Math.min(armor, rest);
        rest -= armorLost;
        if (armor - armorLost > 0) f.card.armor = armor - armorLost;
        else delete f.card.armor;
      }
    }
    if (rest > 0 && hasKeyword(dealer, 'toxic')) {
      rest = Math.max(rest, currentDefense(f));
      effects.push(keywordLog(dealerSeat, dealer, 'toxic'));
    }
    return { damage: rest, progress: rest + armorLost };
  }

  function knockOutIfDown(f: Fighter, effects: EffectLog[]): number {
    const remaining = currentDefense(f);
    if (remaining === 0 && !f.ko) {
      f.ko = true;
      if (state.winner === null) effects.push(...fireTriggerV2(state, f.seat, f.card, 'ko', firedThisCombat));
    }
    return remaining;
  }

  // --- Début du combat --- Comme en V1 : rien si l'attaquant n'a aucun monstre en attaque.
  const startEffects: EffectLog[] = [];
  const initialAttackers = standing(attackerSeat, 'attack');
  if (initialAttackers.length > 0) {
    for (const f of [...initialAttackers, ...standing(defenderSeat, 'defense')]) {
      if (state.winner !== null) break; // E7
      startEffects.push(...fireTriggerV2(state, f.seat, f.card, 'combatStart', firedThisCombat));
    }
  }
  const hpAfterStart = snapshotHp(state);
  const boardAfterStart = snapshotBoard(state);

  let cycle = 0;
  let stalemate = false;

  // Un échange : `attacker` frappe `target`, qui riposte. Rend le « progrès » (dégâts, armure
  // entamée, protection consommée) pour détecter un combat nul.
  function exchange(attacker: Fighter, target: Fighter, defenders: Fighter[], extraStrike: boolean): number {
    let progress = 0;
    const effects: EffectLog[] = [];
    if (extraStrike) effects.push(keywordLog(attackerSeat, attacker.card, 'fury'));
    if (target !== defenders[0] && hasKeyword(target.card, 'taunt')) {
      effects.push(keywordLog(defenderSeat, target.card, 'taunt'));
    }
    effects.push(...fireTriggerV2(state, attackerSeat, attacker.card, 'attack', firedThisCombat));
    if (state.winner === null) {
      effects.push(...fireTriggerV2(state, defenderSeat, target.card, 'defend', firedThisCombat));
    }

    let damage = 0;
    let retaliation = 0;
    const absorbedUids: string[] = [];
    if (state.winner === null) {
      const attackerZone = zoneOf(attacker.card) ?? 'attack';
      const targetZone = zoneOf(target.card) ?? 'defense';
      const attack = getMonsterStats(state.players[attackerSeat], attacker.card, attackerZone).attack;
      const riposte = getMonsterStats(state.players[defenderSeat], target.card, targetZone).attack;
      const hit = computeHit(target, attack, attacker.card, attackerSeat, effects, absorbedUids);
      const back = computeHit(attacker, riposte, target.card, defenderSeat, effects, absorbedUids);
      damage = hit.damage;
      retaliation = back.damage;
      progress += hit.progress + back.progress;
    }
    // Dégâts simultanés (E5, E13).
    target.damageTaken += damage;
    attacker.damageTaken += retaliation;
    const targetRemaining = knockOutIfDown(target, effects);
    const attackerRemaining = knockOutIfDown(attacker, effects);

    // Portée (attaque uniquement) : 1 dégât à chaque voisin debout de la cible dans sa rangée,
    // comme s'il était lui-même attaqué — ses effets « Défend » se déclenchent, sa protection,
    // son armure et le Toxic / la Percée de l'attaquant jouent. Pas de riposte.
    const splash: NonNullable<CombatStep['splash']> = [];
    if (state.winner === null && hasKeyword(attacker.card, 'reach')) {
      const row = zoneCards(state.players[defenderSeat], 'defense');
      const at = row.findIndex((c) => c.uid === target.card.uid);
      const neighbors = [row[at - 1], row[at + 1]]
        .filter((c): c is CardInstance => c !== undefined)
        .map((c) => fighters.get(c.uid))
        .filter((f): f is Fighter => f !== undefined && standing(defenderSeat, 'defense').includes(f));
      if (neighbors.length > 0) effects.push(keywordLog(attackerSeat, attacker.card, 'reach'));
      for (const neighbor of neighbors) {
        if (state.winner !== null) break;
        effects.push(...fireTriggerV2(state, defenderSeat, neighbor.card, 'defend', firedThisCombat));
        if (state.winner !== null) break;
        const hit = computeHit(neighbor, KEYWORD_REACH_DAMAGE_V2, attacker.card, attackerSeat, effects, absorbedUids);
        neighbor.damageTaken += hit.damage;
        progress += hit.progress;
        const remaining = knockOutIfDown(neighbor, effects);
        splash.push({ uid: neighbor.card.uid, damage: hit.damage, remaining, effective: false });
      }
    }

    steps.push({
      cycle,
      attackerUid: attacker.card.uid,
      target: { kind: 'monster', uid: target.card.uid },
      damage,
      remaining: targetRemaining,
      retaliation,
      attackerRemaining,
      effective: false, // plus d'avantage élémentaire en V2
      retaliationEffective: false,
      ...(splash.length > 0 ? { splash } : {}),
      ...(absorbedUids.length > 0 ? { absorbedUids } : {}),
      effects,
      hp: snapshotHp(state),
      board: snapshotBoard(state),
    });
    return progress;
  }

  // --- Mêlée (E14) ---
  while (
    state.winner === null &&
    standing(attackerSeat, 'attack').length > 0 &&
    standing(defenderSeat, 'defense').length > 0
  ) {
    if (cycle >= MAX_COMBAT_CYCLES) {
      stalemate = true; // E16 : filet de sécurité
      break;
    }
    cycle += 1;
    let progress = 0;
    let defendersDown = false;

    // Ordre du cycle figé à son début, de gauche à droite ; chaque attaquant est relu avant de
    // frapper (il a pu tomber, être déplacé…).
    for (const attacker of standing(attackerSeat, 'attack')) {
      const strikes = hasKeyword(attacker.card, 'fury') ? KEYWORD_FURY_STRIKES_V2 : 1;
      for (let strike = 0; strike < strikes; strike++) {
        if (state.winner !== null || !isStandingIn(attacker, 'attack')) break;
        const defenders = standing(defenderSeat, 'defense');
        if (defenders.length === 0) {
          defendersDown = true; // E14 : les attaquants restants passent à la percée
          break;
        }
        progress += exchange(attacker, pickTarget(defenders)!, defenders, strike > 0);
      }
      if (state.winner !== null || defendersDown) break;
    }

    // E16 : un cycle complet sans aucun progrès (des deux côtés) est un match nul.
    if (state.winner === null && !defendersDown && progress === 0) {
      stalemate = true;
      break;
    }
  }

  // --- Percée (E15) : 1 PV par attaquant encore debout, sans capacité ni riposte ---
  if (state.winner === null && !stalemate && standing(defenderSeat, 'defense').length === 0) {
    for (const attacker of standing(attackerSeat, 'attack')) {
      if (state.winner !== null) break; // E7
      damageHero(state, defenderSeat, BREAKTHROUGH_DAMAGE);
      steps.push({
        cycle: cycle + 1,
        attackerUid: attacker.card.uid,
        target: { kind: 'player' },
        damage: BREAKTHROUGH_DAMAGE,
        remaining: state.players[defenderSeat].hp,
        retaliation: 0,
        attackerRemaining: currentDefense(attacker),
        effective: false,
        retaliationEffective: false,
        effects: [],
        hp: snapshotHp(state),
        board: snapshotBoard(state),
      });
    }
  }

  // --- Fin du combat : brûlures, puis dégel ---
  const burnedOut: CombatResultV2['burnedOut'] = [];
  if (state.winner === null) {
    for (const f of fighters.values()) {
      if (f.out || !f.card.burn) continue;
      const location = locateMonster(state, f.card.uid);
      if (!location) continue;
      f.card.wounds = (f.card.wounds ?? 0) + f.card.burn;
      const player = state.players[location.seat];
      if (getMonsterStats(player, f.card, location.zone).defense > 0) continue;
      // Défense tombée à 0 : le monstre quitte le board pour le fond du deck (demande
      // utilisateur) ; une créature invoquée disparaît simplement.
      writeZone(player, location.zone, zoneCards(player, location.zone).filter((c) => c.uid !== f.card.uid));
      clearBoardState(f.card);
      delete f.card.buff;
      if (!f.card.token) {
        delete f.card.golden;
        player.deck.unshift(f.card);
      }
      burnedOut.push({ seat: location.seat, uid: f.card.uid, cardId: f.card.cardId });
    }
  }
  // Un monstre gelé dégèle (et un monstre réduit au silence la retrouve) à la fin du combat
  // auquel il aurait participé : attaquants du
  // joueur actif, défenseurs adverses. Gelé dans une autre zone, il attend le combat suivant.
  for (const card of [
    ...zoneCards(state.players[attackerSeat], 'attack'),
    ...zoneCards(state.players[defenderSeat], 'defense'),
  ]) {
    delete card.frozen;
    delete card.silenced; // même rythme que le gel : jusqu'à la fin de son prochain combat
  }

  return { startEffects, hpAfterStart, steps, stalemate, boardBefore, boardAfterStart, burnedOut };
}
