import { setActiveCatalog } from '../game/cards';
import { applyAction, createInitialState } from '../game/rules';
import type { Action, Catalog, GameState, Room, Seat } from '../game/types';
import { loadPlayableCatalog } from './catalogStore';
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

function freshRematchReady(): Record<Seat, boolean> {
  return { p1: false, p2: false };
}

export class RoomError extends Error {}

// Prépare une nouvelle partie : on lit le catalogue partagé, on l'installe comme catalogue
// actif (`createInitialState` construit les decks avec, via `buildStarterDeck`) et on le rend
// pour qu'il soit FIGÉ dans la room. Une carte modifiée dans l'admin après ce point ne touche
// donc plus cette partie — elle s'appliquera à la suivante.
//
// Appelé avant d'ouvrir la transaction : le catalogue se lit de façon asynchrone, alors que
// les callbacks de `roomStore.transact` sont synchrones.
async function freshGame(): Promise<{ catalog: Catalog; state: GameState }> {
  const catalog = await loadPlayableCatalog();
  setActiveCatalog(catalog);
  return { catalog, state: createInitialState() };
}

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
        rematchReady: freshRematchReady(),
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
  // Préparé même en cas de reconnexion (où il ne servira pas) : la transaction est synchrone.
  const game = await freshGame();

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
      state: game.state,
      catalog: game.catalog,
      status: 'playing',
      leftAt: freshLeftAt(),
      rematchReady: freshRematchReady(),
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

// Redémarrage immédiat, sans attendre l'autre siège : réservé au cas où la partie reçue
// utilise d'anciennes règles (RoomScreen, avant même que la partie ait vraiment commencé).
export async function rematch(room: Room): Promise<void> {
  const game = await freshGame();
  await roomStore.transact(room.code, (existing) => {
    if (!existing) return null;
    const restarted: Room = {
      ...existing,
      state: game.state,
      catalog: game.catalog,
      status: 'playing',
      leftAt: freshLeftAt(),
      rematchReady: freshRematchReady(),
    };
    return restarted;
  });
}

// Revanche demandée depuis l'écran de victoire (demande utilisateur : LES DEUX joueurs
// doivent cliquer sur « Revanche » pour que la partie redémarre). Le siège qui clique est
// marqué prêt ; dès que les deux le sont, une nouvelle partie démarre et les marques sont
// remises à zéro.
export async function requestRematch(room: Room, seat: Seat): Promise<void> {
  // La revanche repart du catalogue COURANT : une carte éditée dans l'admin pendant la partie
  // qui vient de se terminer entre en jeu à la manche suivante (demande utilisateur).
  const game = await freshGame();
  await roomStore.transact(room.code, (existing) => {
    if (!existing) return null;
    const ready = { ...(existing.rematchReady ?? freshRematchReady()), [seat]: true };
    if (ready.p1 && ready.p2) {
      const restarted: Room = {
        ...existing,
        state: game.state,
        catalog: game.catalog,
        status: 'playing',
        leftAt: freshLeftAt(),
        rematchReady: freshRematchReady(),
      };
      return restarted;
    }
    return { ...existing, rematchReady: ready };
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
    const rematchReady = { ...(existing.rematchReady ?? freshRematchReady()), [seat]: false };
    return { ...existing, leftAt: { ...leftAt, [seat]: Date.now() }, rematchReady };
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
