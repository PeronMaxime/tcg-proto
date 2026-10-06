import { beforeEach, describe, expect, it } from 'vitest';
import { isAbilityAllowed, setActiveCatalog } from './cards';
import { migrateCatalogToV2, parseCardDef, parseCatalog } from './catalogSchema';
import { DEFAULT_CATALOG } from './defaultCatalog';
import { applyAction, getMonsterStats, isActionLegal, sellValue, STARTING_HP, zoneCards } from './rules';
import { resolveCombatV2 } from './rulesV2';
import type { CardDef, CardInstance, Catalog, GameState, MonsterZone, PlayerState, Slot } from './types';

// Règles V2 (modifsV2.md, `rulesV2.ts`) : un catalogue V2 de test, installé comme catalogue actif
// — c'est lui qui fait basculer `rules.ts` sur les règles de la V2.

function monster(id: string, attack: number, defense: number, extra: Partial<CardDef> = {}): CardDef {
  return { kind: 'monster', id, name: id, cost: 1, element: 'earth', rarity: 'common', attack, defense, ...extra } as CardDef;
}

const CARDS: CardDef[] = [
  monster('grunt', 2, 3),
  monster('wall', 1, 5, { keywords: ['taunt'] }),
  monster('furious', 2, 6, { keywords: ['fury'] }),
  monster('archer', 2, 6, { keywords: ['reach'] }),
  monster('viper', 1, 6, { keywords: ['toxic'] }),
  monster('piercer', 3, 6, { keywords: ['pierce'] }),
  monster('bird', 1, 2, { keywords: ['flying'] }),
  monster('oak', 1, 4, { keywords: ['rooted'] }),
  monster('smith', 1, 3, { abilities: [{ trigger: 'summon', effect: { type: 'armorChosen', amount: 2 } }] }),
  monster('frost', 1, 3, { element: 'water', abilities: [{ trigger: 'summon', effect: { type: 'freeze' } }] }),
  monster('ember', 1, 3, { element: 'fire', abilities: [{ trigger: 'summon', effect: { type: 'burn' } }] }),
  monster('caller', 1, 3, { abilities: [{ trigger: 'summon', effect: { type: 'summonToken', attack: 1, defense: 1 } }] }),
  monster('gust', 1, 3, { element: 'air', abilities: [{ trigger: 'summon', effect: { type: 'moveZone' } }] }),
  monster('turtle', 0, 3, { abilities: [{ trigger: 'defend', effect: { type: 'armorSelf', amount: 1 } }] }),
  monster('medic', 1, 3, { element: 'water', abilities: [{ trigger: 'summon', effect: { type: 'healSelf', amount: 2 } }] }),
  monster('rain', 1, 3, { element: 'water', abilities: [{ trigger: 'summon', effect: { type: 'extinguish' } }] }),
  monster('druid', 1, 3, { abilities: [{ trigger: 'summon', effect: { type: 'root' } }] }),
  monster('hush', 1, 3, { element: 'water', abilities: [{ trigger: 'summon', effect: { type: 'silence' } }] }),
  monster('drummer', 1, 5, { abilities: [{ trigger: 'combatStart', effect: { type: 'gainCoins', amount: 1 } }] }),
  { kind: 'enchantment', id: 'spring', name: 'spring', cost: 1, element: 'water', rarity: 'common', effect: { type: 'healBoost' } },
  { kind: 'enchantment', id: 'bazaar', name: 'bazaar', cost: 1, element: 'air', rarity: 'common', effect: { type: 'marketSize', count: 1 } },
  { kind: 'enchantment', id: 'broker', name: 'broker', cost: 1, element: 'air', rarity: 'common', effect: { type: 'sellBonus', amount: 2 } },
];

const V2_CATALOG: Catalog = { version: 1, cards: CARDS, starterCounts: { grunt: 20 }, gameVersion: 'v2' };

beforeEach(() => setActiveCatalog(V2_CATALOG));

