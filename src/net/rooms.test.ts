import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardDef, Catalog, Room } from '../game/types';

// Choix des decks (V2) : de l'arrivée du second joueur au démarrage de la partie, délai écoulé
// et revanche comprises. Magasins LOCAUX, comme `catalogStore.test.ts` (voir ses explications
// sur la neutralisation de Firebase et le rechargement des modules).

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  clear(): void {
    this.data.clear();
  }
}

const storage = new MemoryStorage();
// Un `sessionStorage` par joueur : c'est lui qui porte l'identité (`identity.ts`).
const sessions = { p1: new MemoryStorage(), p2: new MemoryStorage() };

function playAs(seat: 'p1' | 'p2') {
  Object.assign(globalThis, { sessionStorage: sessions[seat] });
}

function monster(id: string): CardDef {
  return { kind: 'monster', id, name: id, cost: 1, element: 'earth', rarity: 'common', attack: 1, defense: 2 };
}

const V2: Catalog = {
  version: 1,
  cards: [monster('grunt'), monster('wall')],
  starterCounts: {},
  gameVersion: 'v2',
  decks: [
    { id: 'incomplet', name: 'Incomplet', counts: { grunt: 3 } },
    { id: 'grunts', name: 'Grunts', counts: { grunt: 60 } },
    { id: 'walls', name: 'Murs', counts: { wall: 60 } },
  ],
};

beforeEach(() => {
  vi.stubEnv('VITE_FIREBASE_PROJECT_ID', '');
  vi.resetModules();
  storage.clear();
  sessions.p1.clear();
  sessions.p2.clear();
  Object.assign(globalThis, {
    localStorage: storage,
    window: { addEventListener: () => {}, removeEventListener: () => {} },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  storage.clear();
});

async function setup(catalog: Catalog = V2) {
  const { catalogStore } = await import('./catalogStore');
  await catalogStore.save('v2', catalog);
  const rooms = await import('./rooms');
  playAs('p1');
  const code = await rooms.createRoom('v2');
  playAs('p2');
  await rooms.joinRoom(code);
  const { roomStore } = await import('./roomStore');
  const get = async () => (await roomStore.get(code)) as Room;
  return { rooms, code, get };
}

function deckOf(room: Room, seat: 'p1' | 'p2'): Set<string> {
  return new Set(room.state?.players[seat].deck.map((card) => card.cardId));
}

describe('choix des decks (V2)', () => {
  it('l’arrivée du second joueur ouvre le choix au lieu de démarrer la partie', async () => {
    const { get } = await setup();
    const room = await get();
    expect(room.status).toBe('choosingDecks');
    expect(room.state).toBeNull();
    expect(room.deckChoice).toEqual({ p1: null, p2: null });
    expect(room.catalog?.decks).toHaveLength(3);
  });

  it('démarre la partie quand les deux joueurs ont validé, chacun avec son deck', async () => {
    const { rooms, get } = await setup();
    await rooms.chooseDeck(await get(), 'p1', 'walls');
    expect((await get()).status).toBe('choosingDecks');
    await rooms.chooseDeck(await get(), 'p2', 'grunts');
    const room = await get();
    expect(room.status).toBe('playing');
    expect(deckOf(room, 'p1')).toEqual(new Set(['wall']));
    expect(deckOf(room, 'p2')).toEqual(new Set(['grunt']));
  });

  it('un choix validé est définitif', async () => {
    const { rooms, get } = await setup();
    await rooms.chooseDeck(await get(), 'p1', 'walls');
    await rooms.chooseDeck(await get(), 'p1', 'grunts');
    expect((await get()).deckChoice?.p1).toBe('walls');
  });

  it('le délai écoulé attribue le premier deck jouable à qui n’a pas choisi', async () => {
    const { rooms, get } = await setup();
    await rooms.chooseDeck(await get(), 'p2', 'walls');
    // Trop tôt : rien ne bouge.
    await rooms.expireDeckChoice(await get());
    expect((await get()).status).toBe('choosingDecks');

    vi.useFakeTimers({ now: (await get()).deckDeadline! + 1 });
    await rooms.expireDeckChoice(await get());
    const room = await get();
    expect(room.status).toBe('playing');
    expect(room.deckChoice).toEqual({ p1: 'grunts', p2: 'walls' });
    expect(deckOf(room, 'p1')).toEqual(new Set(['grunt']));
  });

  it('la revanche repasse par le choix des decks', async () => {
    const { rooms, get } = await setup();
    await rooms.chooseDeck(await get(), 'p1', 'walls');
    await rooms.chooseDeck(await get(), 'p2', 'walls');
    await rooms.requestRematch(await get(), 'p1');
    await rooms.requestRematch(await get(), 'p2');
    const room = await get();
    expect(room.status).toBe('choosingDecks');
    expect(room.state).toBeNull();
    expect(room.deckChoice).toEqual({ p1: null, p2: null });
  });

  it('refuse de créer une partie V2 sans deck complet', async () => {
    const { catalogStore } = await import('./catalogStore');
    await catalogStore.save('v2', { ...V2, decks: [V2.decks![0]] });
    const rooms = await import('./rooms');
    playAs('p1');
    await expect(rooms.createRoom('v2')).rejects.toThrow(/Aucun deck complet/);
  });
});
