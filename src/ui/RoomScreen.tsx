import { useEffect, useState } from 'react';
import type { Room } from '../game/types';
import { clearCurrentRoomCode, mySeat, subscribeToRoom } from '../net/rooms';
import GameScreen from './GameScreen';
import Lobby from './Lobby';

interface RoomScreenProps {
  code: string;
  onLeave: () => void;
}

function RoomScreen({ code, onLeave }: RoomScreenProps) {
  // undefined = pas encore reçu de snapshot, null = room inexistante.
  const [room, setRoom] = useState<Room | null | undefined>(undefined);

  useEffect(() => {
    setRoom(undefined);
    return subscribeToRoom(code, setRoom);
  }, [code]);

  function handleLeave() {
    clearCurrentRoomCode();
    onLeave();
  }

  if (room === undefined) {
    return <p>Connexion à la room…</p>;
  }

  if (room === null) {
    return (
      <div>
        <p className="error">Room introuvable.</p>
        <button onClick={handleLeave}>Retour au menu</button>
      </div>
    );
  }

  const seat = mySeat(room);
  if (!seat) {
    return (
      <div>
        <p className="error">Tu ne fais pas partie de cette partie.</p>
        <button onClick={handleLeave}>Retour au menu</button>
      </div>
    );
  }

  if (!room.state) {
    return <Lobby room={room} onCancel={handleLeave} />;
  }

  return <GameScreen room={room} seat={seat} onLeaveToMenu={handleLeave} />;
}

export default RoomScreen;