let uidCounter = 0;
function card(cardId: string, extra: Partial<CardInstance> = {}): CardInstance {
  return { uid: `${cardId}${uidCounter++}`, cardId, ...extra };
}

function zone(cards: CardInstance[], size = 3): Slot[] {
  return [...cards, ...new Array<Slot>(Math.max(0, size - cards.length)).fill(null)];
}

function player(zones: Partial<Record<MonsterZone | 'enchant', CardInstance[]>> = {}, extra: Partial<PlayerState> = {}): PlayerState {
  return {
    hp: STARTING_HP,
    coins: 10,
    turnsPlayed: 3,
    deck: Array.from({ length: 10 }, () => card('grunt')),
    market: [],
    hand: [],
    zones: { attack: zone(zones.attack ?? []), defense: zone(zones.defense ?? []), enchant: zone(zones.enchant ?? [], 3) },
    extraMarketCards: 0,
    lockedUids: [],
    movesUsed: { attack: false, defense: false },
    zoneSizes: { attack: 3, defense: 3, enchant: 3 },
    ...extra,
  };
}

function game(p1: PlayerState, p2: PlayerState): GameState {
  return {
    rulesVersion: 17,
    starter: 'p1',
    turn: 'p1',
    phase: 'main',
    turnNumber: 4,
    players: { p1, p2 },
    winner: null,
    eventSeq: 10,
    lastEvent: null,
  };
}

describe('catalogue V2', () => {
  it('la copie de la V1 perd les auras et les effets absents de la V2, puis se valide en V2', () => {
    const parsed = parseCatalog(migrateCatalogToV2(DEFAULT_CATALOG), 'v2');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.gameVersion).toBe('v2');
    for (const def of parsed.value.cards) {
      expect('aura' in def).toBe(false);
      for (const ability of def.abilities ?? []) {
        expect(['buff', 'bonusDamage', 'shield']).not.toContain(ability.effect.type);
      }
    }
  });

  it('la V1 refuse les habiletés et effets V2, la V2 refuse ceux de la V1', () => {
    expect(parseCardDef(monster('x', 1, 1, { keywords: ['pierce'] })).ok).toBe(false);
    expect(parseCardDef(monster('x', 1, 1, { keywords: ['pierce'] }), 'x', 'v2').ok).toBe(true);
    const aura = monster('x', 1, 1, { aura: { attack: 1, defense: 1 } } as Partial<CardDef>);
    expect(parseCardDef(aura, 'x', 'v2').ok).toBe(false);
    const bonus = monster('x', 1, 1, { abilities: [{ trigger: 'attack', effect: { type: 'bonusDamage', amount: 1 } }] });
    expect(parseCardDef(bonus, 'x', 'v2').ok).toBe(false);
  });

  it('un effet à cible choisie ne se déclenche que sur Invoqué ou Vendu', () => {
    const def = CARDS.find((c) => c.id === 'frost')!;
    expect(isAbilityAllowed(def, { trigger: 'summon', effect: { type: 'freeze' } }, 'v2')).toBe(true);
    expect(isAbilityAllowed(def, { trigger: 'sold', effect: { type: 'freeze' } }, 'v2')).toBe(true);
    expect(isAbilityAllowed(def, { trigger: 'attack', effect: { type: 'freeze' } }, 'v2')).toBe(false);
  });
});

