import { useState } from 'react';
import { getCurrentRoomCode } from './net/rooms';
import AdminScreen from './ui/admin/AdminScreen';
import Menu from './ui/Menu';
import RoomScreen from './ui/RoomScreen';

// Pas de routeur : une seule route en plus du jeu, et le code de room vit en `sessionStorage`
// (voir README §3). `/admin` est servi par une réécriture Vercel vers `index.html`.
const ADMIN_PATH = '/admin';

function App() {
  const [roomCode, setRoomCode] = useState<string | null>(() => getCurrentRoomCode());

  // Lu une seule fois au montage : rien ne navigue dans l'application.
  if (window.location.pathname.replace(/\/$/, '') === ADMIN_PATH) {
    return <AdminScreen />;
  }

  if (roomCode) {
    return <RoomScreen code={roomCode} onLeave={() => setRoomCode(null)} />;
  }

  return <Menu onRoomReady={setRoomCode} />;
}

export default App;
