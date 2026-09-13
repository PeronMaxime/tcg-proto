import type { Room } from '../game/types';
import type { RoomStore } from './roomStore';

type Listener = (room: Room | null) => void;

// Abonnés internes à cet onglet : l'évènement `storage` ne se déclenche que dans
// les AUTRES onglets, jamais dans celui qui écrit.
const localListeners = new Map<string, Set<Listener>>();

function storageKey(code: string): string {
  return `tcg-room:${code}`;
}

function readRoom(code: string): Room | null {
  const raw = localStorage.getItem(storageKey(code));
  return raw ? (JSON.parse(raw) as Room) : null;
}

function writeRoom(code: string, room: Room | null): void {
  if (room === null) {
    localStorage.removeItem(storageKey(code));
  } else {
    localStorage.setItem(storageKey(code), JSON.stringify(room));
  }
  for (const cb of localListeners.get(code) ?? []) cb(room);
}

export const localStore: RoomStore = {
  isLocal: true,

  async transact(code, fn) {
    const next = fn(readRoom(code));
    if (next !== null) writeRoom(code, next);
    return next;
  },

  async set(code, room) {
    writeRoom(code, room);
  },

  subscribe(code, cb) {
    let listeners = localListeners.get(code);
    if (!listeners) {
      listeners = new Set();
      localListeners.set(code, listeners);
    }
    listeners.add(cb);

    const onStorage = (e: StorageEvent) => {
      if (e.key !== storageKey(code)) return;
      cb(e.newValue ? (JSON.parse(e.newValue) as Room) : null);
    };
    window.addEventListener('storage', onStorage);

    cb(readRoom(code)); // état courant immédiat, comme le ferait onSnapshot de Firestore

    return () => {
      listeners.delete(cb);
      window.removeEventListener('storage', onStorage);
    };
  },
};
