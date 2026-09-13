import { useEffect, useState } from 'react';
import { RULES_VERSION } from '../game/rules';
import type { Room } from '../game/types';
import { clearCurrentRoomCode, mySeat, rematch, subscribeToRoom } from '../net/rooms';
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

  // T7 : une room reçue avec un état d'une autre version de règles (ou sans `rulesVersion`)
  // ferait planter le rendu du plateau au lieu de simplement ne plus être jouable.
  if (room.state.rulesVersion !== RULES_VERSION) {
    return (
      <div>
        <p className="error">Cette partie utilise d’anciennes règles.</p>
        <div className="lobby-actions">
          <button onClick={() => rematch(room)}>Nouvelle partie</button>
          <button onClick={handleLeave}>Retour au menu</button>
        </div>
      </div>
    );
  }

  return <GameScreen room={room} seat={seat} onLeaveToMenu={handleLeave} />;
}

export default RoomScreen;
