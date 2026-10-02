import { useState } from 'react';
import {
  DEFAULT_GAME_VERSION,
  GAME_VERSION_LABELS,
  GAME_VERSIONS,
  isGameVersion,
  type GameVersion,
} from '../../game/versions';
import MenuV1 from './MenuV1';
import MenuV2 from './MenuV2';

// Menu principal. La version du jeu se choisit à part, en haut à droite (demande utilisateur) :
// elle ne règle pas seulement la partie créée, elle change le menu entier, chaque version ayant
// le sien (`MenuV1`, `MenuV2`).

// Dernière version choisie, retenue d'une visite à l'autre (simple confort : en cas d'échec de
// lecture, on retombe sur la version par défaut).
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

const MENUS: Record<GameVersion, typeof MenuV1> = { v1: MenuV1, v2: MenuV2 };

interface MenuProps {
  onRoomReady: (code: string) => void;
}

function Menu({ onRoomReady }: MenuProps) {
  const [gameVersion, setGameVersion] = useState(loadGameVersion);
  const VersionMenu = MENUS[gameVersion];

  return (
    <>
      <div className="title-version">
        <span className="title-label" id="title-version-label">
          Version
        </span>
        <div className="title-segments" role="radiogroup" aria-labelledby="title-version-label">
          {GAME_VERSIONS.map((version) => (
            <button
              key={version}
              role="radio"
              aria-checked={gameVersion === version}
              onClick={() => {
                setGameVersion(version);
                saveGameVersion(version);
              }}
            >
              {GAME_VERSION_LABELS[version]}
            </button>
          ))}
        </div>
      </div>
      {/* `key` : changer de version remonte le menu, qui repart de son propre état. */}
      <VersionMenu key={gameVersion} onRoomReady={onRoomReady} />
    </>
  );
}

export default Menu;
