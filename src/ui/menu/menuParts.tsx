import { useEffect, useState } from 'react';
import { DEFAULT_MONSTER_ZONE_SIZE, MONSTER_ZONE_SIZES } from '../../game/rules';
import type { GameVersion } from '../../game/versions';
import { getPlayerName, setPlayerName } from '../../net/identity';
import {
  clearLeftRoomCode,
  createRoom,
  getLeftRoomCode,
  joinRoom,
  setCurrentRoomCode,
  subscribeToRoom,
} from '../../net/rooms';
import { roomStore } from '../../net/roomStore';

// Briques communes aux menus de chaque version (`MenuV1`, `MenuV2`) : chaque version compose
// son menu avec, et peut s'en écarter sans toucher aux autres.

// ---------------------------------------------------------------------------------------
// Entrée dans une room : création, arrivée par code, reprise d'une partie quittée.
// ---------------------------------------------------------------------------------------

export interface RoomEntry {
  busy: boolean;
  error: string | null;
  leftRoomCode: string | null;
  create: (zoneSize: number, version: GameVersion) => Promise<void>;
  join: (code: string) => Promise<void>;
  resume: () => Promise<void>;
}

export function useRoomEntry(onRoomReady: (code: string) => void): RoomEntry {
  const [leftRoomCode, setLeftRoomCode] = useState(() => getLeftRoomCode());
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

  async function run(task: () => Promise<string>, onFailure?: () => void) {
    setError(null);
    setBusy(true);
    try {
      const code = await task();
      clearLeftRoomCode();
      setLeftRoomCode(null);
      setCurrentRoomCode(code);
      onRoomReady(code);
    } catch (e) {
      onFailure?.();
      setError(e instanceof Error ? e.message : 'Erreur inconnue.');
    } finally {
      setBusy(false);
    }
  }

  return {
    busy,
    error,
    leftRoomCode,
    create: (zoneSize, version) => run(() => createRoom(zoneSize, version)),
    join: (code) => run(async () => (await joinRoom(code)).code),
    resume: async () => {
      if (!leftRoomCode) return;
      // La partie n'existe plus (adversaire déjà expulsé, room supprimée, etc.) : le lien
      // n'a plus de sens, on l'efface pour ne pas le montrer indéfiniment.
      await run(
        async () => (await joinRoom(leftRoomCode)).code,
        () => {
          clearLeftRoomCode();
          setLeftRoomCode(null);
        },
      );
    },
  };
}

// ---------------------------------------------------------------------------------------
// Variante « cartes max par zone de monstres », retenue d'une visite à l'autre (simple confort :
// en cas d'échec de lecture, on retombe sur la variante par défaut).
// ---------------------------------------------------------------------------------------

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

export function useZoneSize(): [number, (size: number) => void] {
  const [zoneSize, setZoneSize] = useState(loadZoneSize);
  return [
    zoneSize,
    (size) => {
      setZoneSize(size);
      saveZoneSize(size);
    },
  ];
}

// ---------------------------------------------------------------------------------------
// Composants
// ---------------------------------------------------------------------------------------

export function TitleMast({ kicker }: { kicker: string }) {
  return (
    <header className="title-mast">
      {/* Dos de cartes en éventail derrière le titre : pur décor. */}
      <div className="title-fan" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p className="title-kicker">{kicker}</p>
      <h1 className="title-name">TCG Proto</h1>
      <ul className="title-elements" aria-hidden="true">
        <li className="is-fire" />
        <li className="is-water" />
        <li className="is-air" />
        <li className="is-earth" />
      </ul>
    </header>
  );
}

export function ResumeButton({ entry }: { entry: RoomEntry }) {
  if (!entry.leftRoomCode) return null;
  return (
    <button className="title-resume" onClick={() => void entry.resume()} disabled={entry.busy}>
      <span className="title-resume-label">Partie en cours</span>
      <span className="title-resume-code">{entry.leftRoomCode}</span>
      <span className="title-resume-action">Reprendre</span>
    </button>
  );
}

export function PseudoField() {
  const [pseudo, setPseudo] = useState(() => getPlayerName());
  return (
    <label className="title-field">
      <span className="title-label">Pseudo</span>
      <input
        className="title-input"
        value={pseudo}
        onChange={(e) => {
          setPseudo(e.target.value);
          setPlayerName(e.target.value);
        }}
        placeholder="Ton pseudo"
        autoComplete="nickname"
      />
    </label>
  );
}

// Variante de règles (demande utilisateur) : seul le nombre de cartes par zone de monstres change.
export function ZoneSizePicker({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (size: number) => void;
  disabled: boolean;
}) {
  return (
    <div className="title-picker">
      <span className="title-label" id="title-zone-label">
        Cartes max par zone de monstres
      </span>
      <div className="title-segments" role="radiogroup" aria-labelledby="title-zone-label">
        {MONSTER_ZONE_SIZES.map((size) => (
          <button
            key={size}
            role="radio"
            aria-checked={value === size}
            onClick={() => onChange(size)}
            disabled={disabled}
          >
            {size}
          </button>
        ))}
      </div>
    </div>
  );
}

// « Rejoindre » suit la room, quelle que soit la version affichée par le menu : c'est la room
// qui porte sa version.
export function JoinForm({ entry }: { entry: RoomEntry }) {
  const [joinCode, setJoinCode] = useState(() => new URLSearchParams(window.location.search).get('code') ?? '');
  return (
    <>
      <p className="title-or">
        <span>ou</span>
      </p>

      <form
        className="title-join"
        onSubmit={(e) => {
          e.preventDefault();
          if (joinCode) void entry.join(joinCode);
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
        <button type="submit" className="title-secondary" disabled={entry.busy || !joinCode}>
          Rejoindre
        </button>
      </form>
    </>
  );
}

export function MenuFooter({ entry }: { entry: RoomEntry }) {
  return (
    <>
      {entry.error && (
        <p className="title-error" role="alert">
          {entry.error}
        </p>
      )}

      {roomStore.isLocal && (
        <p className="title-note">
          Mode local — ouvre un deuxième onglet (pas « Dupliquer l'onglet ») pour jouer contre
          toi-même.
        </p>
      )}
    </>
  );
}
