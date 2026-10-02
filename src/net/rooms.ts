import { setActiveCatalog } from '../game/cards';
import { DECK_CHOICE_MS, playableDecks, resolveDecks } from '../game/decks';
import { applyAction, createInitialState, DEFAULT_MONSTER_ZONE_SIZE } from '../game/rules';
import type { Action, Catalog, GameState, Room, Seat } from '../game/types';
import { DEFAULT_GAME_VERSION, type GameVersion } from '../game/versions';
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

// Prépare une nouvelle partie : on lit le catalogue partagé de la version du jeu de la room
// (`Room.gameVersion`), on l'installe comme catalogue
// actif (`createInitialState` construit les decks avec, via `buildStarterDeck`) et on le rend
// pour qu'il soit FIGÉ dans la room. Une carte modifiée dans l'admin après ce point ne touche
// donc plus cette partie — elle s'appliquera à la suivante.
//
// Appelé avant d'ouvrir la transaction : le catalogue se lit de façon asynchrone, alors que
// les callbacks de `roomStore.transact` sont synchrones. L'état, lui, se crée DANS la
// transaction (`game.start(existing)`) : il dépend de la variante enregistrée dans la room.
async function freshGame(
  version: GameVersion | undefined,
): Promise<{ catalog: Catalog; start: (room: Room) => GameState }> {
  const catalog = await loadPlayableCatalog(version ?? DEFAULT_GAME_VERSION);
  checkDecks(catalog);
  setActiveCatalog(catalog);
  return {
    catalog,
    start: (room) => createInitialState(Math.random, room.monsterZoneSize ?? DEFAULT_MONSTER_ZONE_SIZE),
  };
}

// V2 : les joueurs choisissent leur deck, encore faut-il qu'il y en ait un de jouable.
function checkDecks(catalog: Catalog): void {
  if (catalog.gameVersion === 'v2' && playableDecks(catalog).length === 0) {
    throw new RoomError('Aucun deck complet dans cette version : compose-en un depuis l’administration.');
  }
}

// Démarrage d'une partie, figée sur le catalogue `catalog`. V1 : la partie démarre aussitôt, les
// deux joueurs jouent le deck de départ. V2 : on passe d'abord par le choix des decks
// (`chooseDeck`, `expireDeckChoice`), la partie ne démarrera qu'à la fin de celui-ci.
function startOrChooseDecks(existing: Room, game: { catalog: Catalog; start: (room: Room) => GameState }): Room {
  const base: Room = {
    ...existing,
    catalog: game.catalog,
    leftAt: freshLeftAt(),
    rematchReady: freshRematchReady(),
  };
  if (game.catalog.gameVersion !== 'v2') {
    return { ...base, state: game.start(existing), status: 'playing' };
  }
  return {
    ...base,
    state: null,
    status: 'choosingDecks',
    deckChoice: { p1: null, p2: null },
    deckDeadline: Date.now() + DECK_CHOICE_MS,
  };
}

