// Decks à choisir (V2, demande utilisateur). Ils sont composés dans l'admin et rangés dans le
// catalogue (`Catalog.decks`), donc figés dans la room avec lui. Le joueur ne construit rien :
// il choisit l'un d'eux sur l'écran de choix du deck, avant chaque partie (revanches comprises).
//
// Module pur, comme `rules.ts` : pas de réseau, pas de React.

import { RARITY_LABELS, cardRarity } from './cards';
import type { CardDef, Catalog, DeckDef, Seat } from './types';

// Taille d'un deck jouable (demande utilisateur) : ni plus, ni moins.
export const DECK_SIZE = 60;

// Temps laissé pour choisir son deck. Passé ce délai, le deck par défaut est attribué.
export const DECK_CHOICE_MS = 30_000;

export function deckSize(deck: DeckDef): number {
  return Object.values(deck.counts).reduce((a, b) => a + b, 0);
}

// Ce qui empêche de jouer ce deck. Ce n'est pas une erreur d'enregistrement : un deck en cours
// de composition s'enregistre, il n'est simplement pas proposé aux joueurs.
export function deckProblems(deck: DeckDef, catalog: Catalog): string[] {
  const problems: string[] = [];
  const size = deckSize(deck);
  if (size !== DECK_SIZE) problems.push(`${size} cartes sur ${DECK_SIZE}`);
  const ids = new Set(catalog.cards.map((card) => card.id));
  const unknown = Object.keys(deck.counts).filter((id) => !ids.has(id));
  if (unknown.length > 0) problems.push(`cartes inconnues : ${unknown.join(', ')}`);
  // Limite d'exemplaires selon la rareté (onglet « Paramètres » de l'admin).
  for (const card of catalog.cards) {
    const max = maxCopiesFor(catalog, card);
    const count = deck.counts[card.id] ?? 0;
    if (max !== undefined && count > max) {
      problems.push(`${card.name || card.id} : ${count} exemplaires, ${max} au plus (${RARITY_LABELS[cardRarity(card)].toLowerCase()})`);
    }
  }
  return problems;
}

// Nombre maximal d'exemplaires de `card` dans un deck, selon sa rareté. `undefined` = sans limite.
export function maxCopiesFor(catalog: Catalog, card: CardDef): number | undefined {
  return catalog.maxCopiesByRarity?.[cardRarity(card)];
}

export function isDeckPlayable(deck: DeckDef, catalog: Catalog): boolean {
  return deckProblems(deck, catalog).length === 0;
}

// Decks proposés sur l'écran de choix, dans l'ordre de l'admin.
export function playableDecks(catalog: Catalog): DeckDef[] {
  return (catalog.decks ?? []).filter((deck) => isDeckPlayable(deck, catalog));
}

// Deck attribué d'office au joueur qui n'a pas choisi à temps : le premier de la liste.
export function defaultDeck(catalog: Catalog): DeckDef | null {
  return playableDecks(catalog)[0] ?? null;
}

// Composition jouée par chaque siège : son choix s'il est jouable, sinon le deck par défaut.
// Null si le catalogue n'a aucun deck jouable.
export function resolveDecks(
  catalog: Catalog,
  choice: Record<Seat, string | null>,
): Record<Seat, DeckDef> | null {
  const playable = playableDecks(catalog);
  if (playable.length === 0) return null;
  const pick = (id: string | null) => playable.find((deck) => deck.id === id) ?? playable[0];
  return { p1: pick(choice.p1), p2: pick(choice.p2) };
}

// Identifiant libre pour un nouveau deck : `deck1`, `deck2`…
export function nextFreeDeckId(decks: DeckDef[]): string {
  const taken = new Set(decks.map((deck) => deck.id));
  for (let i = 1; ; i++) {
    const id = `deck${i}`;
    if (!taken.has(id)) return id;
  }
}
