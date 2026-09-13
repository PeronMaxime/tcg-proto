import { useState } from 'react';
import { getPlayerName, setPlayerName } from '../net/identity';
import { createRoom, joinRoom, setCurrentRoomCode } from '../net/rooms';
import { roomStore } from '../net/roomStore';

interface MenuProps {
  onRoomReady: (code: string) => void;
}

function Menu({ onRoomReady }: MenuProps) {
  const [pseudo, setPseudo] = useState(() => getPlayerName());
  const [joinCode, setJoinCode] = useState(
    () => new URLSearchParams(window.location.search).get('code') ?? '',
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function updatePseudo(value: string) {
    setPseudo(value);
    setPlayerName(value);
  }

  async function handleCreate() {
    setError(null);
    setBusy(true);
    try {
      const code = await createRoom();
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
      setCurrentRoomCode(room.code);
      onRoomReady(room.code);
    } catch (e) {
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

      <label>
        Pseudo
        <input
          value={pseudo}
          onChange={(e) => updatePseudo(e.target.value)}
          placeholder="Ton pseudo"
        />
      </label>

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
