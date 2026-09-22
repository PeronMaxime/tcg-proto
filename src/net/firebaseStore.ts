import { deleteDoc, doc, onSnapshot, runTransaction, setDoc } from 'firebase/firestore';
import type { Room } from '../game/types';
import { getDb } from './firebase';
import type { RoomStore } from './roomStore';

function roomRef(code: string) {
  return doc(getDb(), 'rooms', code);
}

export const firebaseStore: RoomStore = {
  isLocal: false,

  async transact(code, fn) {
    return runTransaction(getDb(), async (tx) => {
      const snap = await tx.get(roomRef(code));
      const current = snap.exists() ? (snap.data() as Room) : null;
      const next = fn(current);
      if (next !== null) tx.set(roomRef(code), next);
      return next;
    });
  },

  async set(code, room) {
    await setDoc(roomRef(code), room);
  },

  async remove(code) {
    await deleteDoc(roomRef(code));
  },

  subscribe(code, cb) {
    return onSnapshot(roomRef(code), (snap) => {
      cb(snap.exists() ? (snap.data() as Room) : null);
    });
  },
};
