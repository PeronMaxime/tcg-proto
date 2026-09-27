import { useEffect, useState } from 'react';
import { DEFAULT_MONSTER_ZONE_SIZE } from '../game/rules';
import type { Room } from '../game/types';
import { DEFAULT_GAME_VERSION, GAME_VERSION_LABELS } from '../game/versions';

interface LobbyProps {
  room: Room;
  onCancel: () => void;
}

function Lobby({ room, onCancel }: LobbyProps) {
  const link = `${window.location.origin}${window.location.pathname}?code=${room.code}`;
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!feedback) return;
    const timeout = setTimeout(() => setFeedback(null), 1800);
    return () => clearTimeout(timeout);
  }, [feedback]);

  function copyCode() {
    navigator.clipboard.writeText(room.code);
    setFeedback('Code copié !');
  }

  function copyLink() {
    navigator.clipboard.writeText(link);
    setFeedback('Lien copié !');
  }

  return (
    <main className="title">
      <header className="title-mast">
        <p className="title-kicker">Salle d'attente</p>
        <h1 className="lobby-heading">Code de la room</h1>
        {/* Une carte de parchemin par caractère, pour le dicter sans se tromper. */}
        <p className="lobby-code" aria-label={`Code ${room.code.split('').join(' ')}`}>
          {room.code.split('').map((char, i) => (
            <span key={i} aria-hidden="true">
              {char}
            </span>
          ))}
        </p>
      </header>

      <div className="lobby-copy">
        <button className="title-secondary" onClick={copyCode}>
          Copier le code
        </button>
        <button className="title-secondary" onClick={copyLink}>
          Copier le lien
        </button>
      </div>
      <p className="lobby-feedback" role="status">
        {feedback}
      </p>

      <dl className="lobby-settings">
        <div>
          <dt>Version du jeu</dt>
          <dd>{GAME_VERSION_LABELS[room.gameVersion ?? DEFAULT_GAME_VERSION]}</dd>
        </div>
        <div>
          <dt>Cartes max par zone de monstres</dt>
          <dd>{room.monsterZoneSize ?? DEFAULT_MONSTER_ZONE_SIZE}</dd>
        </div>
      </dl>

      <p className="lobby-waiting">
        <span className="lobby-waiting-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        En attente d'un adversaire…
      </p>

      <button className="lobby-cancel" onClick={onCancel}>
        Annuler et revenir au menu
      </button>
    </main>
  );
}

export default Lobby;
