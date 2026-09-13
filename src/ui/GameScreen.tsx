import { Canvas } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import type { Room, Seat, Target } from '../game/types';
import { ABANDON_TIMEOUT_MS, deleteRoom, leaveMatch, rememberLeftRoom, rematch, sendAction } from '../net/rooms';
import Board from '../scene/Board';
import CameraRig from '../scene/CameraRig';
import { CAMERA } from '../scene/layout';

// Écran de jeu : scène 3D plein écran (E6) + HUD superposé en surcouche (E7).

interface GameScreenProps {
  room: Room;
  seat: Seat;
  onLeaveToMenu: () => void;
}

const LEAVE_ICON_PATH = 'M9 3H4a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h5M15 8l4 4-4 4M19 12H8';

function ManaCrystals({ mana, maxMana }: { mana: number; maxMana: number }) {
  return (
    <span className="mana-crystals" aria-label={`Mana ${mana}/${maxMana}`}>
      {Array.from({ length: maxMana }, (_, i) => (
        <span key={i} className={`mana-crystal ${i < mana ? 'filled' : ''}`} />
      ))}
      <span className="mana-label">
        {mana}/{maxMana}
      </span>
    </span>
  );
}

function PlayerPlate({
  name,
  hp,
  mana,
  maxMana,
  deckCount,
  active,
  align,
}: {
  name: string;
  hp: number;
  mana: number;
  maxMana: number;
  deckCount: number;
  active: boolean;
  align: 'top' | 'bottom';
}) {
  return (
    <div className={`hud-plate hud-plate--${align} ${active ? 'is-active' : ''}`}>
      <div className="hud-plate-row">
        <span className="hud-name">{name}</span>
        {active && <span className="hud-turn-dot" aria-hidden="true" />}
      </div>
      <div className="hud-plate-row">
        <span className="hp-token">
          <span className="hp-value">{hp}</span>
        </span>
        <ManaCrystals mana={mana} maxMana={maxMana} />
        <span className="hud-deck" title="Cartes restantes dans le deck">
          Deck {deckCount}
        </span>
      </div>
    </div>
  );
}

