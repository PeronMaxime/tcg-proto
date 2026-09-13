import { useEffect, useState } from 'react';
import type { Room } from '../game/types';

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
    <div className="lobby">
      <p className="room-code">{room.code}</p>
      <div className="lobby-actions">
        <button onClick={copyCode}>Copier le code</button>
        <button onClick={copyLink}>Copier le lien</button>
      </div>
      <p className="copy-feedback">{feedback}</p>
      <p>En attente d'un adversaire…</p>
      <button onClick={onCancel}>Annuler</button>
    </div>
  );
}

export default Lobby;
