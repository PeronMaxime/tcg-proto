import { initializeApp } from 'firebase/app';
import {
  doc,
  initializeFirestore,
  onSnapshot,
  runTransaction,
  setDoc,
  type Firestore,
} from 'firebase/firestore';
import type { Room } from '../game/types';
import type { RoomStore } from './roomStore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

let db: Firestore | null = null;

function getDb(): Firestore {
  if (!db) {
    const app = initializeApp(firebaseConfig);
    db = initializeFirestore(app, {
      // Firestore refuse les valeurs `undefined` : le code utilise `null` partout,
      // cette option n'est qu'un filet de sécurité.
      ignoreUndefinedProperties: true,
      // Certains réseaux mobiles/opérateurs bloquent le canal de streaming (WebChannel)
      // utilisé par `onSnapshot` : les écritures/lectures ponctuelles passent, mais les
      // mises à jour temps réel n'arrivent jamais. Le long-polling contourne le blocage.
      experimentalAutoDetectLongPolling: true,
    });
  }
  return db;
}

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

  subscribe(code, cb) {
    return onSnapshot(roomRef(code), (snap) => {
      cb(snap.exists() ? (snap.data() as Room) : null);
    });
  },
};
