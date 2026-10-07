import { Canvas } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { describeAbility, describeKeywordTrigger, getCardDef, isMonster, isV2Active } from '../game/cards';
import {
  isActionLegal,
  isFirstTurnOfGame,
  isMarketCardLocked,
  MARKET_LOCK_COST,
  MARKET_REROLL_COST,
  nextTurnCoinGain,
  sellValue,
  zoneCards,
} from '../game/rules';
import { choiceTargets, locateMonster } from '../game/rulesV2';
import type { CardInstance, EffectLog, GameState, MonsterZone, Room, Seat, Zone } from '../game/types';
import { ABANDON_TIMEOUT_MS, deleteRoom, leaveMatch, rememberLeftRoom, requestRematch, sendAction } from '../net/rooms';
import Board, { type DragState, type ScreenRect } from '../scene/Board';
import { computeMonsterFaceStats, unplacedStats } from '../scene/cardFaceStats';
import CameraRig from '../scene/CameraRig';
import type { DropTarget } from '../scene/DragController';
import { CAMERA_FOV } from '../scene/layout';
import { getCardFaceDataUrl } from '../scene/textures';
import ElementWheel from './ElementWheel';
import RulesModal from './RulesModal';
import { useCombatPlayback } from './useCombatPlayback';

// Écran de jeu : scène 3D plein écran + HUD superposé en surcouche. Un seul <Canvas>, y
// compris en fin de partie (T8) : l'écran de victoire est une surcouche HTML, pas un
// second Canvas — ça couperait l'animation du dernier combat.

interface GameScreenProps {
  room: Room;
  seat: Seat;
  onLeaveToMenu: () => void;
}

// Durée du lancer de pièce du début de partie, calée sur l'animation CSS `.coin-flip-coin`
// (voir styles.css) : le premier tour ne démarre qu'une fois la pièce retombée.
const COIN_FLIP_MS = 2800;

// Livre ouvert, pour le bouton des règles.
const RULES_ICON_PATH = 'M12 6.5C10.5 5.2 8.6 4.5 6 4.5H3v14h3c2.6 0 4.5.7 6 2 1.5-1.3 3.4-2 6-2h3v-14h-3c-2.6 0-4.5.7-6 2zM12 6.5v14';
// Téléphone couché et flèche de rotation, pour l'invite à passer en paysage.
const ROTATE_ICON_PATH = 'M3 9a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM14 12h.01M8 4.5A7 7 0 0 1 20 7.5M20 3.5v4h-4';
const LEAVE_ICON_PATH = 'M9 3H4a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h5M15 8l4 4-4 4M19 12H8';
// Engrenage, pour le menu de partie (room, règles, quitter).
const MENU_ICON_PATH =
  'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z';
// Flèches circulaires, pour la relance du marché.
const REROLL_ICON_PATH = 'M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.2L3 16M3 21v-5h5';

function CoinBadge({ coins }: { coins: number }) {
  return (
    <span className="coin-badge" title="Pièces">
      <span className="coin-icon" aria-hidden="true" />
      <span className="coin-value">{coins}</span>
    </span>
  );
}

// Cartouche d'un joueur, accroché à son héros (sous le mien, au-dessus de celui de
// l'adversaire) : nom, pièces et gain du prochain tour. Les PV sont sur le héros lui-même.
function HeroPlate({
  name,
  coins,
  turnsPlayed,
  nextGain,
  active,
  side,
}: {
  name: string;
  coins: number;
  turnsPlayed: number;
  nextGain: number;
  active: boolean;
  side: 'mine' | 'opp';
}) {
  return (
    <div
      className={`hero-plate hero-plate--${side} ${active ? 'is-active' : ''}`}
      title={`Tours joués : ${turnsPlayed} · pièces gagnées au prochain tour : ${nextGain}`}
    >
      {active && <span className="hud-turn-dot" aria-hidden="true" />}
      <span className="hero-plate-name">{name}</span>
      <span className="hero-plate-economy">
        <CoinBadge coins={coins} />
        <span className="hero-plate-gain">
          +{nextGain}
          <span className="coin-icon coin-icon--small" aria-hidden="true" />
        </span>
      </span>
    </div>
  );
}

interface EffectToast {
  key: number;
  text: string;
  mine: boolean;
}

