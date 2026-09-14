import { Canvas } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getCardDef, isMonster } from '../game/cards';
import { isActionLegal } from '../game/rules';
import type { CardInstance, GameState, MonsterZone, Room, Seat, Zone } from '../game/types';
import { ABANDON_TIMEOUT_MS, deleteRoom, leaveMatch, rememberLeftRoom, rematch, sendAction } from '../net/rooms';
import Board, { type DragState } from '../scene/Board';
import { computeMonsterFaceStats } from '../scene/cardFaceStats';
import CameraRig from '../scene/CameraRig';
import type { DropTarget } from '../scene/DragController';
import { CAMERA } from '../scene/layout';
import { getCardFaceDataUrl } from '../scene/textures';
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

function hintText(isMyTurn: boolean, playing: boolean, phase: string, fusable: boolean): string {
  if (playing) return '';
  if (!isMyTurn) return "En attente de l'adversaire…";
  if (phase === 'market') return 'Clique une carte du marché pour l’acheter';
  if (fusable) return 'Relâche la carte dans la zone de fusion pour créer un monstre doré';
  if (phase === 'main') return 'Fais glisser une carte de ta main sur un emplacement libre';
  return '';
}

interface ZoomedCard {
  owner: Seat;
  zone: Zone;
  slot: number;
  card: CardInstance;
  cardId: string;
  uid: string;
}

// Cherche une carte posée (n'importe laquelle des deux boards) par son uid, pour le zoom
// au clic sur une carte du board (§ demande utilisateur : zoom + vente).
function findZoneCard(state: GameState, uid: string): ZoomedCard | null {
  for (const owner of ['p1', 'p2'] as Seat[]) {
    for (const zone of ['attack', 'defense', 'enchant'] as Zone[]) {
      const slot = state.players[owner].zones[zone].findIndex((s) => s?.uid === uid);
      if (slot !== -1) {
        const card = state.players[owner].zones[zone][slot]!;
        return { owner, zone, slot, card, cardId: card.cardId, uid };
      }
    }
  }
  return null;
}

function GameScreen({ room, seat, onLeaveToMenu }: GameScreenProps) {
  const state = room.state!;
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const fusionZoneRef = useRef<HTMLDivElement>(null);
  const [zoomedUid, setZoomedUid] = useState<string | null>(null);
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
  // supprime la room si personne n'est revenu (voir `leaveMatch`/`deleteRoom`). Si la partie
  // est déjà terminée, il n'y a rien à attendre : l'adversaire a quitté au lieu de demander
  // la revanche, donc on part immédiatement et on supprime la room (pas de délai de grâce,
  // il n'y a plus de match en cours à laisser une chance de reconnexion).
  useEffect(() => {
    if (!opponentLeftAt) {
      setAbandonCountdown(null);
      return;
    }

    if (state.winner) {
      setAbandonCountdown(null);
      deleteRoom(room.code).catch(() => {});
      onLeaveToMenu();
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
      if (e.key === 'Escape') {
        cancelDrag();
        setZoomedUid(null);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Un glisser-déposer ne survit pas à un changement de phase ou de tour (§6.6).
  useEffect(() => {
    cancelDrag();
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

  function cancelDrag() {
    setDrag(null);
    setDropTarget(null);
  }

  // Dépôt d'une carte glissée : sur un emplacement légal -> `place`, sur la zone de fusion
  // -> `fuse`, ailleurs -> la carte retourne dans la main. Le drag reste actif jusqu'à
  // l'envoi de l'action, pour que la carte ne revienne pas en main entre-temps.
  async function handleDrop(target: DropTarget | null) {
    setDropTarget(null);
    if (!drag || !target) {
      setDrag(null);
      return;
    }
    try {
      if (target.kind === 'fusion') {
        await sendAction(room, seat, { type: 'fuse', uid: drag.uid });
      } else {
        await sendAction(room, seat, { type: 'place', uid: drag.uid, zone: target.zone, slot: target.slot });
      }
    } finally {
      setDrag(null);
    }
  }

  // Test de la zone de fusion (surcouche HTML) sous le pointeur : un disque, pas son carré.
  function isOverFusionZone(clientX: number, clientY: number): boolean {
    const el = fusionZoneRef.current;
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const radius = rect.width / 2;
    return Math.hypot(clientX - (rect.left + radius), clientY - (rect.top + rect.height / 2)) <= radius;
  }

  async function endTurn() {
    cancelDrag();
    await sendAction(room, seat, { type: 'endTurn' });
  }

  async function sellCard(uid: string) {
    await sendAction(room, seat, { type: 'sell', uid });
    setZoomedUid(null);
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

  const zoomed = zoomedUid ? findZoneCard(state, zoomedUid) : null;
  const zoomImageUrl = useMemo(() => {
    if (!zoomed) return null;
    const def = getCardDef(zoomed.cardId);
    const stats = isMonster(def)
      ? computeMonsterFaceStats(state.players[zoomed.owner], zoomed.card, zoomed.zone as MonsterZone, null).stats
      : null;
    return getCardFaceDataUrl(def, stats);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, zoomedUid]);
  // Zone de fusion affichée seulement quand la carte tenue peut fusionner.
  const fusable = drag !== null && interactive && isActionLegal(state, seat, { type: 'fuse', uid: drag.uid });
  const canSell = Boolean(
    zoomed && zoomed.owner === seat && interactive && isActionLegal(state, seat, { type: 'sell', uid: zoomed.uid }),
  );

  return (
    <div
      className="game-screen"
      onContextMenu={(e) => e.preventDefault()}
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
          drag={drag}
          dropTarget={dropTarget}
          combatView={combatView}
          activeStep={activeStep}
          displayedHp={displayedHp}
          onBuy={buy}
          onDragStart={(uid, x, y) => {
            setZoomedUid(null);
            setDrag({ uid, start: { x, y } });
          }}
          onDragHover={setDropTarget}
          onDrop={handleDrop}
          isOverFusionZone={(x, y) => fusable && isOverFusionZone(x, y)}
          onZoomCard={setZoomedUid}
        />
      </Canvas>

      {fusable && (
        <div ref={fusionZoneRef} className={`fusion-zone ${dropTarget?.kind === 'fusion' ? 'is-hovered' : ''}`}>
          <span className="fusion-zone-icon" aria-hidden="true">
            ★
          </span>
          <span className="fusion-zone-label">Fusion</span>
        </div>
      )}

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

          <p className="hint">{hintText(isMyTurn, playing, state.phase, fusable)}</p>
        </div>
      )}

      {zoomed && zoomImageUrl && (
        <div className="card-zoom-backdrop" onClick={() => setZoomedUid(null)}>
          <div className="card-zoom-panel" onClick={(e) => e.stopPropagation()}>
            <button className="card-zoom-close" onClick={() => setZoomedUid(null)} aria-label="Fermer">
              ×
            </button>
            <img className="card-zoom-image" src={zoomImageUrl} alt="" />
            {zoomed.owner === seat && (
              <button
                className="hud-button hud-button--gold card-zoom-sell"
                disabled={!canSell}
                onClick={() => sellCard(zoomed.uid)}
              >
                Vendre (+1 pièce)
              </button>
            )}
          </div>
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
            <button className="hud-button" onClick={leaveGame}>
              Retour au menu
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default GameScreen;
