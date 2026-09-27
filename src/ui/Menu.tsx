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
    <main className="title">
      <header className="title-mast">
        {/* Dos de cartes en éventail derrière le titre : pur décor. */}
        <div className="title-fan" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p className="title-kicker">Prototype · duel à deux joueurs</p>
        <h1 className="title-name">TCG Proto</h1>
        <ul className="title-elements" aria-hidden="true">
          <li className="is-fire" />
          <li className="is-water" />
          <li className="is-air" />
          <li className="is-earth" />
        </ul>
      </header>

      {leftRoomCode && (
        <button className="title-resume" onClick={handleResume} disabled={busy}>
          <span className="title-resume-label">Partie en cours</span>
          <span className="title-resume-code">{leftRoomCode}</span>
          <span className="title-resume-action">Reprendre</span>
        </button>
      )}

      <label className="title-field">
        <span className="title-label">Pseudo</span>
        <input
          className="title-input"
          value={pseudo}
          onChange={(e) => updatePseudo(e.target.value)}
          placeholder="Ton pseudo"
          autoComplete="nickname"
        />
      </label>

      {/* Les réglages ne valent que pour la partie créée : « Rejoindre » suit la room. D'où leur
          regroupement avec le bouton de création. */}
      <section className="title-block" aria-labelledby="title-new">
        <h2 id="title-new" className="title-block-heading">
          Nouvelle partie
        </h2>

        {/* Version du jeu (demande utilisateur) : elle choisit le catalogue de cartes. */}
        <div className="title-picker">
          <span className="title-label" id="title-version-label">
            Version du jeu
          </span>
          <div className="title-segments" role="radiogroup" aria-labelledby="title-version-label">
            {GAME_VERSIONS.map((version) => (
              <button
                key={version}
                role="radio"
                aria-checked={gameVersion === version}
                onClick={() => updateGameVersion(version)}
                disabled={busy}
              >
                {GAME_VERSION_LABELS[version]}
              </button>
            ))}
          </div>
        </div>

        {/* Variante de règles (demande utilisateur) : seul le nombre de cartes par zone de
            monstres change. */}
        <div className="title-picker">
          <span className="title-label" id="title-zone-label">
            Cartes max par zone de monstres
          </span>
          <div className="title-segments" role="radiogroup" aria-labelledby="title-zone-label">
            {MONSTER_ZONE_SIZES.map((size) => (
              <button
                key={size}
                role="radio"
                aria-checked={zoneSize === size}
                onClick={() => updateZoneSize(size)}
                disabled={busy}
              >
                {size}
              </button>
            ))}
          </div>
        </div>

        <button className="title-primary" onClick={handleCreate} disabled={busy}>
          Créer une partie
        </button>
      </section>

      <p className="title-or">
        <span>ou</span>
      </p>

      <form
        className="title-join"
        onSubmit={(e) => {
          e.preventDefault();
          if (joinCode) handleJoin();
        }}
      >
        <label className="title-field">
          <span className="title-label">Code de la room</span>
          <input
            className="title-input title-code-input"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            placeholder="ABC23"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <button type="submit" className="title-secondary" disabled={busy || !joinCode}>
          Rejoindre
        </button>
      </form>

      {error && (
        <p className="title-error" role="alert">
          {error}
        </p>
      )}

      {roomStore.isLocal && (
        <p className="title-note">
          Mode local — ouvre un deuxième onglet (pas « Dupliquer l'onglet ») pour jouer contre
          toi-même.
        </p>
      )}
    </main>
  );
}

export default Menu;