// Fin du choix des decks : chaque siège joue son choix, ou le deck par défaut s'il n'a pas
// validé à temps. Appelé dans une transaction, sur la room telle qu'elle est stockée.
function startWithDecks(existing: Room, choice: Record<Seat, string | null>): Room {
  if (!existing.catalog) throw new RoomError('Catalogue de la partie introuvable.');
  // `createInitialState` lit le catalogue actif (`getCardDef`, `isV2Active`) : c'est celui de la
  // room, déjà installé par `RoomScreen`, mais on ne s'en remet pas à l'ordre des rendus.
  setActiveCatalog(existing.catalog);
  const decks = resolveDecks(existing.catalog, choice);
  if (!decks) throw new RoomError('Aucun deck jouable dans cette partie.');
  return {
    ...existing,
    state: createInitialState(Math.random, existing.monsterZoneSize ?? DEFAULT_MONSTER_ZONE_SIZE, {
      p1: decks.p1.counts,
      p2: decks.p2.counts,
    }),
    status: 'playing',
    deckChoice: { p1: decks.p1.id, p2: decks.p2.id },
  };
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

// `monsterZoneSize` : variante de règles choisie dans le menu (voir `MONSTER_ZONE_SIZES`).
// `gameVersion` : version du jeu choisie dans le menu (voir `game/versions.ts`).
export async function createRoom(
  monsterZoneSize: number = DEFAULT_MONSTER_ZONE_SIZE,
  gameVersion: GameVersion = DEFAULT_GAME_VERSION,
): Promise<string> {
  const player = { id: getPlayerId(), name: getPlayerName() };
  // Le catalogue n'est recopié dans la room qu'à l'arrivée du second joueur, mais on vérifie
  // dès maintenant qu'il existe : une V2 encore sans cartes doit refuser la création, pas
  // laisser l'adversaire tomber sur une erreur en rejoignant. Même chose pour une V2 sans deck.
  checkDecks(await loadPlayableCatalog(gameVersion));

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
        monsterZoneSize,
        gameVersion,
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
  // Le catalogue dépend de la version de la room : on la lit d'abord, hors transaction (elle
  // ne change jamais après la création). La partie n'est préparée que si l'on va vraiment
  // s'asseoir : une reconnexion ne doit pas échouer parce que le catalogue est illisible.
  const peek = await roomStore.get(code);
  if (!peek) throw new RoomError('Room introuvable.');
  const seated = peek.players.p1.id === player.id || peek.players.p2?.id === player.id;
  const game = seated || peek.players.p2 ? null : await freshGame(peek.gameVersion);

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
    // La room a changé entre la lecture et la transaction (siège libéré entre-temps) : rare,
    // il suffit de recommencer.
    if (!game) throw new RoomError('La room a changé, réessaie.');
    return startOrChooseDecks({ ...existing, players: { ...existing.players, p2: player } }, game);
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
  const game = await freshGame(room.gameVersion);
  await roomStore.transact(room.code, (existing) => {
    if (!existing) return null;
    return startOrChooseDecks(existing, game);
  });
}

// Revanche demandée depuis l'écran de victoire (demande utilisateur : LES DEUX joueurs
// doivent cliquer sur « Revanche » pour que la partie redémarre). Le siège qui clique est
// marqué prêt ; dès que les deux le sont, une nouvelle partie démarre et les marques sont
// remises à zéro.
export async function requestRematch(room: Room, seat: Seat): Promise<void> {
  // La revanche repart du catalogue COURANT : une carte éditée dans l'admin pendant la partie
  // qui vient de se terminer entre en jeu à la manche suivante (demande utilisateur).
  const game = await freshGame(room.gameVersion);
  await roomStore.transact(room.code, (existing) => {
    if (!existing) return null;
    const ready = { ...(existing.rematchReady ?? freshRematchReady()), [seat]: true };
    // V2 : la revanche repasse par le choix des decks (demande utilisateur).
    if (ready.p1 && ready.p2) return startOrChooseDecks(existing, game);
    return { ...existing, rematchReady: ready };
  });
}

// V2 : le siège `seat` valide son deck. Définitif : un second choix est ignoré. La partie
// démarre dès que les deux sièges ont validé.
export async function chooseDeck(room: Room, seat: Seat, deckId: string): Promise<void> {
  await roomStore.transact(room.code, (existing) => {
    if (!existing || existing.status !== 'choosingDecks') return null;
    const current = existing.deckChoice ?? { p1: null, p2: null };
    if (current[seat]) return null;
    const choice = { ...current, [seat]: deckId };
    if (choice.p1 && choice.p2) return startWithDecks(existing, choice);
    return { ...existing, deckChoice: choice };
  });
}

// V2 : délai de choix écoulé. Appelé par chaque client qui le constate ; la transaction garantit
// qu'un seul démarre la partie (les suivants trouvent une room déjà en jeu et n'écrivent rien).
export async function expireDeckChoice(room: Room): Promise<void> {
  await roomStore.transact(room.code, (existing) => {
    if (!existing || existing.status !== 'choosingDecks') return null;
    if (Date.now() < (existing.deckDeadline ?? 0)) return null;
    return startWithDecks(existing, existing.deckChoice ?? { p1: null, p2: null });
  });
}

// Marque le siège `seat` comme parti (bouton « Quitter » en cours de partie, ou « Retour au
// menu » sur l'écran de victoire au lieu de demander la revanche). Le client adverse expulse
// alors son joueur et supprime la room — immédiatement si la partie est déjà terminée, sinon
// après `ABANDON_TIMEOUT_MS` pour laisser une chance de reconnexion (voir `deleteRoom`,
// utilisés dans GameScreen). Si l'autre siège était déjà marqué parti, plus personne n'attend :
// la room est supprimée immédiatement, terminée ou non.
//
// Rend `true` si la room existe encore (on peut donc la reprendre), `false` si elle a disparu.
export async function leaveMatch(room: Room, seat: Seat): Promise<boolean> {
  const opponentSeat: Seat = seat === 'p1' ? 'p2' : 'p1';

  const updated = await roomStore.transact(room.code, (existing) => {
    if (!existing) return null;
    const leftAt = existing.leftAt ?? freshLeftAt();
    const rematchReady = { ...(existing.rematchReady ?? freshRematchReady()), [seat]: false };
    return { ...existing, leftAt: { ...leftAt, [seat]: Date.now() }, rematchReady };
  });

  if (!updated) return false;
  if (updated.leftAt?.[opponentSeat]) {
    await roomStore.remove(room.code);
    return false;
  }
  return true;
}

export async function deleteRoom(code: string): Promise<void> {
  await roomStore.remove(code);
}

export function subscribeToRoom(code: string, cb: (room: Room | null) => void): () => void {
  return roomStore.subscribe(code, cb);
}
