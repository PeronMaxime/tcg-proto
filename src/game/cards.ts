import type { CardDef, CardInstance, EnchantmentEffect, MonsterDef } from './types';

// Catalogue des règles v1 — voir PLAN-tcg-proto-regles-v1.md §4. Valeurs de départ, à
// équilibrer en jouant : ce fichier reste le seul endroit à modifier pour changer une carte
// ou la composition du deck.

export const CARD_CATALOG: CardDef[] = [
  { kind: 'monster', id: 'squire', name: 'Écuyer', cost: 1, attack: 1, defense: 2, color: '#8fae6b' },
  { kind: 'monster', id: 'wolf', name: 'Loup gris', cost: 2, attack: 3, defense: 1, color: '#7c7c8a' },
  { kind: 'monster', id: 'guard', name: 'Garde du pont', cost: 2, attack: 1, defense: 4, color: '#6b8fae' },
  { kind: 'monster', id: 'archer', name: 'Archère', cost: 3, attack: 3, defense: 2, color: '#ae8f6b' },
  { kind: 'monster', id: 'knight', name: 'Chevalier', cost: 4, attack: 3, defense: 4, color: '#ae6b8f' },
  { kind: 'monster', id: 'golem', name: 'Golem de pierre', cost: 5, attack: 1, defense: 8, color: '#8a7c7c' },
  { kind: 'monster', id: 'drake', name: 'Drake', cost: 6, attack: 5, defense: 4, color: '#b0453f' },
  { kind: 'monster', id: 'titan', name: 'Titan', cost: 8, attack: 7, defense: 7, color: '#c9a441' },

  {
    kind: 'enchantment',
    id: 'banner',
    name: 'Étendard de guerre',
    cost: 3,
    color: '#8f3ee8',
    effect: { type: 'monsterBuff', zone: 'attack', attack: 1, defense: 0 },
  },
  {
    kind: 'enchantment',
    id: 'rampart',
    name: 'Rempart',
    cost: 3,
    color: '#3e6be8',
    effect: { type: 'monsterBuff', zone: 'defense', attack: 0, defense: 1 },
  },
  {
    kind: 'enchantment',
    id: 'treasury',
    name: 'Trésorerie',
    cost: 3,
    color: '#c9a441',
    effect: { type: 'coinsPerTurn', amount: 1 },
  },
  {
    kind: 'enchantment',
    id: 'blessing',
    name: 'Bénédiction',
    cost: 6,
    color: '#e83e8f',
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