describe('combat V2', () => {
  it("l'armure encaisse avant la défense et ce qu'elle a encaissé est perdu", () => {
    const attacker = card('grunt'); // 2 d'attaque
    const defender = card('wall', { armor: 3 });
    const state = game(player({ attack: [attacker] }), player({ defense: [defender] }));
    const result = resolveCombatV2(state, 'p1');
    // Premier coup : 2 dans l'armure (3 → 1), aucun dégât à la défense.
    expect(result.steps[0].damage).toBe(0);
    expect(result.steps[0].board!.p2.defense[0].armor).toBe(1);
  });

  it("Percée ignore l'armure", () => {
    const attacker = card('piercer'); // 3 d'attaque
    const defender = card('wall', { armor: 5 });
    const state = game(player({ attack: [attacker] }), player({ defense: [defender] }));
    const result = resolveCombatV2(state, 'p1');
    expect(result.steps[0].damage).toBe(3);
    expect(result.steps[0].board!.p2.defense[0].armor).toBe(5);
  });

  it("Toxic tue dès qu'un dégât atteint la défense, pas quand l'armure encaisse tout", () => {
    const blocked = game(player({ attack: [card('viper')] }), player({ defense: [card('wall', { armor: 1 })] }));
    expect(resolveCombatV2(blocked, 'p1').steps[0].remaining).toBe(5);
    const open = game(player({ attack: [card('viper')] }), player({ defense: [card('wall')] }));
    expect(resolveCombatV2(open, 'p1').steps[0].remaining).toBe(0);
  });

  it('Furie frappe deux fois par cycle', () => {
    const attacker = card('furious');
    const state = game(player({ attack: [attacker] }), player({ defense: [card('wall')] }));
    const result = resolveCombatV2(state, 'p1');
    const firstCycle = result.steps.filter((s) => s.cycle === 1);
    expect(firstCycle).toHaveLength(2);
    expect(firstCycle.every((s) => s.attackerUid === attacker.uid)).toBe(true);
  });

  it('Portée blesse les voisins de 1, qui déclenchent leurs effets Défend', () => {
    const left = card('grunt');
    const target = card('wall'); // provocation : c'est lui qui est visé
    const right = card('turtle'); // Défend : gagne 1 armure… qui absorbe le dégât de Portée
    const state = game(player({ attack: [card('archer')] }), player({ defense: [left, target, right] }));
    const step = resolveCombatV2(state, 'p1').steps[0];
    expect(step.target).toEqual({ kind: 'monster', uid: target.uid });
    expect(step.splash).toEqual([
      { uid: left.uid, damage: 1, remaining: 2, effective: false },
      { uid: right.uid, damage: 0, remaining: 3, effective: false },
    ]);
  });

  it("plus d'avantage élémentaire", () => {
    const state = game(
      player({ attack: [card('frost')] }), // eau, 1 d'attaque
      player({ defense: [card('ember')] }), // feu : l'eau le battait en V1
    );
    expect(resolveCombatV2(state, 'p1').steps[0].damage).toBe(1);
  });

  it('un monstre gelé ne participe pas à son prochain combat, puis dégèle', () => {
    const frozen = card('wall', { frozen: true });
    const other = card('grunt');
    const state = game(player({ attack: [card('grunt')] }), player({ defense: [frozen, other] }));
    const result = resolveCombatV2(state, 'p1');
    expect(result.steps.every((s) => s.target.kind !== 'monster' || s.target.uid !== frozen.uid)).toBe(true);
    expect(frozen.frozen).toBeUndefined();
  });

  it('la brûlure retire 1 défense par combat, puis renvoie le monstre sous le deck', () => {
    const burned = card('bird', { burn: 1 }); // 2 de défense
    const p2 = player({ defense: [burned] });
    const state = game(player({ attack: [card('turtle')] }), p2); // 0 d'attaque : pas de dégât
    resolveCombatV2(state, 'p1');
    expect(burned.wounds).toBe(1);
    expect(getMonsterStats(p2, burned, 'defense').defense).toBe(1);
    const result = resolveCombatV2(state, 'p1');
    expect(result.burnedOut.map((b) => b.uid)).toEqual([burned.uid]);
    expect(zoneCards(p2, 'defense')).toHaveLength(0);
    expect(p2.deck[0]).toBe(burned);
    expect(burned.burn).toBeUndefined();
  });
});

