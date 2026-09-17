import type {
  AbilityEffect,
  CardAbility,
  CardDef,
  CardElement,
  CardInstance,
  EnchantmentEffect,
  Keyword,
  MonsterDef,
  Trigger,
} from './types';

// Catalogue des règles v1 — voir PLAN-tcg-proto-regles-v1.md §4. Valeurs de départ, à
// équilibrer en jouant : ce fichier reste le seul endroit à modifier pour changer une carte
// ou la composition du deck.
//
// PLAN-effets-triggers.md §5 : batch de cartes de test des capacités (déclencheur → effet),
// un par carte au minimum, chaque déclencheur au moins deux fois et chaque effet au moins
// une fois. Les valeurs sont volontairement simples ; l'équilibrage n'est pas l'objet.
//
// Équilibrage v7 (10 PV, 2 pièces de départ, percée à 1 dégât par attaquant survivant) :
// ajusté avec une simulation IA gloutonne contre IA gloutonne. Principes : aucune carte ne doit
// rapporter plus qu'elle ne coûte une fois vendue (la vente rend 1 pièce) ; les effets
// répétés à chaque combat (Défend, KO) restent petits, les PV étant rares.
//
// v8 : le buff Attaque du Chevalier et les dégâts Défend du Golem ne se déclenchent plus
// qu'une fois par combat (`oncePerCombat`), plus à chaque cycle (demande utilisateur).
//
// v10 : les capacités et l'aura d'un monstre doré sont doublées (demande utilisateur).
//
// v11 : deck ramené à 50 cartes et rééquilibrage par simulation (bots gloutons, 3 000
// parties par carte, en mesurant le taux de victoire d'un bot qui évite / privilégie chaque
// carte). Écuyer : son « KO : pioche 1 carte » se redéclenchait à chaque combat et en faisait
// de loin la meilleure carte ; Archère, Druidesse et Mage des tempêtes (dégâts/soins directs,
// les PV étant rares) plus chers ; enchantements de monstres et Trésorerie renforcés ou moins
// chers, car presque jamais rentables.
//
// v12 : habiletés (mots-clés, `Keyword`) — demande utilisateur. Les habiletés sont posées sur
// des cartes existantes (Portée/Provocation/Protection/Négociant/Furie) et sur 5 nouvelles
// cartes, deck porté à 60. Coûts ajustés par simulation (bots gloutons) pour que chaque
// habileté reste payante sans dominer : voir le commentaire de chaque carte touchée.

