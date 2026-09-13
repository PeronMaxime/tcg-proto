import { useState } from 'react';
import { getCurrentRoomCode } from './net/rooms';
import Menu from './ui/Menu';
import RoomScreen from './ui/RoomScreen';

function App() {
  const [roomCode, setRoomCode] = useState<string | null>(() => getCurrentRoomCode());

  if (roomCode) {
    return <RoomScreen code={roomCode} onLeave={() => setRoomCode(null)} />;
  }

  return <Menu onRoomReady={setRoomCode} />;
}

export default App;
