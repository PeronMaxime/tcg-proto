import { beforeEach, describe, expect, it } from 'vitest';
import { setActiveCatalog } from './cards';
import { migrateCatalogToV2, parseCatalog } from './catalogSchema';
import { DECK_SIZE, defaultDeck, deckProblems, nextFreeDeckId, playableDecks, resolveDecks } from './decks';
import { DEFAULT_CATALOG } from './defaultCatalog';
import { createInitialState } from './rules';
import type { CardDef, Catalog, DeckDef } from './types';

// Decks à choisir (V2) : validation, choix par défaut, construction des decks de la partie.

function monster(id: string): CardDef {
  return { kind: 'monster', id, name: id, cost: 1, element: 'earth', rarity: 'common', attack: 1, defense: 2 };
}

const CARDS = [monster('grunt'), monster('wall'), monster('oak')];

function deck(id: string, counts: Record<string, number>): DeckDef {
  return { id, name: id, counts };
}

const FULL_GRUNT = deck('grunts', { grunt: DECK_SIZE });
const MIXED = deck('mixed', { wall: 30, oak: 30 });
const SHORT = deck('short', { grunt: 10 });

function v2Catalog(decks: DeckDef[]): Catalog {
  return { version: 1, cards: CARDS, starterCounts: {}, gameVersion: 'v2', decks };
}

beforeEach(() => setActiveCatalog(v2Catalog([FULL_GRUNT, MIXED])));

describe('decks jouables', () => {
  it(`n'accepte qu'un deck de ${DECK_SIZE} cartes pile`, () => {
    const catalog = v2Catalog([SHORT, FULL_GRUNT, deck('big', { grunt: DECK_SIZE + 1 })]);
    expect(playableDecks(catalog).map((d) => d.id)).toEqual(['grunts']);
    expect(deckProblems(SHORT, catalog)).toEqual([`10 cartes sur ${DECK_SIZE}`]);
  });

  it('refuse un deck qui contient une carte absente du catalogue', () => {
    const catalog = v2Catalog([deck('ghost', { grunt: DECK_SIZE - 1, ghost: 1 })]);
    expect(playableDecks(catalog)).toEqual([]);
  });

  it('refuse un deck qui dépasse la limite d’exemplaires de la rareté', () => {
    const catalog: Catalog = { ...v2Catalog([MIXED]), maxCopiesByRarity: { common: 30 } };
    expect(deckProblems(MIXED, catalog)).toEqual([]);
    const limited: Catalog = { ...catalog, maxCopiesByRarity: { common: 4 } };
    expect(deckProblems(MIXED, limited)).toEqual([
      'wall : 30 exemplaires, 4 au plus (commune)',
      'oak : 30 exemplaires, 4 au plus (commune)',
    ]);
    // Une limite sur une autre rareté ne touche pas ces cartes.
    expect(deckProblems(MIXED, { ...catalog, maxCopiesByRarity: { rare: 1 } })).toEqual([]);
  });

  it('lit la limite d’exemplaires par rareté et refuse une rareté inconnue', () => {
    const raw = { ...v2Catalog([MIXED]), maxCopiesByRarity: { common: 3, legendary: 1 } };
    const parsed = parseCatalog(raw, 'v2');
    expect(parsed.ok && parsed.value.maxCopiesByRarity).toEqual({ common: 3, legendary: 1 });
    expect(parseCatalog({ ...raw, maxCopiesByRarity: { mythic: 1 } }, 'v2').ok).toBe(false);
    const empty = parseCatalog({ ...raw, maxCopiesByRarity: {} }, 'v2');
    expect(empty.ok && 'maxCopiesByRarity' in empty.value).toBe(false);
  });

  it('le deck par défaut est le premier deck jouable de la liste', () => {
    expect(defaultDeck(v2Catalog([SHORT, MIXED, FULL_GRUNT]))?.id).toBe('mixed');
    expect(defaultDeck(v2Catalog([SHORT]))).toBeNull();
  });

  it('attribue le deck par défaut au siège qui n’a pas choisi (ou a choisi un deck injouable)', () => {
    const catalog = v2Catalog([FULL_GRUNT, MIXED, SHORT]);
    const decks = resolveDecks(catalog, { p1: null, p2: 'mixed' });
    expect(decks?.p1.id).toBe('grunts');
    expect(decks?.p2.id).toBe('mixed');
    expect(resolveDecks(catalog, { p1: 'short', p2: 'inconnu' })?.p1.id).toBe('grunts');
    expect(resolveDecks(v2Catalog([SHORT]), { p1: null, p2: null })).toBeNull();
  });

  it('propose un identifiant libre', () => {
    expect(nextFreeDeckId([])).toBe('deck1');
    expect(nextFreeDeckId([deck('deck1', {}), deck('deck3', {})])).toBe('deck2');
  });
});

describe('createInitialState avec un deck par siège', () => {
  it('construit le deck de chaque joueur depuis sa composition', () => {
    const state = createInitialState(Math.random, { p1: FULL_GRUNT.counts, p2: MIXED.counts });
    const ids = (seat: 'p1' | 'p2') => new Set(state.players[seat].deck.map((c) => c.cardId));
    expect(state.players.p1.deck).toHaveLength(DECK_SIZE);
    expect(state.players.p2.deck).toHaveLength(DECK_SIZE);
    expect(ids('p1')).toEqual(new Set(['grunt']));
    expect(ids('p2')).toEqual(new Set(['wall', 'oak']));
    // Uids uniques sur toute la partie : ce sont les keys React des cartes.
    const uids = [...state.players.p1.deck, ...state.players.p2.deck].map((c) => c.uid);
    expect(new Set(uids).size).toBe(uids.length);
  });
});

describe('decks dans le catalogue', () => {
  it('valide les decks d’un catalogue V2, même incomplets', () => {
    const parsed = parseCatalog(v2Catalog([SHORT, FULL_GRUNT]), 'v2');
    expect(parsed.ok && parsed.value.decks?.map((d) => d.id)).toEqual(['short', 'grunts']);
  });

  it('refuse un deck sans nom, en double ou qui référence une carte inconnue', () => {
    expect(parseCatalog(v2Catalog([{ ...FULL_GRUNT, name: '  ' }]), 'v2').ok).toBe(false);
    expect(parseCatalog(v2Catalog([FULL_GRUNT, FULL_GRUNT]), 'v2').ok).toBe(false);
    expect(parseCatalog(v2Catalog([deck('ghost', { ghost: 1 })]), 'v2').ok).toBe(false);
  });

  it('ignore les decks en V1', () => {
    const parsed = parseCatalog({ ...DEFAULT_CATALOG, decks: [FULL_GRUNT] });
    expect(parsed.ok && parsed.value.decks).toBeUndefined();
  });

  it('le passage en V2 fait du deck de départ le premier deck', () => {
    const parsed = parseCatalog(migrateCatalogToV2(DEFAULT_CATALOG), 'v2');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.starterCounts).toEqual({});
    expect(parsed.value.decks).toHaveLength(1);
    expect(parsed.value.decks?.[0].name).toBe('Deck de départ');
    // Seules les cartes qui existent encore en V2 y restent.
    const ids = new Set(parsed.value.cards.map((c) => c.id));
    expect(Object.keys(parsed.value.decks?.[0].counts ?? {}).every((id) => ids.has(id))).toBe(true);
  });

  it('le passage en V2 garde les decks existants', () => {
    const parsed = parseCatalog(migrateCatalogToV2(v2Catalog([MIXED])), 'v2');
    expect(parsed.ok && parsed.value.decks).toEqual([MIXED]);
  });
});
