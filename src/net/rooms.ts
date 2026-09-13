import { applyAction, createInitialState } from '../game/rules';
import type { Action, Room, Seat } from '../game/types';
import { getPlayerId, getPlayerName } from './identity';
import { generateRoomCode, normalizeRoomCode } from './roomCode';
import { roomStore } from './roomStore';

const MAX_CREATE_ATTEMPTS = 5;
const CURRENT_ROOM_KEY = 'tcg-current-room';
// Code d'une partie quittée volontairement (bouton « Quitter »), pour proposer un lien
// « Reprendre la partie » dans le menu (§ abandon). Distinct de CURRENT_ROOM_KEY, qui ne
// sert qu'à la reconnexion automatique au chargement de la page.
const LEFT_ROOM_KEY = 'tcg-left-room';
// Délai avant d'expulser le joueur restant si l'adversaire ne revient pas (§ abandon).
export const ABANDON_TIMEOUT_MS = 60_000;

function freshLeftAt(): Record<Seat, number | null> {
  return { p1: null, p2: null };
}

export class RoomError extends Error {}

// Code de la room courante (D7) : reconnexion automatique après un rafraîchissement.
export function getCurrentRoomCode(): string | null {
  return sessionStorage.getItem(CURRENT_ROOM_KEY);
}

export function setCurrentRoomCode(code: string): void {
  sessionStorage.setItem(CURRENT_ROOM_KEY, code);
}

export function clearCurrentRoomCode(): void {
  sessionStorage.removeItem(CURRENT_ROOM_KEY);
}

export function getLeftRoomCode(): string | null {
  return sessionStorage.getItem(LEFT_ROOM_KEY);
}

export function rememberLeftRoom(code: string): void {
  sessionStorage.setItem(LEFT_ROOM_KEY, code);
}

export function clearLeftRoomCode(): void {
  sessionStorage.removeItem(LEFT_ROOM_KEY);
}

export async function createRoom(): Promise<string> {
  const player = { id: getPlayerId(), name: getPlayerName() };

  for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
    const code = generateRoomCode();
    const room = await roomStore.transact(code, (existing) => {
      if (existing) return null; // code déjà pris : on retente avec un autre
      const fresh: Room = {
        code,
        status: 'waiting',
        players: { p1: player, p2: null },
        state: null,
        createdAt: Date.now(),
        leftAt: freshLeftAt(),
      };
      return fresh;
    });
    if (room) return code;
  }

  throw new RoomError('Impossible de créer une room, réessaie.');
}

export async function joinRoom(rawCode: string): Promise<Room> {
  const code = normalizeRoomCode(rawCode);
  const player = { id: getPlayerId(), name: getPlayerName() };

  const room = await roomStore.transact(code, (existing) => {
    if (!existing) throw new RoomError('Room introuvable.');
    const existingSeat: Seat | null =
      existing.players.p1.id === player.id ? 'p1' : existing.players.p2?.id === player.id ? 'p2' : null;
    if (existingSeat) {
      // Reconnexion : on efface juste la marque d'abandon éventuelle de ce siège.
      const leftAt = existing.leftAt ?? freshLeftAt();
      if (!leftAt[existingSeat]) return existing;
      return { ...existing, leftAt: { ...leftAt, [existingSeat]: null } };
    }
    if (existing.players.p2) throw new RoomError('Room pleine.');
    const joined: Room = {
      ...existing,
      players: { ...existing.players, p2: player },
      state: createInitialState(),
      status: 'playing',
      leftAt: freshLeftAt(),
    };
    return joined;
  });

  // `fn` ne retourne jamais `null` ci-dessus : soit elle lève, soit elle renvoie une Room.
  return room as Room;
}

export function mySeat(room: Room): Seat | null {
  const id = getPlayerId();
  if (room.players.p1.id === id) return 'p1';
  if (room.players.p2?.id === id) return 'p2';
  return null;
}

export async function sendAction(room: Room, seat: Seat, action: Action): Promise<void> {
  if (!room.state) return;
  const nextState = applyAction(room.state, seat, action);
  if (!nextState) return; // action illégale : on n'envoie rien

  const nextRoom: Room = {
    ...room,
    state: nextState,
    status: nextState.winner ? 'finished' : room.status,
  };
  await roomStore.set(room.code, nextRoom);
}

export async function rematch(room: Room): Promise<void> {
  await roomStore.transact(room.code, (existing) => {
    if (!existing) return null;
    const restarted: Room = {
      ...existing,
      state: createInitialState(),
      status: 'playing',
      leftAt: freshLeftAt(),
    };
    return restarted;
  });
}

// Marque le siège `seat` comme parti (bouton « Quitter » en cours de partie, ou « Retour au
// menu » sur l'écran de victoire au lieu de demander la revanche). Le client adverse expulse
// alors son joueur et supprime la room — immédiatement si la partie est déjà terminée, sinon
// après `ABANDON_TIMEOUT_MS` pour laisser une chance de reconnexion (voir `deleteRoom`,
// utilisés dans GameScreen). Si l'autre siège était déjà marqué parti, plus personne n'attend :
// la room est supprimée immédiatement, terminée ou non.
export async function leaveMatch(room: Room, seat: Seat): Promise<void> {
  const opponentSeat: Seat = seat === 'p1' ? 'p2' : 'p1';

  const updated = await roomStore.transact(room.code, (existing) => {
    if (!existing) return null;
    const leftAt = existing.leftAt ?? freshLeftAt();
    return { ...existing, leftAt: { ...leftAt, [seat]: Date.now() } };
  });

  if (updated?.leftAt?.[opponentSeat]) {
    await roomStore.remove(room.code);
  }
}

export async function deleteRoom(code: string): Promise<void> {
  await roomStore.remove(code);
}

export function subscribeToRoom(code: string, cb: (room: Room | null) => void): () => void {
  return roomStore.subscribe(code, cb);
}