// Texte d'une ligne du fil d'effets : une capacité qui a résolu son effet, ou une habileté
// (mot-clé) qui vient de modifier la résolution — Provocation, Protection, Portée, Furie,
// Toxic, Négociant ne passent pas par `CardAbility` et ont leur propre libellé.
function describeEffectLog(log: EffectLog): string {
  if (log.kind === 'keyword') return describeKeywordTrigger(log.keyword);
  return describeAbility({ trigger: log.trigger, effect: log.effect });
}

function combatBannerText(cycle: number, phase: 'melee' | 'breakthrough', stalemate: boolean, complete: boolean): string {
  if (stalemate && complete) return 'Combat nul';
  if (phase === 'breakthrough') return 'Percée !';
  return cycle > 1 ? `Combat · cycle ${cycle}` : 'Combat !';
}

// Indicateur de phase, au-dessus du bouton de combat : court, pour tenir sur une ligne.
function phaseLabel(isMyTurn: boolean, playing: boolean, turnNumber: number): string {
  if (playing) return 'Combat…';
  if (isMyTurn) return `Tour ${turnNumber} · à toi`;
  return "Tour de l'adversaire";
}

// Déplacements encore disponibles ce tour-ci (un par zone) : sans ce rappel, une carte
// simplement plus saisissable laisserait croire à un bug.
function movesHint(movesUsed: Record<MonsterZone, boolean> | undefined): string {
  const left = (['attack', 'defense'] as MonsterZone[]).filter((zone) => movesUsed?.[zone] !== true);
  if (left.length === 2) return '';
  if (left.length === 0) return ' · plus aucun déplacement ce tour';
  return ` · déplacement restant : ${left[0] === 'attack' ? 'attaque' : 'défense'}`;
}

// V2 : consigne du choix de cible en attente (effet « monstre choisi »).
function choiceHint(state: GameState, seat: Seat, pickedUid: string | null): string {
  const choice = state.pendingChoice;
  if (!choice) return '';
  if (choice.seat !== seat) return "L'adversaire choisit une cible…";
  const source = getCardDef(choice.cardId).name;
  switch (choice.effect.type) {
    case 'armorChosen':
      return `${source} : choisis un de tes monstres, il gagne ${choice.effect.amount} armure`;
    case 'grantShield':
      return `${source} : choisis un de tes monstres, il reçoit une protection`;
    case 'burn':
      return `${source} : choisis le monstre adverse à brûler`;
    case 'freeze':
      return `${source} : choisis le monstre adverse à geler`;
    case 'moveZone':
      return `${source} : choisis le monstre qui change de zone`;
    case 'extinguish':
      return `${source} : choisis le monstre brûlé dont la brûlure s'éteint`;
    case 'root':
      return `${source} : choisis le monstre à enraciner jusqu'à ton prochain tour`;
    case 'silence':
      return `${source} : choisis le monstre adverse à réduire au silence`;
    case 'moveSlot':
      return pickedUid
        ? `${source} : clique sur la carte dont il prend la place (ou de nouveau sur lui pour changer)`
        : `${source} : choisis le monstre à déplacer dans sa zone`;
    default:
      return `${source} : choisis une cible`;
  }
}

function hintText(
  isMyTurn: boolean,
  playing: boolean,
  phase: string,
  fusable: boolean,
  movesUsed: Record<MonsterZone, boolean> | undefined,
): string {
  if (playing) return '';
  if (!isMyTurn) return "En attente de l'adversaire…";
  if (fusable)
    return 'Pose la carte, relâche-la dans la zone de fusion (sur le board adverse) pour la rendre dorée, ou sur ton deck pour la vendre';
  if (phase === 'main')
    return `Achète, pose ou déplace tes cartes, puis lance le combat${movesHint(movesUsed)} · cadenas sur une carte du marché : la garder pour le prochain tour`;
  return '';
}

// `zone` : une zone du board, ou 'hand'/'market' pour une carte de MA main ou de MON marché,
// ouvertes en grand au doigt (appui long ou tap, voir `onInspect` de Card) faute de survol.
interface ZoomedCard {
  owner: Seat;
  zone: Zone | 'hand' | 'market';
  card: CardInstance;
  cardId: string;
  uid: string;
}

