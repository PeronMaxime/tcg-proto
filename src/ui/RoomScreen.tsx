import { useEffect, useRef, useState } from 'react';
import { DEFAULT_CATALOG } from '../game/defaultCatalog';
import { RULES_VERSION } from '../game/rules';
import type { Room } from '../game/types';
import { clearCurrentRoomCode, mySeat, rematch, subscribeToRoom } from '../net/rooms';
import { applyCatalog } from './applyCatalog';
import GameScreen from './GameScreen';
import Lobby from './Lobby';

interface RoomScreenProps {
  code: string;
  onLeave: () => void;
}

function RoomScreen({ code, onLeave }: RoomScreenProps) {
  // undefined = pas encore reçu de snapshot, null = room inexistante.
  const [room, setRoom] = useState<Room | null | undefined>(undefined);
  // Catalogue déjà installé, sous la forme `code:version` (voir plus bas).
  const appliedCatalog = useRef<string | null>(null);

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

  // La partie est jouée avec le catalogue FIGÉ à sa création : une carte modifiée dans l'admin
  // depuis ne change rien ici, et les deux clients voient forcément les mêmes cartes. Les
  // rooms créées avant le panneau d'administration n'ont pas ce champ : elles gardent les
  // cartes livrées avec le code.
  //
  // Installé pendant le rendu, et non dans un `useEffect` : `GameScreen` appelle `getCardDef`
  // dès son premier rendu, qui a lieu AVANT que les effets ne se déclenchent. La clé
  // `code:version` évite de vider le cache de textures à chaque snapshot reçu (donc à chaque
  // action de jeu), tout en rebasculant bien quand on change de partie.
  const catalog = room.catalog ?? DEFAULT_CATALOG;
  const catalogKey = `${room.code}:${catalog.version}`;
  if (appliedCatalog.current !== catalogKey) {
    applyCatalog(catalog);
    appliedCatalog.current = catalogKey;
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
