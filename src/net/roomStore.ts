import type { Room } from '../game/types';
import { firebaseStore } from './firebaseStore';
import { localStore } from './localStore';

export interface RoomStore {
  // Lecture-modification-écriture atomique. `fn` reçoit null si la room n'existe pas,
  // retourne la nouvelle room à écrire ou null pour ne rien écrire.
  // Une erreur levée dans `fn` annule et est propagée à l'appelant.
  transact(code: string, fn: (room: Room | null) => Room | null): Promise<Room | null>;
  // Écriture directe, sans transaction (utilisée pour les actions de jeu, voir §5).
  set(code: string, room: Room): Promise<void>;
  subscribe(code: string, cb: (room: Room | null) => void): () => void;
  readonly isLocal: boolean;
}

// Le mode Firebase est actif si VITE_FIREBASE_PROJECT_ID est renseignée ; sinon, tout
// passe par localStorage pour pouvoir jouer à deux onglets sans configuration.
const hasFirebaseConfig = Boolean(import.meta.env.VITE_FIREBASE_PROJECT_ID);

export const roomStore: RoomStore = hasFirebaseConfig ? firebaseStore : localStore;