function GameScreen({ room, seat, onLeaveToMenu }: GameScreenProps) {
  const state = room.state!;
  const [selectedAttacker, setSelectedAttacker] = useState<string | null>(null);
  const [turnBanner, setTurnBanner] = useState<{ seat: Seat; key: number } | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const lastHandledTurnEventId = useRef<number | undefined>(undefined);

  const isMyTurn = state.turn === seat;
  const me = state.players[seat];
  const opponentSeat: Seat = seat === 'p1' ? 'p2' : 'p1';
  const opponent = state.players[opponentSeat];
  const myName = room.players[seat]?.name || (seat === 'p1' ? 'Joueur 1' : 'Joueur 2');
  const opponentName =
    room.players[opponentSeat]?.name || (opponentSeat === 'p1' ? 'Joueur 1' : 'Joueur 2');

  const opponentLeftAt = room.leftAt?.[opponentSeat] ?? null;
  const [abandonCountdown, setAbandonCountdown] = useState<number | null>(null);

  // L'adversaire a quitté la partie : on l'attend un peu, puis on rentre au menu et on
  // supprime la room si personne n'est revenu (voir `leaveMatch`/`deleteRoom`).
  useEffect(() => {
    if (state.winner || !opponentLeftAt) {
      setAbandonCountdown(null);
      return;
    }

    const deadline = opponentLeftAt + ABANDON_TIMEOUT_MS;
    let expired = false;

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setAbandonCountdown(remaining);
      if (remaining <= 0 && !expired) {
        expired = true;
        deleteRoom(room.code).catch(() => {});
        onLeaveToMenu();
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [opponentLeftAt, state.winner, room.code, onLeaveToMenu]);

  // Bannière de tour, déclenchée par un évènement `turn` de nouvel id (§7, §12).
  useEffect(() => {
    const event = state.lastEvent;
    const currentId = event?.id ?? 0;

    if (lastHandledTurnEventId.current === undefined) {
      lastHandledTurnEventId.current = currentId;
      return;
    }
    if (currentId === lastHandledTurnEventId.current) return;
    lastHandledTurnEventId.current = currentId;

    if (event?.type === 'turn') {
      setTurnBanner({ seat: event.seat, key: event.id });
    }
  }, [state.lastEvent]);

  useEffect(() => {
    if (!turnBanner) return;
    const timeout = setTimeout(() => setTurnBanner(null), 1600);
    return () => clearTimeout(timeout);
  }, [turnBanner]);

  useEffect(() => {
    if (!codeCopied) return;
    const timeout = setTimeout(() => setCodeCopied(false), 1500);
    return () => clearTimeout(timeout);
  }, [codeCopied]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setSelectedAttacker(null);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  async function play(uid: string) {
    await sendAction(room, seat, { type: 'play', uid });
  }

  async function attack(target: Target) {
    if (!selectedAttacker) return;
    await sendAction(room, seat, { type: 'attack', attackerUid: selectedAttacker, target });
    setSelectedAttacker(null);
  }

  async function endTurn() {
    setSelectedAttacker(null);
    await sendAction(room, seat, { type: 'endTurn' });
  }

  async function handleRematch() {
    await rematch(room);
  }

  async function leaveGame() {
    try {
      await leaveMatch(room, seat);
    } catch {
      // Le retour au menu doit fonctionner même si l'écriture échoue (hors-ligne, etc.).
    }
    rememberLeftRoom(room.code);
    onLeaveToMenu();
  }

  function copyRoomCode() {
    navigator.clipboard.writeText(room.code);
    setCodeCopied(true);
  }

  if (state.winner) {
    return (
      <div className="game-screen">
        <Canvas
          shadows
          camera={{ fov: CAMERA.fov }}
          className="game-canvas"
          style={{ background: '#05060a' }}
        >
          <CameraRig />
          <Board
            state={state}
            seat={seat}
            isMyTurn={false}
            selectedAttackerUid={null}
            onSelectAttacker={() => {}}
            onPlayCard={() => {}}
            onAttack={() => {}}
            onDeselect={() => {}}
          />
        </Canvas>
        <div className="end-overlay">
          <h1 className={state.winner === seat ? 'end-title win' : 'end-title lose'}>
            {state.winner === seat ? 'Victoire !' : 'Défaite'}
          </h1>
          <div className="end-actions">
            <button className="hud-button hud-button--gold" onClick={handleRematch}>
              Revanche
            </button>
            <button className="hud-button" onClick={onLeaveToMenu}>
              Retour au menu
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="game-screen"
      onContextMenu={(e) => {
        e.preventDefault();
        setSelectedAttacker(null);
      }}
    >
      <Canvas
        shadows
        camera={{ fov: CAMERA.fov }}
        className="game-canvas"
        style={{ background: '#05060a' }}
      >
        <CameraRig />
        <Board
          state={state}
          seat={seat}
          isMyTurn={isMyTurn}
          selectedAttackerUid={selectedAttacker}
          onSelectAttacker={setSelectedAttacker}
          onPlayCard={play}
          onAttack={attack}
          onDeselect={() => setSelectedAttacker(null)}
        />
      </Canvas>

      <div className="hud-layer">
        <button
          className={`room-badge ${codeCopied ? 'is-copied' : ''}`}
          onClick={copyRoomCode}
          title="Copier le code de la room"
        >
          <span className="room-badge-label">Room</span>
          <span className="room-badge-code">{room.code}</span>
          <span className="room-badge-hint">{codeCopied ? 'Copié !' : 'Copier'}</span>
        </button>

        <button className="leave-button" onClick={leaveGame} title="Quitter la partie et revenir au menu">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={LEAVE_ICON_PATH} />
          </svg>
          <span>Quitter</span>
        </button>

        {abandonCountdown !== null && (
          <div className="abandon-notice">
            {opponentName} a quitté la partie — retour au menu dans {abandonCountdown}s
          </div>
        )}

        {turnBanner && (
          <div className={`turn-banner ${turnBanner.seat === seat ? 'mine' : 'theirs'}`}>
            {turnBanner.seat === seat ? 'À toi de jouer' : "Tour de l'adversaire"}
          </div>
        )}

        <PlayerPlate
          name={opponentName}
          hp={opponent.hp}
          mana={opponent.mana}
          maxMana={opponent.maxMana}
          deckCount={opponent.deck.length}
          active={!isMyTurn}
          align="top"
        />

        <PlayerPlate
          name={myName}
          hp={me.hp}
          mana={me.mana}
          maxMana={me.maxMana}
          deckCount={me.deck.length}
          active={isMyTurn}
          align="bottom"
        />

        <button className={`end-turn ${isMyTurn ? 'is-ready' : ''}`} disabled={!isMyTurn} onClick={endTurn}>
          <span>Fin du tour</span>
        </button>

        <p className="hint">
          Clique une carte pour la jouer · Clique un serviteur puis une cible pour attaquer
        </p>
      </div>
    </div>
  );
}

export default GameScreen;