export const CARD_CATALOG: CardDef[] = [
  {
    kind: 'monster',
    id: 'squire',
    name: 'Écuyer',
    cost: 2, // à 1, achat + Invoqué + vente rapportait une pièce nette
    attack: 1,
    defense: 2,
    element: 'air',
    abilities: [{ trigger: 'summon', effect: { type: 'gainCoins', amount: 1 } }],
  },
  {
    kind: 'monster',
    id: 'wolf',
    name: 'Loup gris',
    cost: 2,
    attack: 3,
    defense: 1,
    element: 'earth',
    abilities: [
      { trigger: 'attack', effect: { type: 'bonusDamage', amount: 2 } },
      { trigger: 'sold', effect: { type: 'healSelf', amount: 1 } },
    ],
  },
  {
    kind: 'monster',
    id: 'guard',
    name: 'Garde du pont',
    cost: 3, // v12 : +1 (Provocation, qui force l'adversaire à traverser ses 4 défense)
    attack: 1,
    defense: 4,
    element: 'water',
    keywords: ['taunt'],
    abilities: [{ trigger: 'defend', effect: { type: 'shield', amount: 1 } }],
  },
  {
    kind: 'monster',
    id: 'archer',
    name: 'Archère',
    cost: 4,
    attack: 3,
    defense: 1,
    element: 'air',
    keywords: ['reach'], // v12 : sa flèche éclabousse les voisins de sa cible
    abilities: [{ trigger: 'summon', effect: { type: 'damageOpponent', amount: 1 } }],
  },
  {
    kind: 'monster',
    id: 'knight',
    name: 'Chevalier',
    cost: 4,
    attack: 4,
    defense: 4,
    element: 'fire',
    abilities: [
      { trigger: 'attack', effect: { type: 'buff', target: 'self', attack: 1, defense: 0 }, oncePerCombat: true },
    ],
  },
  {
    kind: 'monster',
    id: 'golem',
    name: 'Golem de pierre',
    cost: 7, // v12 : +1 (Protection sur 8 de défense allongeait trop les combats)
    attack: 1,
    defense: 8,
    element: 'earth',
    keywords: ['protection'],
    abilities: [{ trigger: 'defend', effect: { type: 'damageOpponent', amount: 1 }, oncePerCombat: true }],
  },
  {
    kind: 'monster',
    id: 'drake',
    name: 'Drake',
    cost: 7, // v12 : +1, la Furie a fait de ses 5 d'attaque la carte la plus rentable
    attack: 5,
    defense: 4,
    element: 'fire',
    keywords: ['fury'], // v12 : 5 d'attaque déborde souvent sur le défenseur suivant
    abilities: [{ trigger: 'ko', effect: { type: 'healSelf', amount: 2 } }],
  },
  {
    kind: 'monster',
    id: 'titan',
    name: 'Titan',
    cost: 8,
    attack: 7,
    defense: 7,
    element: 'water',
    aura: { attack: 1, defense: 1 }, // continu, comme un enchantement (demande utilisateur)
  },
  // Début du combat : ne se déclenche que si la carte combat (en attaque à ton tour, en défense
  // quand l'adversaire t'attaque avec au moins un monstre), donc au plus une fois par manche.
  {
    kind: 'monster',
    id: 'druid',
    name: 'Druidesse',
    cost: 4,
    attack: 1,
    defense: 3,
    element: 'earth',
    abilities: [{ trigger: 'combatStart', effect: { type: 'healSelf', amount: 1 } }],
  },
  {
    kind: 'monster',
    id: 'stormMage',
    name: 'Mage des tempêtes',
    cost: 6,
    attack: 2,
    defense: 2,
    element: 'air',
    abilities: [{ trigger: 'combatStart', effect: { type: 'damageOpponent', amount: 1 } }],
  },

  {
    kind: 'monster',
    id: 'peddler',
    name: 'Colporteur',
    cost: 3,
    attack: 2,
    defense: 2,
    element: 'water',
    keywords: ['merchant'], // v12 : revendu 2 pièces, il ne coûte que 1 pièce nette
    abilities: [{ trigger: 'summon', effect: { type: 'extraMarketCard', count: 1 } }],
  },

  // --- v12 : nouvelles cartes bâties autour d'une habileté (demande utilisateur) ---
  {
    kind: 'monster',
    id: 'harpooner',
    name: 'Harponneuse',
    cost: 3,
    attack: 2,
    defense: 2,
    element: 'water',
    keywords: ['reach'],
  },
  {
    kind: 'monster',
    id: 'berserker',
    name: 'Berserker',
    cost: 3, // à 4, l'éviter faisait gagner : 2 de défense, il ne déborde qu'une fois
    attack: 4,
    defense: 2,
    element: 'fire',
    keywords: ['fury'], // grosse attaque, peu de défense : il déborde une fois puis tombe
  },
  {
    kind: 'monster',
    id: 'sentinel',
    name: "Sentinelle d'acier",
    cost: 5,
    attack: 2,
    defense: 5,
    element: 'water',
    keywords: ['taunt', 'protection'], // mur pur : il encaisse le premier coup puis bloque la file
  },
  {
    kind: 'monster',
    id: 'spider',
    name: 'Araignée venimeuse',
    cost: 4, // Toxic tue n'importe quoi : c'est sa défense, pas son attaque, qui fixe son prix
    attack: 1,
    defense: 4,
    element: 'earth',
    keywords: ['toxic'],
  },
  {
    kind: 'monster',
    id: 'wasp',
    name: 'Guêpe tueuse',
    cost: 2, // à 3, la préférer faisait perdre : elle meurt à la première riposte
    attack: 1,
    defense: 1,
    element: 'air',
    keywords: ['toxic'], // échange à sens unique : elle tue une grosse carte et meurt à la riposte
  },
  {
    kind: 'monster',
    id: 'relicKeeper',
    name: 'Gardien des reliques',
    cost: 2,
    attack: 1,
    defense: 3,
    element: 'earth',
    keywords: ['merchant'], // acheté 2, revendu 2 : un mur que l'on recycle sans perte
  },

  {
    kind: 'enchantment',
    id: 'banner',
    name: 'Étendard de guerre',
    cost: 2,
    element: 'fire',
    effect: { type: 'monsterBuff', zone: 'attack', attack: 1, defense: 1 },
  },
  {
    kind: 'enchantment',
    id: 'rampart',
    name: 'Rempart',
    cost: 1, // riposte renforcée ; +1 défense (même à 2 ou 3 +1/+1) ne valait jamais son prix
    element: 'earth',
    effect: { type: 'monsterBuff', zone: 'defense', attack: 1, defense: 0 },
  },
  {
    kind: 'enchantment',
    id: 'treasury',
    name: 'Trésorerie',
    cost: 2, // les parties sont courtes : à 3, elle n'était presque jamais rentabilisée
    element: 'water',
    effect: { type: 'coinsPerTurn', amount: 1 },
  },
  {
    kind: 'enchantment',
    id: 'blessing',
    name: 'Bénédiction',
    cost: 4,
    element: 'water',
    effect: { type: 'monsterBuff', zone: 'all', attack: 1, defense: 1 },
  },
];