// Cherche une carte posée (n'importe laquelle des deux boards) par son uid, pour le zoom
// au clic sur une carte du board (§ demande utilisateur : zoom + vente), puis dans ma main et
// mon marché.
function findZoomableCard(state: GameState, seat: Seat, uid: string): ZoomedCard | null {
  for (const owner of ['p1', 'p2'] as Seat[]) {
    for (const zone of ['attack', 'defense', 'enchant'] as Zone[]) {
      const card = state.players[owner].zones[zone].find((s) => s?.uid === uid);
      if (card) return { owner, zone, card, cardId: card.cardId, uid };
    }
  }
  for (const zone of ['hand', 'market'] as const) {
    const card = state.players[seat][zone].find((c) => c.uid === uid);
    if (card) return { owner: seat, zone, card, cardId: card.cardId, uid };
  }
  return null;
}

function GameScreen({ room, seat, onLeaveToMenu }: GameScreenProps) {
  const state = room.state!;
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const fusionZoneRef = useRef<HTMLDivElement>(null);
  const sellZoneRef = useRef<HTMLDivElement>(null);
  // Racine de l'écran : reçoit les variables CSS des ancrages du HUD sur le plateau.
  const screenRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const marketZoneRectRef = useRef<ScreenRect | null>(null);
  const [zoomedUid, setZoomedUid] = useState<string | null>(null);
  const [turnBanner, setTurnBanner] = useState<{ seat: Seat; coinsGained: number; key: number } | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [marketVisible, setMarketVisible] = useState(true);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [effectToasts, setEffectToasts] = useState<EffectToast[]>([]);
  const lastHandledTurnEventId = useRef<number | undefined>(undefined);
  const lastAutoBeginTurnEventSeq = useRef<number | null>(null);
  const lastHandledEffectsEventId = useRef<number | undefined>(undefined);
  const combatEffectsSeenRef = useRef(0);
  const toastIdRef = useRef(0);

  const { playing, combatView, activeStep, displayedHp } = useCombatPlayback(state);
  // V2 : premier monstre désigné pour « Change un monstre ciblé de position » (il faut ensuite
  // désigner la place qu'il prend). Remis à zéro dès que le choix en attente change.
  const [pickedUid, setPickedUid] = useState<string | null>(null);
  useEffect(() => setPickedUid(null), [state.pendingChoice]);

  // Lancer de pièce du début de partie (demande utilisateur) : le siège tiré est déjà dans
  // l'état (`state.starter`), l'animation ne fait que le révéler. Tant que le premier
  // `beginTurn` n'a pas été joué, `lastEvent` est `null` chez les deux clients : ils
  // affichent donc la même pièce au même moment, et une revanche la relance.
  const awaitingCoinFlip = state.lastEvent === null && state.winner === null;
  const [coinFlipDone, setCoinFlipDone] = useState(false);
  useEffect(() => {
    setCoinFlipDone(false);
    if (!awaitingCoinFlip) return;
    const timeout = setTimeout(() => setCoinFlipDone(true), COIN_FLIP_MS);
    return () => clearTimeout(timeout);
  }, [awaitingCoinFlip]);
  const showCoinFlip = awaitingCoinFlip && !coinFlipDone;

  // Fil d'effets (§6.3) : un toast par effet de capacité résolu, ~2,5 s. Sources : les
  // `effects` d'un nouvel évènement `place`/`sell`, et les `appliedEffects` du combat au fil
  // de la lecture (`combatView` se recalcule à chaque frame pendant la lecture).
  function pushEffectToasts(effects: EffectLog[]) {
    if (effects.length === 0) return;
    const toasts: EffectToast[] = effects.map((effect) => ({
      key: toastIdRef.current++,
      text: `${getCardDef(effect.cardId).name} — ${describeEffectLog(effect)}`,
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

    if ((event?.type === 'place' || event?.type === 'sell' || event?.type === 'choice') && event.effects.length > 0) {
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

  // V2 : monstres emportés par leur brûlure, annoncés une fois la lecture du combat terminée
  // (avant, la carte est encore affichée sur le board du combat).
  const lastBurnAnnounce = useRef<number | null>(null);
  useEffect(() => {
    const event = state.lastEvent;
    if (playing || event?.type !== 'combat' || !event.burnedOut?.length) return;
    if (lastBurnAnnounce.current === event.id) return;
    lastBurnAnnounce.current = event.id;
    const toasts: EffectToast[] = event.burnedOut.map((out) => ({
      key: toastIdRef.current++,
      text: `${getCardDef(out.cardId).name} — consumé par sa brûlure, retourne sous le deck`,
      mine: out.seat === seat,
    }));
    setEffectToasts((prev) => [...prev, ...toasts]);
    for (const toast of toasts) {
      setTimeout(() => setEffectToasts((prev) => prev.filter((t) => t.key !== toast.key)), 3000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, state.lastEvent]);

  const isMyTurn = state.turn === seat;
  const interactive = isMyTurn && !playing && !state.winner;
  // V2 : un effet attend que je désigne sa cible.
  const choosing = interactive && state.pendingChoice?.seat === seat;
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
        setRulesOpen(false);
        setMenuOpen(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Menu de partie : se referme au clic en dehors.
  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [menuOpen]);

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
  // « Plus rien à faire au marché » couvre aussi la relance et le verrouillage (demande
  // utilisateur) : tant qu'une de ces trois actions est payable, le marché reste ouvert.
  const canActOnMarket =
    me.market.some(
      (card) =>
        isActionLegal(state, seat, { type: 'buy', uid: card.uid }) ||
        isActionLegal(state, seat, { type: 'toggleMarketLock', uid: card.uid }),
    ) || isActionLegal(state, seat, { type: 'rerollMarket' });
  const prevCanActOnMarketRef = useRef(canActOnMarket);
  useEffect(() => {
    const wasActionable = prevCanActOnMarketRef.current;
    prevCanActOnMarketRef.current = canActOnMarket;
    if (wasActionable && !canActOnMarket && marketVisible && isMyTurn && state.phase === 'main') {
      setMarketVisible(false);
    }
  }, [canActOnMarket, marketVisible, isMyTurn, state.phase]);

  // Clic en dehors du rectangle du marché (calculé à chaque frame par `MarketZoneTracker` côté
  // 3D, lu ici au clic) : referme le marché, sauf clic sur son propre bouton d'affichage qui
  // gère déjà l'ouverture/fermeture (demande utilisateur).
  useEffect(() => {
    if (!marketVisible || !isMyTurn || state.phase !== 'main') return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as HTMLElement | null;
      if (
        target?.closest('.market-toggle-button') ||
        target?.closest('.market-reroll-button') ||
        target?.closest('.hud-menu') ||
        target?.closest('.card-zoom-backdrop')
      )
        return;
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
    if (showCoinFlip) return; // le premier tour attend que la pièce soit retombée
    if (lastAutoBeginTurnEventSeq.current === state.eventSeq) return;
    lastAutoBeginTurnEventSeq.current = state.eventSeq;
    sendAction(room, seat, { type: 'beginTurn' });
  }, [playing, showCoinFlip, state.winner, state.turn, state.phase, state.eventSeq, room, seat]);

  async function buy(uid: string) {
    await sendAction(room, seat, { type: 'buy', uid });
  }

  // Relance du marché contre 1 pièce (demande utilisateur). Le marché masqué se rouvre :
  // relancer sans voir le résultat n'aurait pas de sens.
  async function rerollMarket() {
    setMarketVisible(true);
    await sendAction(room, seat, { type: 'rerollMarket' });
  }

  // Cadenas d'une carte du marché : la garder pour le prochain marché contre 1 pièce, ou la
  // libérer (la pièce est rendue).
  async function toggleMarketLock(uid: string) {
    await sendAction(room, seat, { type: 'toggleMarketLock', uid });
  }

  function cancelDrag() {
    setDrag(null);
    setDropTarget(null);
  }

  // Dépôt d'une carte glissée : sur un emplacement légal -> `place`, sur la zone de fusion
  // -> `fuse`, sur la zone de vente -> `sell`, ailleurs -> la carte retourne à sa place. Le drag reste actif jusqu'à
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
      } else if (target.kind === 'sell') {
        await sendAction(room, seat, { type: 'sell', uid: drag.uid });
      } else if (drag.origin) {
        // V2 Vol : déposée dans l'autre zone de monstres, la carte change de zone.
        const zone = target.zone !== drag.origin.zone && target.zone !== 'enchant' ? target.zone : undefined;
        await sendAction(room, seat, { type: 'move', uid: drag.uid, slot: target.slot, ...(zone ? { zone } : {}) });
      } else {
        await sendAction(room, seat, { type: 'place', uid: drag.uid, zone: target.zone, slot: target.slot });
      }
    } finally {
      setDrag(null);
    }
  }

  // Test d'une zone de dépôt en surcouche HTML (fusion sur le board adverse, vente sur mon
  // deck) sous le pointeur.
  function isOverZone(el: HTMLElement | null, clientX: number, clientY: number): boolean {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  }

  // Fusion depuis le zoom d'une carte de ma main (bouton « Fusionner »), sans glisser-déposer.
  async function fuseZoomed(uid: string) {
    setZoomedUid(null);
    await sendAction(room, seat, { type: 'fuse', uid });
  }

  async function endTurn() {
    cancelDrag();
    await sendAction(room, seat, { type: 'endTurn' });
  }

  async function buyZoomed(uid: string) {
    await sendAction(room, seat, { type: 'buy', uid });
    setZoomedUid(null);
  }

  async function sellCard(uid: string) {
    await sendAction(room, seat, { type: 'sell', uid });
    setZoomedUid(null);
  }

  // V2 : désignation d'une cible pour l'effet en attente. Pour un changement de position, deux
  // clics : le monstre, puis la carte de sa zone dont il prend la place.
  async function pickTarget(uid: string) {
    const choice = state.pendingChoice;
    if (!choice) return;
    if (choice.effect.type !== 'moveSlot') {
      await sendAction(room, seat, { type: 'chooseTarget', uid });
      return;
    }
    if (!pickedUid || uid === pickedUid) {
      setPickedUid(uid === pickedUid ? null : uid);
      return;
    }
    const location = locateMonster(state, uid);
    if (!location) return;
    await sendAction(room, seat, { type: 'chooseTarget', uid: pickedUid, slot: location.index });
  }

  async function skipChoice() {
    await sendAction(room, seat, { type: 'chooseTarget', uid: null });
  }

  async function handleRematch() {
    await requestRematch(room, seat);
  }

  async function leaveGame() {
    let resumable = true;
    try {
      resumable = await leaveMatch(room, seat);
    } catch {
      // Le retour au menu doit fonctionner même si l'écriture échoue (hors-ligne, etc.).
    }
    // Pas de lien « Reprendre la partie » si la room a été supprimée (les deux joueurs sont
    // partis) ou si la partie est terminée : l'adversaire supprime alors la room aussitôt.
    if (resumable && !state.winner) rememberLeftRoom(room.code);
    onLeaveToMenu();
  }

  function copyRoomCode() {
    navigator.clipboard.writeText(room.code);
    setCodeCopied(true);
  }

  const canRerollMarket = interactive && isActionLegal(state, seat, { type: 'rerollMarket' });
  const showVictory = Boolean(state.winner) && !playing;
  const rematchReady = room.rematchReady ?? { p1: false, p2: false };
  const iAmReadyForRematch = rematchReady[seat];
  const opponentReadyForRematch = rematchReady[opponentSeat];
  const showMarketControls = isMyTurn && state.phase === 'main' && !state.winner;
  // Mon marché ouvert recouvre le vide à gauche des rangées où l'aide s'affiche : on la retire.
  const myMarketShown = showMarketControls && marketVisible && !state.pendingChoice && me.market.length > 0;
  // Pas de combat au premier tour de la partie : le bouton ne fait que passer la main.
  const mainButtonLabel = isFirstTurnOfGame(state) ? 'Fin du tour' : 'Combat !';
  const mainButtonAction = endTurn;
  const mainButtonEnabled = interactive && state.phase === 'main' && !state.pendingChoice;

  // V2 : cibles allumées sur le board pendant mon choix. Pour un changement de position, une
  // fois le monstre désigné : les cartes de sa zone (lui compris, pour se raviser).
  const targetUids = useMemo(() => {
    const choice = state.pendingChoice;
    if (!choosing || !choice) return null;
    if (choice.effect.type === 'moveSlot' && pickedUid) {
      const location = locateMonster(state, pickedUid);
      if (!location) return null;
      return new Set(zoneCards(state.players[location.seat], location.zone).map((c) => c.uid));
    }
    return new Set(choiceTargets(state, choice));
  }, [state, choosing, pickedUid]);

  const zoomed = zoomedUid ? findZoomableCard(state, seat, zoomedUid) : null;
  const zoomImageUrl = useMemo(() => {
    if (!zoomed) return null;
    const def = getCardDef(zoomed.cardId);
    const stats = !isMonster(def)
      ? unplacedStats(zoomed.card)
      : zoomed.zone === 'hand' || zoomed.zone === 'market'
        ? unplacedStats(zoomed.card)
        : computeMonsterFaceStats(state.players[zoomed.owner], zoomed.card, zoomed.zone as MonsterZone, null).stats;
    return getCardFaceDataUrl(def, stats);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, zoomedUid]);
  // Zone de fusion affichée seulement quand la carte tenue peut fusionner.
  const fusable = drag !== null && interactive && isActionLegal(state, seat, { type: 'fuse', uid: drag.uid });
  // Zone de vente (demande utilisateur) : sur mon deck, où la carte vendue retourne, pour toute
  // carte tenue qui peut se vendre (carte de la main, ou carte posée qu'on déplace).
  const sellableDrag = drag !== null && interactive && isActionLegal(state, seat, { type: 'sell', uid: drag.uid });
  const draggedCard = sellableDrag ? findZoomableCard(state, seat, drag.uid)?.card : undefined;
  // Bouton Vendre : sur mes cartes posées et dans ma main (demande utilisateur).
  const zoomedSellable = zoomed !== null && zoomed.owner === seat && zoomed.zone !== 'market';
  const canSell = Boolean(
    zoomed && zoomed.owner === seat && interactive && isActionLegal(state, seat, { type: 'sell', uid: zoomed.uid }),
  );
  const canFuseZoomed = Boolean(
    zoomed?.zone === 'hand' && interactive && isActionLegal(state, seat, { type: 'fuse', uid: zoomed.uid }),
  );
  const canBuyZoomed = Boolean(
    zoomed?.zone === 'market' && interactive && isActionLegal(state, seat, { type: 'buy', uid: zoomed.uid }),
  );
  // Le cadenas 3D est une petite cible au doigt : le zoom d'une carte du marché le reprend.
  const zoomedLocked = zoomed?.zone === 'market' && isMarketCardLocked(me, zoomed.uid);
  const canLockZoomed = Boolean(
    zoomed?.zone === 'market' && interactive && isActionLegal(state, seat, { type: 'toggleMarketLock', uid: zoomed.uid }),
  );

  return (
    <div
      ref={screenRef}
      className="game-screen"
      onContextMenu={(e) => e.preventDefault()}
    >
      <Canvas
        camera={{ fov: CAMERA_FOV, near: 0.1, far: 200 }}
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
          marketVisible={marketVisible && !state.pendingChoice}
          marketZoneRectRef={marketZoneRectRef}
          fusionZoneRef={fusionZoneRef}
          sellZoneRef={sellZoneRef}
          hudAnchorRef={screenRef}
          onShowMarket={() => setMarketVisible(true)}
          onBuy={buy}
          onToggleMarketLock={toggleMarketLock}
          onDragStart={(uid, x, y, origin) => {
            setZoomedUid(null);
            setDrag({ uid, start: { x, y }, origin });
          }}
          onDragHover={setDropTarget}
          onDrop={handleDrop}
          isOverFusionZone={(x, y) => fusable && isOverZone(fusionZoneRef.current, x, y)}
          isOverSellZone={(x, y) => sellableDrag && isOverZone(sellZoneRef.current, x, y)}
          onZoomCard={setZoomedUid}
          targeting={targetUids ? { uids: targetUids, onPick: (uid) => void pickTarget(uid) } : null}
        />
      </Canvas>

      {fusable && (
        <div ref={fusionZoneRef} className={`fusion-zone ${dropTarget?.kind === 'fusion' ? 'is-hovered' : ''}`}>
          {/* Deux cartes inclinées l'une vers l'autre, qui se rejoignent au survol. */}
          <svg className="fusion-zone-icon" viewBox="0 0 48 40" aria-hidden="true">
            <g className="fusion-zone-card fusion-zone-card--left">
              <rect x="5" y="7" width="17" height="25" rx="2.5" transform="rotate(-14 13.5 19.5)" />
            </g>
            <g className="fusion-zone-card fusion-zone-card--right">
              <rect x="26" y="7" width="17" height="25" rx="2.5" transform="rotate(14 34.5 19.5)" />
            </g>
            <path className="fusion-zone-spark" d="M24 13 L25.6 18.4 L31 20 L25.6 21.6 L24 27 L22.4 21.6 L17 20 L22.4 18.4 Z" />
          </svg>
          <span className="fusion-zone-label">Fusion</span>
          <span className="fusion-zone-caption">Déposer pour dorer</span>
        </div>
      )}

      {draggedCard && (
        <div ref={sellZoneRef} className={`sell-zone ${dropTarget?.kind === 'sell' ? 'is-hovered' : ''}`}>
          <span className="coin-icon sell-zone-icon" aria-hidden="true" />
          <span className="sell-zone-label">Vendre</span>
          <span className="sell-zone-value">+{sellValue(draggedCard, me)}</span>
        </div>
      )}

      {showCoinFlip && (
        <div className="coin-flip-overlay">
          <p className="coin-flip-title">Lancer de pièce</p>
          <div className={`coin-flip-coin ${state.starter === seat ? 'lands-mine' : 'lands-theirs'}`}>
            <span className="coin-flip-face coin-flip-face--mine">{myName}</span>
            <span className="coin-flip-face coin-flip-face--theirs">{opponentName}</span>
          </div>
          <p className={`coin-flip-result ${state.starter === seat ? 'mine' : 'theirs'}`}>
            {state.starter === seat ? 'Tu commences !' : `${opponentName} commence`}
          </p>
        </div>
      )}

      {/* HUD accroché au plateau : positionné par les variables CSS des ancrages (`HUD_ANCHORS`
          de scene/layout.ts, écrites par Board sur la racine de l'écran), dans le repère du
          canvas. */}
      {!showVictory && (
        <div className="hud-board">
          <HeroPlate
            name={opponentName}
            coins={opponent.coins}
            turnsPlayed={opponent.turnsPlayed}
            nextGain={nextTurnCoinGain(opponent)}
            active={!isMyTurn}
            side="opp"
          />
          <HeroPlate
            name={myName}
            coins={me.coins}
            turnsPlayed={me.turnsPlayed}
            nextGain={nextTurnCoinGain(me)}
            active={isMyTurn}
            side="mine"
          />

          <span className="deck-count deck-count--opp" title="Cartes restantes dans la pioche adverse">
            {opponent.deck.length}
          </span>
          <span className="deck-count deck-count--mine" title="Cartes restantes dans ta pioche">
            {me.deck.length}
          </span>

          {/* Relance du marché, sur ma pioche ; masquée pendant un glisser-déposer, où la pioche
              devient la zone de vente. */}
          {showMarketControls && !drag && (
            <button
              className="market-reroll-button"
              disabled={!canRerollMarket}
              onClick={rerollMarket}
              title={`Remplacer les cartes non verrouillées du marché pour ${MARKET_REROLL_COST} pièce — cadenas sur une carte : la garder pour le prochain marché pour ${MARKET_LOCK_COST} pièce`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={REROLL_ICON_PATH} />
              </svg>
              <span className="market-reroll-label">Relancer</span>
              <span className="market-reroll-cost">
                {MARKET_REROLL_COST}
                <span className="coin-icon coin-icon--small" aria-hidden="true" />
              </span>
            </button>
          )}

          {/* Affichage du marché, sous l'emplacement où il se range (à droite de ma pioche). */}
          {showMarketControls && (
            <button
              className="market-toggle-button"
              onClick={() => setMarketVisible((v) => !v)}
              title={marketVisible ? 'Masquer le marché' : 'Afficher le marché'}
            >
              {marketVisible ? 'Masquer le marché' : 'Afficher le marché'}
            </button>
          )}

          <div className="front-controls">
            <p className="phase-indicator">{phaseLabel(isMyTurn, playing, state.turnNumber)}</p>
            <button
              className={`end-turn ${mainButtonEnabled ? 'is-ready' : ''}`}
              disabled={!mainButtonEnabled}
              onClick={mainButtonAction}
            >
              <span>{mainButtonLabel}</span>
            </button>
          </div>

          {playing && combatView && (
            <div className="combat-banner">
              {combatBannerText(combatView.cycle, combatView.phase, combatView.stalemate, combatView.complete)}
            </div>
          )}

          {turnBanner && (
            <div className={`turn-banner ${turnBanner.seat === seat ? 'mine' : 'theirs'}`}>
              {turnBanner.seat === seat ? `À toi de jouer · +${turnBanner.coinsGained} pièce(s)` : "Tour de l'adversaire"}
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

          {state.pendingChoice && !playing ? (
            <div className="choice-banner">
              <span>{choiceHint(state, seat, pickedUid)}</span>
              {choosing && (
                <button className="hud-button" onClick={skipChoice}>
                  Renoncer
                </button>
              )}
            </div>
          ) : (
            !myMarketShown && <p className="hint">{hintText(isMyTurn, playing, state.phase, fusable, me.movesUsed)}</p>
          )}
        </div>
      )}

      {/* HUD collé aux bords de l'écran (dans les zones sûres des téléphones). */}
      {!showVictory && (
        <div className="hud-layer">
          {/* V2 : plus d'avantage élémentaire, la roue n'a plus lieu d'être. */}
          {!isV2Active() && <ElementWheel />}

          <div ref={menuRef} className="hud-menu">
            <button
              className={`hud-menu-button ${menuOpen ? 'is-open' : ''}`}
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-label="Menu de la partie"
              title="Menu de la partie"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={MENU_ICON_PATH} />
              </svg>
            </button>
            {menuOpen && (
              <div className="hud-menu-panel" role="menu">
                <button
                  className={`hud-menu-item hud-menu-room ${codeCopied ? 'is-copied' : ''}`}
                  onClick={copyRoomCode}
                  title="Copier le code de la room"
                  role="menuitem"
                >
                  <span className="hud-menu-room-label">Room</span>
                  <span className="hud-menu-room-code">{room.code}</span>
                  <span className="hud-menu-room-hint">{codeCopied ? 'Copié !' : 'Copier'}</span>
                </button>
                <button
                  className="hud-menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    setRulesOpen(true);
                  }}
                  role="menuitem"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d={RULES_ICON_PATH} />
                  </svg>
                  <span>Règles</span>
                </button>
                <button className="hud-menu-item hud-menu-item--danger" onClick={leaveGame} role="menuitem">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d={LEAVE_ICON_PATH} />
                  </svg>
                  <span>Quitter la partie</span>
                </button>
              </div>
            )}
          </div>

          {abandonCountdown !== null && (
            <div className="abandon-notice">
              {opponentName} a quitté la partie — retour au menu dans {abandonCountdown}s
            </div>
          )}
        </div>
      )}

      {zoomed && zoomImageUrl && (
        <div className="card-zoom-backdrop" onClick={() => setZoomedUid(null)}>
          <div className="card-zoom-panel" onClick={(e) => e.stopPropagation()}>
            <button className="card-zoom-close" onClick={() => setZoomedUid(null)} aria-label="Fermer">
              ×
            </button>
            <img className="card-zoom-image" src={zoomImageUrl} alt="" />
            {(zoomed.zone === 'market' || canFuseZoomed || zoomedSellable) && (
              <div className="card-zoom-actions">
                {canFuseZoomed && (
                  <button className="hud-button hud-button--gold card-zoom-sell" onClick={() => fuseZoomed(zoomed.uid)}>
                    ★ Fusionner
                  </button>
                )}
                {zoomed.zone === 'market' && (
                  <button
                    className="hud-button hud-button--gold card-zoom-sell"
                    disabled={!canBuyZoomed}
                    onClick={() => buyZoomed(zoomed.uid)}
                  >
                    Acheter ({getCardDef(zoomed.cardId).cost} pièce{getCardDef(zoomed.cardId).cost > 1 ? 's' : ''})
                  </button>
                )}
                {zoomed.zone === 'market' && (canLockZoomed || zoomedLocked) && (
                  <button className="hud-button" disabled={!canLockZoomed} onClick={() => toggleMarketLock(zoomed.uid)}>
                    {zoomedLocked ? `Déverrouiller (+${MARKET_LOCK_COST} pièce)` : `Verrouiller (${MARKET_LOCK_COST} pièce)`}
                  </button>
                )}
                {zoomedSellable && (
                  <button
                    className="hud-button hud-button--gold card-zoom-sell"
                    disabled={!canSell}
                    onClick={() => sellCard(zoomed.uid)}
                  >
                    Vendre (+{sellValue(zoomed.card, me)} pièce{sellValue(zoomed.card, me) > 1 ? 's' : ''})
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {rulesOpen && (
        <RulesModal
          v2={isV2Active()}
          onClose={() => setRulesOpen(false)}
        />
      )}

      {/* Téléphone tenu en portrait : le plateau, large, ne se joue qu'en paysage. Affiché par
          styles.css seulement (media query), pour suivre la rotation sans état React. */}
      <div className="rotate-hint" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d={ROTATE_ICON_PATH} />
        </svg>
        <p className="rotate-hint-title">Tourne ton téléphone</p>
        <p className="rotate-hint-text">La partie se joue en mode paysage.</p>
      </div>

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
