import { Canvas } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import type { Room, Seat, Zone } from '../game/types';
import { ABANDON_TIMEOUT_MS, deleteRoom, leaveMatch, rememberLeftRoom, rematch, sendAction } from '../net/rooms';
import Board from '../scene/Board';
import CameraRig from '../scene/CameraRig';
import { CAMERA } from '../scene/layout';
import { useCombatPlayback } from './useCombatPlayback';

// Écran de jeu : scène 3D plein écran + HUD superposé en surcouche. Un seul <Canvas>, y
// compris en fin de partie (T8) : l'écran de victoire est une surcouche HTML, pas un
// second Canvas — ça couperait l'animation du dernier combat.

interface GameScreenProps {
  room: Room;
  seat: Seat;
  onLeaveToMenu: () => void;
}

const LEAVE_ICON_PATH = 'M9 3H4a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h5M15 8l4 4-4 4M19 12H8';

function CoinBadge({ coins }: { coins: number }) {
  return (
    <span className="coin-badge" title="Pièces">
      <span className="coin-icon" aria-hidden="true" />
      <span className="coin-value">{coins}</span>
    </span>
  );
}

function PlayerPlate({
  name,
  hp,
  coins,
  deckCount,
  handCount,
  active,
  align,
}: {
  name: string;
  hp: number;
  coins: number;
  deckCount: number;
  handCount: number;
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
        <CoinBadge coins={coins} />
        <span className="hud-deck" title="Cartes restantes dans le deck">
          Deck {deckCount}
        </span>
        <span className="hud-deck" title="Cartes en main">
          Main {handCount}
        </span>
      </div>
    </div>
  );
}

function phaseLabel(isMyTurn: boolean, playing: boolean, phase: string, turnNumber: number): string {
  if (playing) return 'Combat…';
  if (isMyTurn) {
    if (phase === 'market') return `Tour ${turnNumber} · Marché`;
    if (phase === 'main') return `Tour ${turnNumber} · Pose tes cartes`;
    return `Tour ${turnNumber}`;
  }
  if (phase === 'market') return "Tour de l'adversaire · Marché";
  if (phase === 'main') return "Tour de l'adversaire · Pose ses cartes";
  return "Tour de l'adversaire";
}

function hintText(isMyTurn: boolean, playing: boolean, phase: string): string {
  if (playing) return '';
  if (!isMyTurn) return "En attente de l'adversaire…";
  if (phase === 'market') return 'Clique une carte du marché pour l’acheter';
  if (phase === 'main') return 'Clique une carte de ta main puis un emplacement libre';
  return '';
}

