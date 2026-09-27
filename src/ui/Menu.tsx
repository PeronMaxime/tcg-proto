import { useEffect, useState } from 'react';
import { DEFAULT_MONSTER_ZONE_SIZE, MONSTER_ZONE_SIZES } from '../game/rules';
import {
  DEFAULT_GAME_VERSION,
  GAME_VERSION_LABELS,
  GAME_VERSIONS,
  isGameVersion,
  type GameVersion,
} from '../game/versions';
import { getPlayerName, setPlayerName } from '../net/identity';
import {
  clearLeftRoomCode,
  createRoom,
  getLeftRoomCode,
  joinRoom,
  setCurrentRoomCode,
  subscribeToRoom,
} from '../net/rooms';
import { roomStore } from '../net/roomStore';

// Dernière variante choisie, retenue d'une visite à l'autre (simple confort : en cas d'échec
// de lecture, on retombe sur la variante par défaut).
const ZONE_SIZE_KEY = 'tcg-monster-zone-size';

function loadZoneSize(): number {
  try {
    const stored = Number(localStorage.getItem(ZONE_SIZE_KEY));
    return (MONSTER_ZONE_SIZES as readonly number[]).includes(stored) ? stored : DEFAULT_MONSTER_ZONE_SIZE;
  } catch {
    return DEFAULT_MONSTER_ZONE_SIZE;
  }
}

function saveZoneSize(size: number): void {
  try {
    localStorage.setItem(ZONE_SIZE_KEY, String(size));
  } catch {
    // stockage indisponible : le choix vaut pour cette visite seulement
  }
}

// Même confort pour la version du jeu.
const GAME_VERSION_KEY = 'tcg-game-version';

function loadGameVersion(): GameVersion {
  try {
    const stored = localStorage.getItem(GAME_VERSION_KEY);
    return isGameVersion(stored) ? stored : DEFAULT_GAME_VERSION;
  } catch {
    return DEFAULT_GAME_VERSION;
  }
}

function saveGameVersion(version: GameVersion): void {
  try {
    localStorage.setItem(GAME_VERSION_KEY, version);
  } catch {
    // stockage indisponible : le choix vaut pour cette visite seulement
  }
}

interface MenuProps {
  onRoomReady: (code: string) => void;
}

function Menu({ onRoomReady }: MenuProps) {
  const [pseudo, setPseudo] = useState(() => getPlayerName());
  const [joinCode, setJoinCode] = useState(
    () => new URLSearchParams(window.location.search).get('code') ?? '',
  );
  const [leftRoomCode, setLeftRoomCode] = useState(() => getLeftRoomCode());
  const [zoneSize, setZoneSize] = useState(loadZoneSize);
  const [gameVersion, setGameVersion] = useState(loadGameVersion);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // La room quittée peut être supprimée pendant qu'on est sur le menu (l'adversaire est parti
  // à son tour, ou son délai d'abandon a expiré) : on la suit pour retirer aussitôt le lien
  // « Reprendre la partie », qui ne mènerait plus nulle part.
  useEffect(() => {
    if (!leftRoomCode) return;
    return subscribeToRoom(leftRoomCode, (room) => {
      if (!room) {
        clearLeftRoomCode();
        setLeftRoomCode(null);
      }
    });
  }, [leftRoomCode]);

  function updatePseudo(value: string) {
    setPseudo(value);
    setPlayerName(value);
  }

  function updateZoneSize(size: number) {
    setZoneSize(size);
    saveZoneSize(size);
  }

  function updateGameVersion(version: GameVersion) {
    setGameVersion(version);
    saveGameVersion(version);
  }

  async function handleCreate() {
    setError(null);
    setBusy(true);
    try {
      const code = await createRoom(zoneSize, gameVersion);
      clearLeftRoomCode();
      setCurrentRoomCode(code);
      onRoomReady(code);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue.');
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin() {
    setError(null);
    setBusy(true);
    try {
      const room = await joinRoom(joinCode);
      clearLeftRoomCode();
      setCurrentRoomCode(room.code);
      onRoomReady(room.code);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue.');
    } finally {
      setBusy(false);
    }
  }

  async function handleResume() {
    if (!leftRoomCode) return;
    setError(null);
    setBusy(true);
    try {
      const room = await joinRoom(leftRoomCode);
      clearLeftRoomCode();
      setLeftRoomCode(null);
      setCurrentRoomCode(room.code);
      onRoomReady(room.code);
    } catch (e) {
      // La partie n'existe plus (adversaire déjà expulsé, room supprimée, etc.) : le lien
      // n'a plus de sens, on l'efface pour ne pas le montrer indéfiniment.
      clearLeftRoomCode();
      setLeftRoomCode(null);
      setError(e instanceof Error ? e.message : 'Erreur inconnue.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="menu">
      <h1>TCG Proto</h1>

      {roomStore.isLocal && (
        <p className="badge-local">
          Mode local — ouvre un deuxième onglet (pas « Dupliquer l'onglet ») pour jouer contre
          toi-même.
        </p>
      )}

      {leftRoomCode && (
        <button className="resume-link" onClick={handleResume} disabled={busy}>
          Reprendre la partie <span className="resume-code">{leftRoomCode}</span>
        </button>
      )}

      <label>
        Pseudo
        <input
          value={pseudo}
          onChange={(e) => updatePseudo(e.target.value)}
          placeholder="Ton pseudo"
        />
      </label>

      {/* Version du jeu de la partie créée (demande utilisateur) : elle choisit le catalogue de
          cartes. Sans effet sur « Rejoindre », qui suit la room. */}
      <div className="menu-picker">
        <span>Version du jeu</span>
        <div className="menu-picker-options" role="radiogroup">
          {GAME_VERSIONS.map((version) => (
            <button
              key={version}
              role="radio"
              aria-checked={gameVersion === version}
              className={gameVersion === version ? 'selected' : undefined}
              onClick={() => updateGameVersion(version)}
              disabled={busy}
            >
              {GAME_VERSION_LABELS[version]}
            </button>
          ))}
        </div>
      </div>

      {/* Variante de règles de la partie créée (demande utilisateur) : seul le nombre de
          cartes par zone de monstres change. Sans effet sur « Rejoindre », qui suit la room. */}
      <div className="menu-picker">
        <span>Cartes max par zone de monstres</span>
        <div className="menu-picker-options" role="radiogroup">
          {MONSTER_ZONE_SIZES.map((size) => (
            <button
              key={size}
              role="radio"
              aria-checked={zoneSize === size}
              className={zoneSize === size ? 'selected' : undefined}
              onClick={() => updateZoneSize(size)}
              disabled={busy}
            >
              {size}
            </button>
          ))}
        </div>
      </div>

      <button onClick={handleCreate} disabled={busy}>
        Créer une partie
      </button>

      <div className="join-row">
        <input
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value)}
          placeholder="Code de la room"
        />
        <button onClick={handleJoin} disabled={busy || !joinCode}>
          Rejoindre
        </button>
      </div>

      {error && <p className="error">{error}</p>}
    </div>
  );
}

export default Menu;