export function getCardDef(cardId: string): CardDef {
  const def = CARD_CATALOG.find((c) => c.id === cardId);
  if (!def) throw new Error(`Carte inconnue: ${cardId}`);
  return def;
}

export function isMonster(def: CardDef): def is MonsterDef {
  return def.kind === 'monster';
}

// Roue des éléments (demande utilisateur) : chaque élément est efficace contre celui qu'il
// pointe — eau > feu > air > terre > eau. Deux éléments non adjacents (eau/air, feu/terre)
// ou identiques sont neutres l'un pour l'autre.
export const ELEMENT_BEATS: Record<CardElement, CardElement> = {
  water: 'fire',
  fire: 'air',
  air: 'earth',
  earth: 'water',
};

export const ELEMENT_LABELS: Record<CardElement, string> = {
  fire: 'Feu',
  water: 'Eau',
  air: 'Air',
  earth: 'Terre',
};

export function isElementEffective(from: CardElement, against: CardElement): boolean {
  return ELEMENT_BEATS[from] === against;
}

// ---------------------------------------------------------------------------------------
// Habiletés (mots-clés) — demande utilisateur. Valeurs chiffrées ici (côté données), règles
// dans rules.ts : ce fichier ne dépend jamais de rules.ts (c'est rules.ts qui l'importe).
// ---------------------------------------------------------------------------------------

// Portée : dégâts infligés à CHAQUE voisin de la cible, +1 si le monstre est doré et +1 de
// plus si son élément est efficace contre celui du voisin touché.
export const KEYWORD_REACH_DAMAGE = 1;
export const KEYWORD_REACH_GOLDEN_BONUS = 1;
// Négociant : pièces en plus rendues par la vente (1 → 2, ou 3 → 4 pour une carte dorée).
export const KEYWORD_MERCHANT_BONUS = 1;
// Protection : nombre d'attaques encaissées sans dégât, remis à neuf à chaque combat.
export const KEYWORD_PROTECTION_USES = 1;

export const KEYWORD_LABELS: Record<Keyword, string> = {
  reach: 'Portée',
  taunt: 'Provocation',
  protection: 'Protection',
  merchant: 'Négociant',
  fury: 'Furie',
  toxic: 'Toxic',
};