function GameScreen({ room, seat, onLeaveToMenu }: GameScreenProps) {
  const state = room.state!;
  const [selectedHandUid, setSelectedHandUid] = useState<string | null>(null);
  const [turnBanner, setTurnBanner] = useState<{ seat: Seat; coinsGained: number; key: number } | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const lastHandledTurnEventId = useRef<number | undefined>(undefined);
  const lastAutoBeginTurnEventSeq = useRef<number | null>(null);

  const { playing, combatView, activeStep, displayedHp } = useCombatPlayback(state);

  const isMyTurn = state.turn === seat;
  const interactive = isMyTurn && !playing && !state.winner;
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

  // Bannière de tour, déclenchée par un évènement `turnStart` de nouvel id (§8, §12).
  useEffect(() => {
    const event = state.lastEvent;
    const currentId = event?.id ?? 0;

    if (lastHandledTurnEventId.current === undefined) {
      lastHandledTurnEventId.current = currentId;
      return;
    }
    if (currentId === lastHandledTurnEventId.current) return;
    lastHandledTurnEventId.current = currentId;

    if (event?.type === 'turnStart') {
      setTurnBanner({ seat: event.seat, coinsGained: event.coinsGained, key: event.id });
    }
  }, [state.lastEvent]);

  useEffect(() => {
    if (!turnBanner) return;
    const timeout = setTimeout(() => setTurnBanner(null), 1800);
    return () => clearTimeout(timeout);
  }, [turnBanner]);

  useEffect(() => {
    if (!codeCopied) return;
    const timeout = setTimeout(() => setCodeCopied(false), 1500);
    return () => clearTimeout(timeout);
  }, [codeCopied]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setSelectedHandUid(null);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // La sélection de carte ne survit pas à un changement de phase ou de tour (§6.6).
  useEffect(() => {
    setSelectedHandUid(null);
  }, [state.phase, state.turn]);

  // `beginTurn` automatique (T3) : le client du nouveau joueur actif l'envoie dès que la
  // lecture du combat précédent est terminée. Garde par `eventSeq` : une seule tentative par
  // état (StrictMode double les effets ; l'action redevenant illégale ensuite est un second
  // filet).
  useEffect(() => {
    if (playing || state.winner || state.turn !== seat || state.phase !== 'start') return;
    if (lastAutoBeginTurnEventSeq.current === state.eventSeq) return;
    lastAutoBeginTurnEventSeq.current = state.eventSeq;
    sendAction(room, seat, { type: 'beginTurn' });
  }, [playing, state.winner, state.turn, state.phase, state.eventSeq, room, seat]);

  async function buy(uid: string) {
    await sendAction(room, seat, { type: 'buy', uid });
  }

  async function endMarket() {
    await sendAction(room, seat, { type: 'endMarket' });
  }

  async function place(zone: Zone, slot: number) {
    if (!selectedHandUid) return;
    await sendAction(room, seat, { type: 'place', uid: selectedHandUid, zone, slot });
    setSelectedHandUid(null);
  }

  async function endTurn() {
    setSelectedHandUid(null);
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

  const showVictory = Boolean(state.winner) && !playing;
  const mainButtonLabel = state.phase === 'market' ? 'Terminer les achats' : 'Combat !';
  const mainButtonAction = state.phase === 'market' ? endMarket : endTurn;
  const mainButtonEnabled = interactive && (state.phase === 'market' || state.phase === 'main');

  return (
    <div
      className="game-screen"
      onContextMenu={(e) => {
        e.preventDefault();
        setSelectedHandUid(null);
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
          interactive={interactive}
          selectedHandUid={selectedHandUid}
          combatView={combatView}
          activeStep={activeStep}
          displayedHp={displayedHp}
          onBuy={buy}
          onSelectHandCard={setSelectedHandUid}
          onPlace={place}
          onDeselect={() => setSelectedHandUid(null)}
        />
      </Canvas>

      {!showVictory && (
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

          {playing && <div className="combat-banner">Combat !</div>}

          {turnBanner && (
            <div className={`turn-banner ${turnBanner.seat === seat ? 'mine' : 'theirs'}`}>
              {turnBanner.seat === seat ? `À toi de jouer · +${turnBanner.coinsGained} pièce(s)` : "Tour de l'adversaire"}
            </div>
          )}

          <p className="phase-indicator">{phaseLabel(isMyTurn, playing, state.phase, state.turnNumber)}</p>

          <PlayerPlate
            name={opponentName}
            hp={displayedHp[opponentSeat]}
            coins={opponent.coins}
            deckCount={opponent.deck.length}
            handCount={opponent.hand.length}
            active={!isMyTurn}
            align="top"
          />

          <PlayerPlate
            name={myName}
            hp={displayedHp[seat]}
            coins={me.coins}
            deckCount={me.deck.length}
            handCount={me.hand.length}
            active={isMyTurn}
            align="bottom"
          />

          <button
            className={`end-turn ${mainButtonEnabled ? 'is-ready' : ''}`}
            disabled={!mainButtonEnabled}
            onClick={mainButtonAction}
          >
            <span>{mainButtonLabel}</span>
          </button>

          <p className="hint">{hintText(isMyTurn, playing, state.phase)}</p>
        </div>
      )}

      {showVictory && (
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
      )}
    </div>
  );
}

export default GameScreen;
