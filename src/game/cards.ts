import type {
  AbilityEffect,
  CardAbility,
  CardDef,
  CardElement,
  CardInstance,
  EnchantmentEffect,
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

export const CARD_CATALOG: CardDef[] = [
  {
    kind: 'monster',
    id: 'squire',
    name: 'Écuyer',
    cost: 2, // à 1, achat + Invoqué + vente rapportait une pièce nette
    attack: 1,
    defense: 2,
    element: 'air',
    abilities: [
      { trigger: 'summon', effect: { type: 'gainCoins', amount: 1 } },
      { trigger: 'ko', effect: { type: 'drawCard', count: 1 } },
    ],
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
    cost: 2,
    attack: 1,
    defense: 4,
    element: 'water',
    abilities: [{ trigger: 'defend', effect: { type: 'shield', amount: 1 } }],
  },
  {
    kind: 'monster',
    id: 'archer',
    name: 'Archère',
    cost: 3,
    attack: 3,
    defense: 2,
    element: 'air',
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
    abilities: [{ trigger: 'attack', effect: { type: 'buff', target: 'self', attack: 1, defense: 0 } }],
  },
  {
    kind: 'monster',
    id: 'golem',
    name: 'Golem de pierre',
    cost: 6,
    attack: 1,
    defense: 8,
    element: 'earth',
    abilities: [{ trigger: 'defend', effect: { type: 'damageOpponent', amount: 1 } }],
  },
  {
    kind: 'monster',
    id: 'drake',
    name: 'Drake',
    cost: 6,
    attack: 5,
    defense: 4,
    element: 'fire',
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
    abilities: [{ trigger: 'summon', effect: { type: 'buff', target: 'otherAllies', attack: 1, defense: 1 } }],
  },

  {
    kind: 'enchantment',
    id: 'banner',
    name: 'Étendard de guerre',
    cost: 2,
    element: 'fire',
    effect: { type: 'monsterBuff', zone: 'attack', attack: 1, defense: 0 },
  },
  {
    kind: 'enchantment',
    id: 'rampart',
    name: 'Rempart',
    cost: 2,
    element: 'earth',
    effect: { type: 'monsterBuff', zone: 'defense', attack: 0, defense: 1 },
  },
  {
    kind: 'enchantment',
    id: 'treasury',
    name: 'Trésorerie',
    cost: 3,
    element: 'water',
    effect: { type: 'coinsPerTurn', amount: 1 },
    // Vendu +1 (+ la pièce de vente) : rend 2 des 3 pièces, plus remboursée intégralement.
    abilities: [{ trigger: 'sold', effect: { type: 'gainCoins', amount: 1 } }],
  },
  {
    kind: 'enchantment',
    id: 'blessing',
    name: 'Bénédiction',
    cost: 5,
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

// Nombre d'exemplaires de chaque carte dans le deck de départ (50 cartes au total :
// 40 monstres, 10 enchantements).
export const STARTER_COUNTS: Record<string, number> = {
  squire: 7,
  wolf: 6,
  guard: 6,
  archer: 6,
  knight: 5,
  golem: 4,
  drake: 3,
  titan: 3,
  banner: 3,
  rampart: 3,
  treasury: 2,
  blessing: 2,
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

// Libellés affichés des déclencheurs (PLAN-effets-triggers.md §4).
export const TRIGGER_LABELS: Record<Trigger, string> = {
  summon: 'Invoqué',
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
  }
}

// Texte complet d'une capacité affiché sur la face de la carte, ex. « Invoqué : +1 pièce ».
export function describeAbility(ability: CardAbility): string {
  return `${TRIGGER_LABELS[ability.trigger]} : ${describeAbilityEffect(ability.effect)}`;
}

// E12 (+ combat réservé aux monstres) : `bonusDamage` seulement sur Attaque, `shield`
// seulement sur Défend ; `attack`/`defend`/`ko` interdits sur un enchantement ; `amount`/
// `count` doivent valoir au moins 1 (E16).
export function isAbilityAllowed(def: CardDef, ability: CardAbility): boolean {
  const { trigger, effect } = ability;
  if (effect.type === 'bonusDamage' && trigger !== 'attack') return false;
  if (effect.type === 'shield' && trigger !== 'defend') return false;
  if (def.kind === 'enchantment' && (trigger === 'attack' || trigger === 'defend' || trigger === 'ko')) return false;

  switch (effect.type) {
    case 'gainCoins':
    case 'damageOpponent':
    case 'healSelf':
    case 'bonusDamage':
    case 'shield':
      return effect.amount >= 1;
    case 'drawCard':
      return effect.count >= 1;
    case 'buff':
      return true;
  }
}