describe('effets et habiletés V2 hors combat', () => {
  it('un effet à cible choisie attend le choix du joueur, qui seul est permis', () => {
    const smith = card('smith');
    const ally = card('grunt');
    const state = game(player({ defense: [ally] }, { hand: [smith] }), player());
    const placed = applyAction(state, 'p1', { type: 'place', uid: smith.uid, zone: 'attack', slot: 0 })!;
    expect(placed.pendingChoice?.effect.type).toBe('armorChosen');
    expect(isActionLegal(placed, 'p1', { type: 'endTurn' })).toBe(false);
    const enemyTarget = isActionLegal(placed, 'p1', { type: 'chooseTarget', uid: 'nope' });
    expect(enemyTarget).toBe(false);
    const chosen = applyAction(placed, 'p1', { type: 'chooseTarget', uid: ally.uid })!;
    expect(chosen.pendingChoice).toBeUndefined();
    expect(zoneCards(chosen.players.p1, 'defense')[0].armor).toBe(2);
    // Renoncer est toujours possible.
    expect(applyAction(placed, 'p1', { type: 'chooseTarget', uid: null })!.pendingChoice).toBeUndefined();
  });

  it("sans cible possible, l'effet est sans effet et rien n'est attendu", () => {
    const frost = card('frost');
    const state = game(player({}, { hand: [frost] }), player()); // aucun monstre adverse
    const placed = applyAction(state, 'p1', { type: 'place', uid: frost.uid, zone: 'attack', slot: 0 })!;
    expect(placed.pendingChoice).toBeUndefined();
  });

  it("une créature invoquée peut dépasser la capacité de la zone, et disparaît à la vente", () => {
    const caller = card('caller');
    const full = [card('grunt'), card('grunt')];
    const state = game(player({ attack: full }, { hand: [caller] }), player());
    const placed = applyAction(state, 'p1', { type: 'place', uid: caller.uid, zone: 'attack', slot: 2 })!;
    const row = zoneCards(placed.players.p1, 'attack');
    expect(row).toHaveLength(4);
    expect(row[3].token).toBe(true);
    const deckSize = placed.players.p1.deck.length;
    const sold = applyAction(placed, 'p1', { type: 'sell', uid: row[3].uid })!;
    expect(zoneCards(sold.players.p1, 'attack')).toHaveLength(3);
    expect(sold.players.p1.deck).toHaveLength(deckSize);
  });

  it('un monstre Enraciné ne peut pas être déplacé par un effet', () => {
    const oak = card('oak');
    const grunt = card('grunt');
    const gust = card('gust');
    const state = game(player({}, { hand: [gust] }), player({ defense: [oak, grunt] }));
    const placed = applyAction(state, 'p1', { type: 'place', uid: gust.uid, zone: 'attack', slot: 0 })!;
    expect(isActionLegal(placed, 'p1', { type: 'chooseTarget', uid: oak.uid })).toBe(false);
    const moved = applyAction(placed, 'p1', { type: 'chooseTarget', uid: grunt.uid })!;
    expect(zoneCards(moved.players.p2, 'attack').map((c) => c.uid)).toEqual([grunt.uid]);
  });

  it('Vol : seul un monstre volant change de zone pendant la phase principale', () => {
    const bird = card('bird');
    const grunt = card('grunt');
    const state = game(player({ attack: [bird, grunt] }), player());
    expect(isActionLegal(state, 'p1', { type: 'move', uid: bird.uid, slot: 0, zone: 'defense' })).toBe(true);
    expect(isActionLegal(state, 'p1', { type: 'move', uid: grunt.uid, slot: 0, zone: 'defense' })).toBe(false);
    const moved = applyAction(state, 'p1', { type: 'move', uid: bird.uid, slot: 0, zone: 'defense' })!;
    expect(zoneCards(moved.players.p1, 'defense').map((c) => c.uid)).toEqual([bird.uid]);
    expect(moved.players.p1.movesUsed.attack).toBe(true);
  });

  it('enchantements : soins doublés, marché agrandi, ventes majorées', () => {
    const medic = card('medic');
    const p1 = player({ enchant: [card('spring'), card('bazaar'), card('broker')] }, { hand: [medic], hp: 5 });
    const state = game(p1, player());
    const healed = applyAction(state, 'p1', { type: 'place', uid: medic.uid, zone: 'attack', slot: 0 })!;
    expect(healed.players.p1.hp).toBe(9); // 2 × 2
    expect(sellValue(card('grunt'), p1)).toBe(3); // 1 + 2

    const next = applyAction(
      { ...state, phase: 'start', players: { ...state.players, p1: { ...p1, market: [] } } },
      'p1',
      { type: 'beginTurn' },
    )!;
    expect(next.players.p1.market).toHaveLength(4);
  });
});

