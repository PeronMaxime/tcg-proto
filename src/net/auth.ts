import {
  browserSessionPersistence,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import { getFirebaseApp, hasFirebaseConfig } from './firebase';

// Connexion du panneau d'administration. Le compte est créé à la main dans la console
// Firebase (Authentication → Utilisateurs) : il n'y a pas d'inscription dans l'application.
//
// ATTENTION : ce module ne fait qu'afficher ou masquer l'interface. La vraie protection est
// dans `firestore.rules`, qui n'autorise l'écriture de `catalog/current` qu'aux uid listés.
// Sans cette règle publiée, n'importe qui peut écrire le catalogue, quel que soit l'écran.

export class AuthError extends Error {}

// Uid autorisés à voir le panneau, séparés par des virgules (voir `.env.example`). Les mêmes
// uid doivent figurer dans `firestore.rules`.
const ADMIN_UIDS = (import.meta.env.VITE_ADMIN_UIDS ?? '')
  .split(',')
  .map((uid: string) => uid.trim())
  .filter(Boolean);

// Aucun uid configuré = pas de liste blanche : tout compte connecté voit le panneau. C'est le
// cas du développement local, où les règles Firestore ne s'appliquent pas de toute façon.
export const hasAdminAllowlist = ADMIN_UIDS.length > 0;

export function isAdminUid(uid: string): boolean {
  return !hasAdminAllowlist || ADMIN_UIDS.includes(uid);
}

// Le login admin ne concerne que le mode Firebase : sans configuration, le catalogue vit dans
// le localStorage de la machine et il n'y a personne à authentifier.
export const isAuthAvailable = hasFirebaseConfig;

let auth: Auth | null = null;

function getAuthInstance(): Auth {
  if (!auth) {
    auth = getAuth(getFirebaseApp());
    // Session par onglet, comme l'identité de joueur (`identity.ts`) : ouvrir l'admin dans un
    // onglet ne connecte pas les autres, et fermer l'onglet déconnecte.
    void setPersistence(auth, browserSessionPersistence);
  }
  return auth;
}

export interface AdminSession {
  uid: string;
  email: string | null;
  isAdmin: boolean;
}

function toSession(user: User): AdminSession {
  return { uid: user.uid, email: user.email, isAdmin: isAdminUid(user.uid) };
}

// S'abonne à l'état de connexion. `null` = personne n'est connecté. Le premier appel arrive
// de façon asynchrone : Firebase restaure la session avant de trancher, d'où l'écran
// « chargement » de `AdminScreen`.
export function subscribeToAdminSession(cb: (session: AdminSession | null) => void): () => void {
  if (!isAuthAvailable) {
    cb(null);
    return () => {};
  }
  return onAuthStateChanged(getAuthInstance(), (user) => cb(user ? toSession(user) : null));
}

export async function signIn(email: string, password: string): Promise<AdminSession> {
  if (!isAuthAvailable) {
    throw new AuthError("Firebase n'est pas configuré : il n'y a pas de compte à connecter.");
  }
  try {
    const credential = await signInWithEmailAndPassword(getAuthInstance(), email, password);
    return toSession(credential.user);
  } catch (e) {
    // Les codes d'erreur Firebase ne sont pas présentables tels quels. `invalid-credential`
    // couvre aussi bien l'e-mail inconnu que le mauvais mot de passe (Firebase ne distingue
    // plus les deux, pour ne pas révéler quels comptes existent).
    const code = (e as { code?: string }).code ?? '';
    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
      throw new AuthError('E-mail ou mot de passe incorrect.');
    }
    if (code === 'auth/invalid-email') throw new AuthError("L'adresse e-mail n'est pas valide.");
    if (code === 'auth/too-many-requests') {
      throw new AuthError('Trop de tentatives. Réessaie dans quelques minutes.');
    }
    if (code === 'auth/operation-not-allowed') {
      throw new AuthError(
        "La connexion par e-mail n'est pas activée sur le projet Firebase (console → Authentication → Sign-in method).",
      );
    }
    throw new AuthError(e instanceof Error ? e.message : 'Connexion impossible.');
  }
}

export async function signOutAdmin(): Promise<void> {
  if (!isAuthAvailable) return;
  await signOut(getAuthInstance());
}
