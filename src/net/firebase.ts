import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeFirestore, type Firestore } from 'firebase/firestore';

// Point d'entrée unique vers Firebase : `firebaseStore` (rooms), `catalogStore` (cartes) et
// `auth` (login admin) doivent partager la MÊME instance d'application, sinon `initializeApp`
// lève à la deuxième initialisation.

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Le mode Firebase est actif si VITE_FIREBASE_PROJECT_ID est renseignée ; sinon, tout passe
// par localStorage pour pouvoir jouer à deux onglets sans configuration (voir README §1).
export const hasFirebaseConfig = Boolean(import.meta.env.VITE_FIREBASE_PROJECT_ID);

let app: FirebaseApp | null = null;
let db: Firestore | null = null;

export function getFirebaseApp(): FirebaseApp {
  if (!app) app = getApps()[0] ?? initializeApp(firebaseConfig);
  return app;
}

export function getDb(): Firestore {
  if (!db) {
    db = initializeFirestore(getFirebaseApp(), {
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