// Texte affiché après le nom de l'habileté sur la face de la carte, ex. « Portée : … ».
// `golden` ne change que Portée (seule habileté chiffrée à profiter de la dorure).
export function describeKeywordEffect(keyword: Keyword, golden = false): string {
  switch (keyword) {
    case 'reach': {
      const damage = KEYWORD_REACH_DAMAGE + (golden ? KEYWORD_REACH_GOLDEN_BONUS : 0);
      return `touche aussi les monstres autour de sa cible (${damage} ${pluralize(damage, 'dégât')})`;
    }
    case 'taunt':
      return "doit être attaqué en priorité tant qu'il est en vie";
    case 'protection':
      return 'annule les premiers dégâts reçus à chaque combat';
    case 'merchant':
      return `rapporte ${KEYWORD_MERCHANT_BONUS} pièce de plus à la vente`;
    case 'fury':
      return 'reporte ses dégâts en excès sur le défenseur suivant';
    case 'toxic':
      return 'tue tout monstre à qui il inflige le moindre dégât';
  }
}

// Texte complet affiché sur la face, ex. « Provocation : doit être attaqué en priorité… ».
export function describeKeyword(keyword: Keyword, golden = false): string {
  return `${KEYWORD_LABELS[keyword]} : ${describeKeywordEffect(keyword, golden)}`;
}

export function hasKeywordDef(def: CardDef, keyword: Keyword): boolean {
  return isMonster(def) && (def.keywords?.includes(keyword) ?? false);
}

// Nombre d'exemplaires de chaque carte dans le deck de départ (v12 : 60 cartes au total,
// 48 monstres et 12 enchantements — même proportion qu'avec les 50 cartes de la v11).
// Les cartes à habileté restent minoritaires pour qu'une manche n'en montre pas que ça.
export const STARTER_COUNTS: Record<string, number> = {
  squire: 4,
  wolf: 4,
  guard: 4,
  archer: 4,
  druid: 2,
  knight: 4,
  stormMage: 2,
  golem: 3,
  drake: 3,
  titan: 2,
  peddler: 2,
  harpooner: 3,
  berserker: 3,
  sentinel: 2,
  spider: 2,
  wasp: 2,
  relicKeeper: 2,
  banner: 3,
  rampart: 3,
  treasury: 3,
  blessing: 3,
};

export function createCardInstance(cardId: string, makeUid: () => string): CardInstance {
  const def = getCardDef(cardId);
  return { uid: makeUid(), cardId: def.id };
}

export function buildStarterDeck(makeUid: () => string): CardInstance[] {
  const deck: CardInstance[] = [];
  for (const [cardId, count] of Object.entries(STARTER_COUNTS)) {
    for (let i = 0; i < count; i++) {
      deck.push(createCardInstance(cardId, makeUid));
    }
  }
  return deck;
}

// Texte affiché sur la face d'un enchantement, généré depuis l'effet — jamais stocké à part.
export function describeEffect(effect: EnchantmentEffect): string {
  switch (effect.type) {
    case 'coinsPerTurn':
      return `+${effect.amount} pièce au début de ton tour`;
    case 'monsterBuff': {
      const stats =
        effect.attack > 0 && effect.defense > 0
          ? `+${effect.attack}/+${effect.defense}`
          : effect.attack > 0
            ? `+${effect.attack} attaque`
            : `+${effect.defense} défense`;
      switch (effect.zone) {
        case 'attack':
          return `${stats} à tes monstres en attaque`;
        case 'defense':
          return `${stats} à tes monstres en défense`;
        case 'all':
          return `${stats} à tous tes monstres`;
      }
    }
  }
}

// Valeurs d'un effet de capacité multipliées (monstre doré : `GOLDEN_MULTIPLIER`).
export function scaleAbilityEffect(effect: AbilityEffect, multiplier: number): AbilityEffect {
  if (multiplier === 1) return effect;
  switch (effect.type) {
    case 'drawCard':
    case 'extraMarketCard':
      return { ...effect, count: effect.count * multiplier };
    case 'buff':
      return { ...effect, attack: effect.attack * multiplier, defense: effect.defense * multiplier };
    default:
      return { ...effect, amount: effect.amount * multiplier };
  }
}

