import { useState } from 'react';
import { getPlayerName, setPlayerName } from '../net/identity';
import {
  clearLeftRoomCode,
  createRoom,
  getLeftRoomCode,
  joinRoom,
  setCurrentRoomCode,
} from '../net/rooms';
import { roomStore } from '../net/roomStore';

interface MenuProps {
  onRoomReady: (code: string) => void;
}

function Menu({ onRoomReady }: MenuProps) {
  const [pseudo, setPseudo] = useState(() => getPlayerName());
  const [joinCode, setJoinCode] = useState(
    () => new URLSearchParams(window.location.search).get('code') ?? '',
  );
  const [leftRoomCode, setLeftRoomCode] = useState(() => getLeftRoomCode());
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
