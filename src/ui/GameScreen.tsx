import { Canvas } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { describeAbility, getCardDef, isMonster } from '../game/cards';
import { isActionLegal, isFirstTurnOfGame, nextTurnCoinGain } from '../game/rules';
import type { CardInstance, EffectLog, GameState, MonsterZone, Room, Seat, Zone } from '../game/types';
import { ABANDON_TIMEOUT_MS, deleteRoom, leaveMatch, rememberLeftRoom, requestRematch, sendAction } from '../net/rooms';
import Board, { type DragState, type ScreenRect } from '../scene/Board';
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
  turnsPlayed,
  nextGain,
  deckCount,
  handCount,
  active,
  align,
}: {
  name: string;
  hp: number;
  coins: number;
  turnsPlayed: number;
  nextGain: number;
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
        <span className="hud-turn" title={`Tours joués : ${turnsPlayed} · pièces gagnées au prochain tour : ${nextGain}`}>
          Tour {turnsPlayed} · prochain +{nextGain}
          <span className="coin-icon coin-icon--small" aria-hidden="true" />
        </span>
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

interface EffectToast {
  key: number;
  text: string;
  mine: boolean;
}

function combatBannerText(cycle: number, phase: 'melee' | 'breakthrough', stalemate: boolean, complete: boolean): string {
  if (stalemate && complete) return 'Combat nul';
  if (phase === 'breakthrough') return 'Percée !';
  return cycle > 1 ? `Combat · cycle ${cycle}` : 'Combat !';
}

function phaseLabel(isMyTurn: boolean, playing: boolean, phase: string, turnNumber: number): string {
  if (playing) return 'Combat…';
  if (isMyTurn) {
    if (phase === 'main') return `Tour ${turnNumber} · Marché & pose de cartes`;
    return `Tour ${turnNumber}`;
  }
  if (phase === 'main') return "Tour de l'adversaire · Marché & pose de cartes";
  return "Tour de l'adversaire";
}

function hintText(isMyTurn: boolean, playing: boolean, phase: string, fusable: boolean): string {
  if (playing) return '';
  if (!isMyTurn) return "En attente de l'adversaire…";
  if (fusable) return 'Relâche la carte dans la zone de fusion pour créer un monstre doré';
  if (phase === 'main') return 'Achète, pose ou déplace tes cartes, puis lance le combat';
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
  const marketZoneRectRef = useRef<ScreenRect | null>(null);
  const [zoomedUid, setZoomedUid] = useState<string | null>(null);
  const [turnBanner, setTurnBanner] = useState<{ seat: Seat; coinsGained: number; key: number } | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [marketVisible, setMarketVisible] = useState(true);
  const [effectToasts, setEffectToasts] = useState<EffectToast[]>([]);
  const lastHandledTurnEventId = useRef<number | undefined>(undefined);
  const lastAutoBeginTurnEventSeq = useRef<number | null>(null);
  const lastHandledEffectsEventId = useRef<number | undefined>(undefined);
  const combatEffectsSeenRef = useRef(0);
  const toastIdRef = useRef(0);

  const { playing, combatView, activeStep, displayedHp } = useCombatPlayback(state);

  // Fil d'effets (§6.3) : un toast par effet de capacité résolu, ~2,5 s. Sources : les
  // `effects` d'un nouvel évènement `place`/`sell`, et les `appliedEffects` du combat au fil
  // de la lecture (`combatView` se recalcule à chaque frame pendant la lecture).
  function pushEffectToasts(effects: EffectLog[]) {
    if (effects.length === 0) return;
    const toasts: EffectToast[] = effects.map((effect) => ({
      key: toastIdRef.current++,
      text: `${getCardDef(effect.cardId).name} — ${describeAbility({ trigger: effect.trigger, effect: effect.effect })}`,
      mine: effect.seat === seat,
    }));
    setEffectToasts((prev) => [...prev, ...toasts]);
    for (const toast of toasts) {
      setTimeout(() => setEffectToasts((prev) => prev.filter((t) => t.key !== toast.key)), 2500);
    }
  }

  // Effets de `place`/`sell`, sur un nouvel évènement (même garde que la bannière de tour :
  // au premier rendu, on mémorise sans rejouer, sinon un rafraîchissement rejouerait tout).
  useEffect(() => {
    const event = state.lastEvent;
    const currentId = event?.id ?? 0;
    if (lastHandledEffectsEventId.current === undefined) {
      lastHandledEffectsEventId.current = currentId;
      return;
    }
    if (currentId === lastHandledEffectsEventId.current) return;
    lastHandledEffectsEventId.current = currentId;

    if ((event?.type === 'place' || event?.type === 'sell') && event.effects.length > 0) {
      pushEffectToasts(event.effects);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.lastEvent]);

  // Effets appliqués au fil du combat : `combatView` grandit à chaque frame de lecture.
  useEffect(() => {
    if (!combatView) {
      combatEffectsSeenRef.current = 0;
      return;
    }
    const seen = combatEffectsSeenRef.current;
    if (combatView.appliedEffects.length > seen) {
      pushEffectToasts(combatView.appliedEffects.slice(seen));
      combatEffectsSeenRef.current = combatView.appliedEffects.length;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combatView]);

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

  // Le marché masqué (bouton HUD) redevient visible au tour suivant, pour ne pas le laisser
  // caché par surprise sans que le joueur s'en souvienne.
  useEffect(() => {
    setMarketVisible(true);
  }, [state.turn]);

  // Plus rien à acheter (coins insuffisants pour toutes les cartes restantes) : le marché se
  // referme tout seul (demande utilisateur), rouvrable manuellement via le bouton HUD. Ne se
  // déclenche que sur la transition achetable → plus achetable (ex. juste après un achat qui
  // épuise les pièces), pas à chaque rendu : sinon rouvrir manuellement le marché alors que
  // rien n'est toujours achetable le refermerait aussitôt (bug corrigé ici).
  const canBuyAnything = me.market.some((card) => isActionLegal(state, seat, { type: 'buy', uid: card.uid }));
  const prevCanBuyAnythingRef = useRef(canBuyAnything);
  useEffect(() => {
    const wasBuyable = prevCanBuyAnythingRef.current;
    prevCanBuyAnythingRef.current = canBuyAnything;
    if (wasBuyable && !canBuyAnything && marketVisible && isMyTurn && state.phase === 'main') {
      setMarketVisible(false);
    }
  }, [canBuyAnything, marketVisible, isMyTurn, state.phase]);

  // Clic en dehors du rectangle du marché (calculé à chaque frame par `MarketZoneTracker` côté
  // 3D, lu ici au clic) : referme le marché, sauf clic sur son propre bouton d'affichage qui
  // gère déjà l'ouverture/fermeture (demande utilisateur).
  useEffect(() => {
    if (!marketVisible || !isMyTurn || state.phase !== 'main') return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.market-toggle-button')) return;
      const rect = marketZoneRectRef.current;
      const inside = rect && e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
      if (!inside) setMarketVisible(false);
    }
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [marketVisible, isMyTurn, state.phase]);

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
      } else if (drag.origin) {
        await sendAction(room, seat, { type: 'move', uid: drag.uid, slot: target.slot });
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
    await requestRematch(room, seat);
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
  const rematchReady = room.rematchReady ?? { p1: false, p2: false };
  const iAmReadyForRematch = rematchReady[seat];
  const opponentReadyForRematch = rematchReady[opponentSeat];
  // Pas de combat au premier tour de la partie : le bouton ne fait que passer la main.
  const mainButtonLabel = isFirstTurnOfGame(state) ? 'Fin du tour' : 'Combat !';
  const mainButtonAction = endTurn;
  const mainButtonEnabled = interactive && state.phase === 'main';

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
          marketVisible={marketVisible}
          marketZoneRectRef={marketZoneRectRef}
          onBuy={buy}
          onDragStart={(uid, x, y, origin) => {
            setZoomedUid(null);
            setDrag({ uid, start: { x, y }, origin });
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

          {isMyTurn && state.phase === 'main' && (
            <button
              className="market-toggle-button"
              onClick={() => setMarketVisible((v) => !v)}
              title={marketVisible ? 'Masquer le marché' : 'Afficher le marché'}
            >
              {marketVisible ? 'Masquer le marché' : 'Afficher le marché'}
            </button>
          )}

          {abandonCountdown !== null && (
            <div className="abandon-notice">
              {opponentName} a quitté la partie — retour au menu dans {abandonCountdown}s
            </div>
          )}

          {playing && combatView && (
            <div className="combat-banner">
              {combatBannerText(combatView.cycle, combatView.phase, combatView.stalemate, combatView.complete)}
            </div>
          )}

          {effectToasts.length > 0 && (
            <div className="effect-toasts">
              {effectToasts.map((toast) => (
                <div key={toast.key} className={`effect-toast ${toast.mine ? 'mine' : 'theirs'}`}>
                  {toast.text}
                </div>
              ))}
            </div>
          )}

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
            turnsPlayed={opponent.turnsPlayed}
            nextGain={nextTurnCoinGain(opponent)}
            deckCount={opponent.deck.length}
            handCount={opponent.hand.length}
            active={!isMyTurn}
            align="top"
          />

          <PlayerPlate
            name={myName}
            hp={displayedHp[seat]}
            coins={me.coins}
            turnsPlayed={me.turnsPlayed}
            nextGain={nextTurnCoinGain(me)}
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
            <button className="hud-button hud-button--gold" onClick={handleRematch} disabled={iAmReadyForRematch}>
              {iAmReadyForRematch ? "En attente de l'adversaire…" : 'Revanche'}
            </button>
            <button className="hud-button" onClick={leaveGame}>
              Retour au menu
            </button>
          </div>
          {opponentReadyForRematch && !iAmReadyForRematch && (
            <p className="rematch-notice">{opponentName} veut une revanche !</p>
          )}
        </div>
      )}
    </div>
  );
}

export default GameScreen;