describe('états ajoutés après modifsV2.md (brûlure cumulable, extinction, enraciné, silence)', () => {
  it('les brûlures se cumulent : chaque brûlure retire 1 défense de plus par combat', () => {
    const target = card('wall'); // 5 de défense
    const p2 = player({ defense: [target] });
    const ember1 = card('ember');
    const ember2 = card('ember');
    let state = game(player({}, { hand: [ember1, ember2] }), p2);
    for (const ember of [ember1, ember2]) {
      state = applyAction(state, 'p1', { type: 'place', uid: ember.uid, zone: 'defense', slot: 0 })!;
      state = applyAction(state, 'p1', { type: 'chooseTarget', uid: target.uid })!;
    }
    const burned = zoneCards(state.players.p2, 'defense')[0];
    expect(burned.burn).toBe(2);
    state.players.p1.zones.attack[0] = card('turtle');
    resolveCombatV2(state, 'p1');
    expect(burned.wounds).toBe(2);
  });

  it("l'extinction retire la brûlure d'un de mes monstres, pas la défense déjà perdue", () => {
    const burned = card('wall', { burn: 2, wounds: 1 });
    const rain = card('rain');
    const state = game(player({ defense: [burned, card('grunt')] }, { hand: [rain] }), player());
    const placed = applyAction(state, 'p1', { type: 'place', uid: rain.uid, zone: 'attack', slot: 0 })!;
    // Seul un monstre brûlé est une cible.
    expect(isActionLegal(placed, 'p1', { type: 'chooseTarget', uid: rain.uid })).toBe(false);
    const done = applyAction(placed, 'p1', { type: 'chooseTarget', uid: burned.uid })!;
    const after = zoneCards(done.players.p1, 'defense')[0];
    expect(after.burn).toBeUndefined();
    expect(after.wounds).toBe(1);
  });

  it("un monstre enraciné ne bouge plus, ni par effet ni à la main, jusqu'au prochain tour de qui l'a enraciné", () => {
    const bird = card('bird');
    const druid = card('druid');
    const state = game(player({ attack: [bird, card('grunt')] }, { hand: [druid] }), player());
    const placed = applyAction(state, 'p1', { type: 'place', uid: druid.uid, zone: 'defense', slot: 0 })!;
    const rooted = applyAction(placed, 'p1', { type: 'chooseTarget', uid: bird.uid })!;
    expect(isActionLegal(rooted, 'p1', { type: 'move', uid: bird.uid, slot: 1 })).toBe(false);
    expect(isActionLegal(rooted, 'p1', { type: 'move', uid: bird.uid, slot: 0, zone: 'defense' })).toBe(false);
    // Début du prochain tour de p1 : libéré.
    const nextTurn = applyAction({ ...rooted, phase: 'start' }, 'p1', { type: 'beginTurn' })!;
    expect(zoneCards(nextTurn.players.p1, 'attack')[0].rootedBy).toBeUndefined();
  });

  it("le silence bloque les capacités jusqu'à la fin de son prochain combat", () => {
    const drummer = card('drummer', { silenced: true });
    const p2 = player({ defense: [drummer] }, { coins: 0 });
    const state = game(player({ attack: [card('grunt')] }), p2);
    resolveCombatV2(state, 'p1');
    expect(p2.coins).toBe(0); // « Début du combat : +1 pièce » ne s'est pas déclenché
    expect(drummer.silenced).toBeUndefined();
    resolveCombatV2(state, 'p1');
    expect(p2.coins).toBe(1);
  });
});