// Texte affiché sur la face d'un monstre à aura, généré depuis la donnée.
export function describeAura(aura: { attack: number; defense: number }): string {
  const stats =
    aura.attack > 0 && aura.defense > 0
      ? `+${aura.attack}/+${aura.defense}`
      : aura.attack > 0
        ? `+${aura.attack} attaque`
        : `+${aura.defense} défense`;
  return `${stats} à tes autres monstres`;
}

// Libellés affichés des déclencheurs (PLAN-effets-triggers.md §4).
export const TRIGGER_LABELS: Record<Trigger, string> = {
  summon: 'Invoqué',
  combatStart: 'Début du combat',
  attack: 'Attaque',
  defend: 'Défend',
  ko: 'KO',
  sold: 'Vendu',
};

function pluralize(amount: number, word: string): string {
  return amount > 1 ? `${word}s` : word;
}

// Texte d'un effet de capacité, généré depuis sa donnée — jamais stocké à part.
function describeAbilityEffect(effect: AbilityEffect): string {
  switch (effect.type) {
    case 'gainCoins':
      return `+${effect.amount} ${pluralize(effect.amount, 'pièce')}`;
    case 'damageOpponent':
      return `${effect.amount} ${pluralize(effect.amount, 'dégât')} au héros adverse`;
    case 'healSelf':
      return `+${effect.amount} PV à ton héros`;
    case 'drawCard':
      return `pioche ${effect.count} ${pluralize(effect.count, 'carte')}`;
    case 'buff': {
      const stats =
        effect.attack > 0 && effect.defense > 0
          ? `+${effect.attack}/+${effect.defense}`
          : effect.attack > 0
            ? `+${effect.attack} attaque`
            : `+${effect.defense} défense`;
      return effect.target === 'self' ? `gagne ${stats}` : `${stats} à tes autres monstres`;
    }
    case 'bonusDamage':
      return `+${effect.amount} ${pluralize(effect.amount, 'dégât')} sur ce coup`;
    case 'shield':
      return `subit ${effect.amount} ${pluralize(effect.amount, 'dégât')} de moins`;
    case 'extraMarketCard':
      return `+${effect.count} ${pluralize(effect.count, 'carte')} au marché au prochain tour`;
  }
}

// Texte complet d'une capacité affiché sur la face de la carte, ex. « Invoqué : +1 pièce ».
export function describeAbility(ability: CardAbility): string {
  const trigger = TRIGGER_LABELS[ability.trigger] + (ability.oncePerCombat ? ' (1×/combat)' : '');
  return `${trigger} : ${describeAbilityEffect(ability.effect)}`;
}

// E12 (+ combat réservé aux monstres) : `bonusDamage` seulement sur Attaque, `shield`
// seulement sur Défend ; `combatStart`/`attack`/`defend`/`ko` interdits sur un enchantement ; `amount`/
// `count` doivent valoir au moins 1 (E16).
export function isAbilityAllowed(def: CardDef, ability: CardAbility): boolean {
  const { trigger, effect } = ability;
  if (effect.type === 'bonusDamage' && trigger !== 'attack') return false;
  if (effect.type === 'shield' && trigger !== 'defend') return false;
  const combatTriggers: Trigger[] = ['combatStart', 'attack', 'defend', 'ko'];
  if (def.kind === 'enchantment' && combatTriggers.includes(trigger)) return false;

  switch (effect.type) {
    case 'gainCoins':
    case 'damageOpponent':
    case 'healSelf':
    case 'bonusDamage':
    case 'shield':
      return effect.amount >= 1;
    case 'drawCard':
    case 'extraMarketCard':
      return effect.count >= 1;
    case 'buff':
      return true;
  }
}
