import type { CardDef, CardInstance } from './types';

// Catalogue provisoire, sans capacités spéciales — voir rules.ts pour le disclaimer complet.
export const CARD_CATALOG: CardDef[] = [
  { id: 'squire', name: 'Écuyer', cost: 1, attack: 1, health: 2, color: '#8fae6b' },
  { id: 'wolf', name: 'Loup gris', cost: 2, attack: 3, health: 1, color: '#7c7c8a' },
  { id: 'guard', name: 'Garde du pont', cost: 2, attack: 2, health: 3, color: '#6b8fae' },
  { id: 'archer', name: 'Archère', cost: 3, attack: 3, health: 2, color: '#ae8f6b' },
  { id: 'knight', name: 'Chevalier', cost: 4, attack: 4, health: 4, color: '#ae6b8f' },
  { id: 'golem', name: 'Golem de pierre', cost: 5, attack: 3, health: 7, color: '#8a7c7c' },
  { id: 'drake', name: 'Drake', cost: 6, attack: 6, health: 5, color: '#b0453f' },
  { id: 'titan', name: 'Titan', cost: 8, attack: 8, health: 8, color: '#c9a441' },
];

export function getCardDef(cardId: string): CardDef {
  const def = CARD_CATALOG.find((c) => c.id === cardId);
  if (!def) throw new Error(`Carte inconnue: ${cardId}`);
  return def;
}

// Nombre d'exemplaires de chaque carte dans un deck de départ (20 cartes au total).
const STARTER_COUNTS: Record<string, number> = {
  squire: 3,
  wolf: 3,
  guard: 3,
  archer: 3,
  knight: 2,
  golem: 2,
  drake: 2,
  titan: 2,
};

export function createCardInstance(cardId: string, makeUid: () => string): CardInstance {
  const def = getCardDef(cardId);
  return {
    uid: makeUid(),
    cardId: def.id,
    attack: def.attack,
    health: def.health,
    maxHealth: def.health,
    canAttack: false,
  };
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
