import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { getCardDef, hasKeywordDef, isMonster, isV2Active } from '../game/cards';
import {
  canMoveInZone,
  isActionLegal,
  isMarketCardLocked,
  opponentOf,
  zoneCapacity,
  zoneCards,
} from '../game/rules';
import type { CardInstance, EffectLog, GameState, MonsterZone, Seat, Zone } from '../game/types';
import type { ActiveCombatStep, CombatView } from '../ui/useCombatPlayback';
import { computeMonsterFaceStats, enchantmentFaceStats, unplacedStats } from './cardFaceStats';
import type { AttackTrigger, HaloKind, LockBadge } from './Card';
import Card from './Card';
import DragController, { type DropTarget } from './DragController';
import AbilityPulses, { type AbilityTrigger } from './AbilityPulse';
import EffectiveBursts, { type EffectiveHit } from './EffectiveBurst';
import Hero from './Hero';
import {
  computeView,
  deckPileHeight,
  deckPose,
  deckTopY,
  fusionZoneRect,
  handCardPose,
  HUD_ANCHORS,
  marketCardPose,
  marketTablePose,
  playerTokenPose,
  rowBounds,
  rowCardPose,
  sellZoneRect,
  type Pose,
  type TableRect,
} from './layout';
import Table from './Table';
import ZoneRow from './ZoneRow';
import { theme } from './theme';
import { getCardBackTexture, type MonsterFaceStats } from './textures';

// Liste plate unique de cartes rendue dans un seul parent (D6) : une carte qui change de
// zone garde son identité React (key = uid) et vole vers sa nouvelle pose au lieu de se
// démonter/remonter.

export interface DragState {
  uid: string;
  start: { x: number; y: number };
  // Présent quand on saisit une carte déjà posée pour la déplacer dans sa zone plutôt qu'une
  // carte de la main pour la poser.
  origin?: { zone: MonsterZone; slot: number };
}

interface BoardProps {
  state: GameState;
  seat: Seat;
  interactive: boolean; // mon tour, aucun combat en lecture, pas de gagnant
  drag: DragState | null; // carte de ma main en cours de glisser-déposer
  dropTarget: DropTarget | null;
  combatView: CombatView | null; // surcharges d'affichage pendant la lecture (§7)
  activeStep: ActiveCombatStep | null; // coup en cours de fente (§7)
  displayedHp: Record<Seat, number>; // PV affichés pendant la lecture (§7.3)
  marketVisible: boolean; // le marché du joueur actif peut être masqué à sa demande (bouton HUD)
  // Rectangle écran (mis à jour à chaque frame) englobant mon marché affiché, lu par
  // GameScreen pour fermer le marché au clic en dehors (demande utilisateur).
  marketZoneRectRef: RefObject<ScreenRect | null>;
  // Zones de dépôt HTML de GameScreen, placées à l'écran sur leur rectangle de table.
  fusionZoneRef: RefObject<HTMLDivElement | null>;
  sellZoneRef: RefObject<HTMLDivElement | null>;
  // Élément qui reçoit les variables CSS des ancrages du HUD (`HUD_ANCHORS`), en px relatifs
  // à son coin haut-gauche.
  hudAnchorRef: RefObject<HTMLElement | null>;
  // Clic sur mon marché rangé sur la table (masqué) : le rouvre.
  onShowMarket: () => void;
  onBuy: (uid: string) => void;
  // Clic sur le cadenas d'une carte de MON marché : verrouille ou déverrouille (demande
  // utilisateur, action `toggleMarketLock`).
  onToggleMarketLock: (uid: string) => void;
  // `origin` n'est présent que lorsqu'on saisit une carte déjà posée (pour la déplacer dans
  // sa zone), pas une carte de la main (pour la poser).
  onDragStart: (
    uid: string,
    clientX: number,
    clientY: number,
    origin?: { zone: MonsterZone; slot: number },
  ) => void;
  onDragHover: (target: DropTarget | null) => void;
  onDrop: (target: DropTarget | null) => void;
  isOverFusionZone: (clientX: number, clientY: number) => boolean;
  isOverSellZone: (clientX: number, clientY: number) => boolean;
  onZoomCard: (uid: string) => void;
  // V2 : choix de cible en cours (effet « monstre choisi ») — les cartes posées de `uids`
  // s'allument et un clic sur l'une d'elles la désigne ; les autres ne réagissent plus.
  targeting: { uids: Set<string>; onPick: (uid: string) => void } | null;
}

export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

// Marge autour des cartes du marché pour définir « la zone du marché » au clic-extérieur
// (demande utilisateur) : assez large pour ne pas fermer le marché en cliquant juste à côté
// d'une carte, sans couvrir tout l'écran.
const MARKET_ZONE_PADDING_PX = 48;

// Recalcule à chaque frame le rectangle écran englobant mon marché affiché (`count` cartes,
// pose définie par `marketCardPose`), écrit dans `rectRef` (pas de state React : lu au clic,
// jamais affiché). Composant sans rendu, monté seulement le temps où le marché existe.
function MarketZoneTracker({ count, rectRef }: { count: number; rectRef: RefObject<ScreenRect | null> }) {
  const { camera, gl } = useThree();
  const corner = useRef(new THREE.Vector3());

  useFrame(() => {
    if (count === 0) {
      rectRef.current = null;
      return;
    }
    const canvasRect = gl.domElement.getBoundingClientRect();
    const view = computeView(canvasRect.width, canvasRect.height);
    const scale = marketCardPose(0, count, true, view).scale;
    const halfW = (theme.card.width * scale) / 2;
    const halfH = (theme.card.height * scale) / 2;
    const rotationX = marketCardPose(0, count, true, view).rotation[0];
    const cos = Math.cos(rotationX);
    const sin = Math.sin(rotationX);

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (let index = 0; index < count; index++) {
      const [px, py, pz] = marketCardPose(index, count, true, view).position;
      for (const dx of [-halfW, halfW]) {
        for (const dy of [-halfH, halfH]) {
          corner.current.set(px + dx, py + dy * cos, pz + dy * sin);
          corner.current.project(camera);
          const screenX = canvasRect.left + ((corner.current.x + 1) / 2) * canvasRect.width;
          const screenY = canvasRect.top + ((1 - corner.current.y) / 2) * canvasRect.height;
          minX = Math.min(minX, screenX);
          maxX = Math.max(maxX, screenX);
          minY = Math.min(minY, screenY);
          maxY = Math.max(maxY, screenY);
        }
      }
    }

    rectRef.current = {
      left: minX - MARKET_ZONE_PADDING_PX,
      top: minY - MARKET_ZONE_PADDING_PX,
      right: maxX + MARKET_ZONE_PADDING_PX,
      bottom: maxY + MARKET_ZONE_PADDING_PX,
    };
  });

  return null;
}

// Zones de dépôt HTML (fusion sur le board adverse, vente sur mon deck) : leur rectangle de
// table est projeté à l'écran à chaque frame, puisque le cadrage suit la taille du canvas.
// L'élément est centré sur son point d'ancrage (`translate(-50%, -50%)` dans styles.css).
function TableAnchor({
  elementRef,
  rect,
}: {
  elementRef: RefObject<HTMLDivElement | null>;
  rect: { x: number; z: number; halfW: number; halfD: number };
}) {
  const { camera, gl } = useThree();
  const corner = useRef(new THREE.Vector3());

  useFrame(() => {
    const element = elementRef.current;
    if (!element) return;
    const canvasRect = gl.domElement.getBoundingClientRect();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const dx of [-rect.halfW, rect.halfW]) {
      for (const dz of [-rect.halfD, rect.halfD]) {
        corner.current.set(rect.x + dx, 0, rect.z + dz).project(camera);
        const x = ((corner.current.x + 1) / 2) * canvasRect.width;
        const y = ((1 - corner.current.y) / 2) * canvasRect.height;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
    element.style.left = `${(minX + maxX) / 2}px`;
    element.style.top = `${(minY + maxY) / 2}px`;
    element.style.width = `${maxX - minX}px`;
    element.style.height = `${maxY - minY}px`;
  });

  return null;
}

// Projette à chaque frame les rectangles de `HUD_ANCHORS` et les écrit en variables CSS
// (`--<nom>-x`, `--<nom>-y` : centre ; `--<nom>-w`, `--<nom>-h` : taille, en px) sur
// `targetRef`, relativement à son coin haut-gauche. Le HUD se positionne avec ces variables
// et suit ainsi le plateau quand le cadrage change. Une variable n'est réécrite que si sa
// valeur change, pour ne pas relancer le style à chaque frame. `heights` relève certains
// rectangles au-dessus de la table (le dessus des pioches, dont l'épaisseur suit le nombre de
// cartes).
function HudAnchors({
  targetRef,
  heights,
}: {
  targetRef: RefObject<HTMLElement | null>;
  heights: Record<string, number>;
}) {
  const { camera, gl } = useThree();
  const corner = useRef(new THREE.Vector3());
  const written = useRef(new Map<string, string>());

  useFrame(() => {
    const target = targetRef.current;
    if (!target) return;
    const canvasRect = gl.domElement.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const project = (rect: TableRect, height: number) => {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const dx of [-rect.halfW, rect.halfW]) {
        for (const dz of [-rect.halfD, rect.halfD]) {
          corner.current.set(rect.x + dx, height, rect.z + dz).project(camera);
          const x = canvasRect.left - targetRect.left + ((corner.current.x + 1) / 2) * canvasRect.width;
          const y = canvasRect.top - targetRect.top + ((1 - corner.current.y) / 2) * canvasRect.height;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
      return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY };
    };
    for (const [name, rect] of Object.entries(HUD_ANCHORS)) {
      const projected = project(rect, heights[name] ?? rect.y ?? 0);
      for (const key of ['x', 'y', 'w', 'h'] as const) {
        const property = `--${name}-${key}`;
        const value = `${Math.round(projected[key])}px`;
        if (written.current.get(property) === value) continue;
        written.current.set(property, value);
        target.style.setProperty(property, value);
      }
    }
  });

  return null;
}

interface RenderEntry {
  uid: string;
  cardId: string;
  stats: MonsterFaceStats | null;
  ko: boolean;
  tauntShield?: boolean; // K2 Provocation : bouclier affiché tant que le monstre est debout
  frozen?: boolean; // V2 : monstre gelé, couché à l'horizontale
  protectionBubble?: boolean; // K3 Protection encore intacte : bulle autour de la carte
  lockBadge?: LockBadge; // cadenas cliquable, uniquement sur les cartes de MON marché
  pose: Pose;
  hidden: boolean;
  mine: boolean;
  halo: HaloKind;
  hoverable: boolean;
  clickable: boolean;
  onSelect?: () => void;
  onDragStart?: (clientX: number, clientY: number) => void;
  onInspect?: () => void; // zoom au doigt (appui long, ou tap sur une carte de la main)
}

// Pioche : une pile dont l'épaisseur suit le nombre de cartes, coiffée d'un dos de carte.
function DeckPile({ pose, count }: { pose: Pose; count: number }) {
  const backTexture = useMemo(() => getCardBackTexture(), []);
  const height = deckPileHeight(count);
  const w = theme.card.width * pose.scale;
  const d = theme.card.height * pose.scale;
  return (
    <group position={[pose.position[0], pose.position[1], pose.position[2]]}>
      <mesh position={[0, height / 2, 0]}>
        <boxGeometry args={[w * 0.98, height, d * 0.98]} />
        <meshStandardMaterial color={theme.colors.deckEdge} roughness={0.9} />
      </mesh>
      {count > 0 && (
        <mesh position={[0, height + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[w, d]} />
          <meshStandardMaterial map={backTexture} alphaTest={0.5} />
        </mesh>
      )}
    </group>
  );
}

function Board({
  state,
  seat,
  interactive,
  drag,
  dropTarget,
  combatView,
  activeStep,
  displayedHp,
  marketVisible,
  marketZoneRectRef,
  fusionZoneRef,
  sellZoneRef,
  hudAnchorRef,
  onShowMarket,
  onBuy,
  onToggleMarketLock,
  onDragStart,
  onDragHover,
  onDrop,
  isOverFusionZone,
  isOverSellZone,
  onZoomCard,
  targeting,
}: BoardProps) {
  const opponentSeat: Seat = opponentOf(seat);
  const view = computeView(
    useThree((s) => s.size.width),
    useThree((s) => s.size.height),
  );
  const me = state.players[seat];
  const opponent = state.players[opponentSeat];

  const seenUidsRef = useRef<Set<string> | null>(null);
  const dragWorldRef = useRef<THREE.Vector3 | null>(null);
  const entries: RenderEntry[] = [];
  const zonePositionByUid = new Map<string, [number, number, number]>();
  const zoneCardIdByUid = new Map<string, string>();

  // --- Ma main ---
  const canDrag = interactive && state.phase === 'main' && !targeting;
  for (const [index, card] of me.hand.entries()) {
    const def = getCardDef(card.cardId);
    const hasLegalSlot = isMonster(def)
      ? me.zones.attack.some((s) => s === null) || me.zones.defense.some((s) => s === null)
      : me.zones.enchant.some((s) => s === null);
    const fusable = isActionLegal(state, seat, { type: 'fuse', uid: card.uid });
    const playable = canDrag && (hasLegalSlot || fusable);
    const dragged = card.uid === drag?.uid;
    entries.push({
      uid: card.uid,
      cardId: card.cardId,
      stats: unplacedStats(card),
      ko: false,
      pose: handCardPose(index, me.hand.length, true, view),
      hidden: false,
      mine: true,
      halo: dragged ? 'selected' : playable ? 'playable' : 'none',
      hoverable: !drag,
      clickable: false,
      onDragStart: canDrag ? (x, y) => onDragStart(card.uid, x, y) : undefined,
      onInspect: () => onZoomCard(card.uid),
    });
  }

  // --- Main adverse (cachée) ---
  for (const [index, card] of opponent.hand.entries()) {
    entries.push({
      uid: card.uid,
      cardId: card.cardId,
      stats: null,
      ko: false,
      pose: handCardPose(index, opponent.hand.length, false, view),
      hidden: true,
      mine: false,
      halo: 'none',
      hoverable: false,
      clickable: false,
    });
  }

  // --- Marché du joueur actif : face visible pour lui seul, face cachée chez l'adversaire
  // (demande utilisateur, remplace H4 qui le montrait aux deux joueurs) ---
  const activePlayer = state.players[state.turn];
  for (const [index, card] of activePlayer.market.entries()) {
    const mine = state.turn === seat;
    // Demande utilisateur : je peux masquer mon propre marché (bouton HUD) sans que ça
    // affecte l'affichage (toujours face cachée) chez l'adversaire. Masqué, il se range
    // couché à droite de ma pioche, face visible, comme celui de l'adversaire chez lui ; un
    // clic sur l'une de ses cartes le rouvre.
    if (mine && !marketVisible) {
      const reopenable = interactive && state.phase === 'main';
      entries.push({
        uid: card.uid,
        cardId: card.cardId,
        stats: unplacedStats(card),
        ko: false,
        pose: marketTablePose(index, activePlayer.market.length, true),
        hidden: false,
        mine,
        halo: 'none',
        hoverable: false,
        clickable: reopenable,
        onSelect: reopenable ? onShowMarket : undefined,
      });
      continue;
    }
    const buyable =
      interactive && mine && state.phase === 'main' && isActionLegal(state, seat, { type: 'buy', uid: card.uid });
    // Cadenas (demande utilisateur) : sur mes cartes seulement, et uniquement quand l'action
    // est jouable — déjà verrouillée, il reste affiché pour pouvoir la libérer.
    const locked = isMarketCardLocked(activePlayer, card.uid);
    const lockable =
      interactive && mine && isActionLegal(state, seat, { type: 'toggleMarketLock', uid: card.uid });
    entries.push({
      uid: card.uid,
      cardId: card.cardId,
      stats: mine ? unplacedStats(card) : null,
      ko: false,
      lockBadge: lockable ? { locked, onToggle: () => onToggleMarketLock(card.uid) } : undefined,
      pose: marketCardPose(index, activePlayer.market.length, mine, view),
      hidden: !mine,
      mine,
      halo: buyable ? 'playable' : 'none',
      hoverable: false,
      clickable: buyable,
      onSelect: () => onBuy(card.uid),
      // Au doigt, pas de survol pour lire une carte avant de l'acheter : appui long = zoom.
      onInspect: mine ? () => onZoomCard(card.uid) : undefined,
    });
  }

  // Tant que mon marché est affiché, les cartes posées ne réagissent plus au clic ni au
  // glisser (demande utilisateur) : sinon un clic sur une carte du marché atteignait la
  // carte du board située derrière et l'ouvrait en zoom.
  const myMarketOpen = state.turn === seat && marketVisible && me.market.length > 0;

  // --- Cartes posées, deux joueurs, trois zones ---
  const zonesToRender: { owner: Seat; zone: Zone }[] = [
    { owner: seat, zone: 'attack' },
    { owner: seat, zone: 'defense' },
    { owner: seat, zone: 'enchant' },
    { owner: opponentSeat, zone: 'attack' },
    { owner: opponentSeat, zone: 'defense' },
    { owner: opponentSeat, zone: 'enchant' },
  ];

  // Rangée compacte (demande utilisateur) : pendant un glisser-déposer, la carte tenue quitte
  // la rangée qu'elle réorganise, et la position d'insertion survolée s'ouvre entre deux
  // cartes pour lui faire place — les voisines s'écartent avant même le dépôt.
  const insertion = dropTarget?.kind === 'slot' ? dropTarget : null;
  // Cartes de ma rangée entre lesquelles la carte tenue peut s'insérer.
  // Cartes d'une zone telles qu'affichées : en V2, pendant la lecture d'un combat, le board du
  // coup en cours (armure entamée, créatures invoquées, monstres déplacés) ; sinon l'état.
  const displayedCards = (owner: Seat, zone: Zone): CardInstance[] =>
    combatView?.board && zone !== 'enchant' ? combatView.board[owner][zone] : zoneCards(state.players[owner], zone);
  const rowOthers = (zone: Zone): CardInstance[] => {
    const cards = zoneCards(me, zone);
    return drag?.origin?.zone === zone ? cards.filter((c) => c.uid !== drag.uid) : cards;
  };
  const rowCount = (zone: Zone) => rowOthers(zone).length;
  // Pose d'une carte posée, d'index `index` dans sa rangée, en tenant compte de l'insertion.
  const placedPose = (owner: Seat, zone: Zone, card: CardInstance, index: number): Pose => {
    const mine = owner === seat;
    const cards = displayedCards(owner, zone);
    if (!mine || insertion?.zone !== zone) return rowCardPose(zone, index, cards.length, mine);
    const others = rowOthers(zone);
    const count = others.length + 1;
    if (card.uid === drag?.uid) return rowCardPose(zone, insertion.slot, count, true);
    const i = others.findIndex((c) => c.uid === card.uid);
    return rowCardPose(zone, i < insertion.slot ? i : i + 1, count, true);
  };

  for (const { owner, zone } of zonesToRender) {
    const ownerPlayer = state.players[owner];
    const mine = owner === seat;
    for (const [index, slot] of displayedCards(owner, zone).entries()) {
      const pose = placedPose(owner, zone, slot, index);
      zonePositionByUid.set(slot.uid, pose.position);
      zoneCardIdByUid.set(slot.uid, slot.cardId);

      const def = getCardDef(slot.cardId);
      let stats: MonsterFaceStats | null = enchantmentFaceStats(slot);
      let ko = false;
      if (isMonster(def)) {
        // `zone` est forcément 'attack' ou 'defense' ici : les règles n'autorisent un
        // monstre que sur ces deux zones (`isActionLegal`).
        const computed = computeMonsterFaceStats(ownerPlayer, slot, zone as MonsterZone, combatView);
        stats = computed.stats;
        ko = computed.ko;
      }

      // Une carte déjà posée peut être déplacée à la souris ailleurs dans la rangée de SA zone
      // pendant la phase principale (demande utilisateur) : uniquement la mienne,
      // uniquement en attaque/défense (pas les enchantements), et seulement si le
      // déplacement de cette zone n'a pas déjà été utilisé ce tour-ci — sinon la carte se
      // soulèverait pour rien, aucun emplacement ne s'allumant.
      const movable =
        mine &&
        canDrag &&
        !myMarketOpen &&
        (zone === 'attack' || zone === 'defense') &&
        canMoveInZone(ownerPlayer, zone as MonsterZone) &&
        slot.rootedBy === undefined; // V2 : enraciné (état), il ne bouge pas
      const dragged = slot.uid === drag?.uid;

      // K2 Provocation : le bouclier dit « frappez-moi d'abord », donc il reste tant que le
      // monstre tient debout.
      // V2 : Provocation n'agit qu'en défense, son bouclier ne s'y montre donc que là.
      const tauntShield = hasKeywordDef(def, 'taunt') && !ko && (!isV2Active() || zone === 'defense');
      // K3 Protection : la bulle tient tant que la protection n'a pas servi. Elle se recharge
      // à chaque combat, donc hors combat elle est toujours intacte ; pendant la lecture,
      // `protectionSpent` la fait éclater au coup exact qui l'a consommée.
      // V2 : une protection reçue par effet (`shields`, à usage unique) garde aussi sa bulle.
      const protectionBubble =
        !ko &&
        ((hasKeywordDef(def, 'protection') && !(combatView?.protectionSpent.has(slot.uid) ?? false)) ||
          (slot.shields ?? 0) > 0);
      const target = targeting?.uids.has(slot.uid) ?? false;

      entries.push({
        uid: slot.uid,
        cardId: slot.cardId,
        stats,
        ko,
        tauntShield,
        protectionBubble,
        frozen: slot.frozen === true,
        pose,
        hidden: false,
        mine,
        halo: dragged ? 'selected' : target ? 'target' : 'none',
        hoverable: false,
        // Une carte posée (la mienne ou celle de l'adversaire) s'ouvre en grand au clic ; le
        // bouton Vendre n'apparaît que pour la mienne (géré dans GameScreen). Pendant un choix
        // de cible (V2), seul un clic sur une cible compte.
        clickable: targeting ? target : !myMarketOpen,
        onSelect: targeting ? () => targeting.onPick(slot.uid) : () => onZoomCard(slot.uid),
        onInspect: targeting || myMarketOpen ? undefined : () => onZoomCard(slot.uid),
        onDragStart: movable
          ? (x, y) => onDragStart(slot.uid, x, y, { zone: zone as MonsterZone, slot: index })
          : undefined,
      });
    }
  }

  // --- Carte vendue qui vole vers le deck (elle est au fond du deck dans l'état) ---
  if (state.lastEvent?.type === 'sell') {
    const owner = state.lastEvent.seat;
    const ownerPlayer = state.players[owner];
    const mine = owner === seat;
    const uid = state.lastEvent.uid;
    const card = ownerPlayer.deck.find((c) => c.uid === uid);
    if (card) {
      entries.push({
        uid: card.uid,
        cardId: card.cardId,
        stats: null,
        ko: false,
        pose: deckPose(mine),
        hidden: true,
        mine,
        halo: 'none',
        hoverable: false,
        clickable: false,
      });
    }
  }

  // --- Fusion dorée : les 2 exemplaires absorbés quittent le board ou la main et se fondent
  // dans la carte devenue dorée, dans la main (ils sont déjà au fond du deck dans l'état).
  // Face cachée chez l'adversaire : un exemplaire venu de sa main ne doit pas être révélé ---
  if (state.lastEvent?.type === 'fuse') {
    const { seat: owner, uid: goldenUid, fusedUids } = state.lastEvent;
    const ownerPlayer = state.players[owner];
    const mine = owner === seat;
    const handIndex = ownerPlayer.hand.findIndex((c) => c.uid === goldenUid);
    if (handIndex !== -1) {
      const goldenPose = handCardPose(handIndex, ownerPlayer.hand.length, mine, view);
      for (const uid of fusedUids) {
        const card = ownerPlayer.deck.find((c) => c.uid === uid);
        if (!card) continue;
        entries.push({
          uid: card.uid,
          cardId: card.cardId,
          stats: unplacedStats(card),
          ko: false,
          pose: { ...goldenPose, scale: goldenPose.scale * 0.05 },
          hidden: !mine,
          mine,
          halo: 'none',
          hoverable: false,
          clickable: false,
        });
      }
    }
  }

  // Apparition depuis le deck (D6) : une carte inconnue au rendu précédent démarre sur le
  // deck de son propriétaire, face cachée.
  const currentUids = new Set(entries.map((e) => e.uid));
  const isFirstRender = seenUidsRef.current === null;
  const spawnPoseFor = (uid: string, mine: boolean): Pose | undefined => {
    if (isFirstRender || seenUidsRef.current!.has(uid)) return undefined;
    return deckPose(mine);
  };

  useEffect(() => {
    seenUidsRef.current = currentUids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  // Fente d'attaque : la cible se lit dans l'état (le plateau ne change pas pendant un
  // combat, T4) — un monstre via sa position de zone déjà calculée, un joueur via son jeton.
  let attackTrigger: { attackerUid: string; trigger: AttackTrigger } | null = null;
  if (activeStep) {
    const defenderSeat = opponentOf(activeStep.attackerSeat);
    const targetPosition: [number, number, number] =
      activeStep.target.kind === 'player'
        ? playerTokenPose(defenderSeat === seat).position
        : (zonePositionByUid.get(activeStep.target.uid) ?? [0, 0, 0]);
    attackTrigger = {
      attackerUid: activeStep.attackerUid,
      trigger: { id: activeStep.key, targetPosition },
    };
  }

  // Animation « Efficace ! » (éléments) au-dessus de chaque monstre qui encaisse, pendant le
  // coup en cours, un dégât augmenté par l'avantage élémentaire de celui qui le frappe.
  const effectiveHits: EffectiveHit[] = [];
  if (activeStep && activeStep.target.kind === 'monster') {
    const hits: { boosted: boolean; receiverUid: string; dealerUid: string }[] = [
      { boosted: activeStep.effective, receiverUid: activeStep.target.uid, dealerUid: activeStep.attackerUid },
      { boosted: activeStep.retaliationEffective, receiverUid: activeStep.attackerUid, dealerUid: activeStep.target.uid },
    ];
    for (const { boosted, receiverUid, dealerUid } of hits) {
      const position = zonePositionByUid.get(receiverUid);
      const dealerCardId = zoneCardIdByUid.get(dealerUid);
      if (!boosted || !position || !dealerCardId) continue;
      effectiveHits.push({
        id: `${activeStep.key}-${receiverUid}`,
        position,
        element: getCardDef(dealerCardId).element,
      });
    }
  }

  // Effet visuel sur la carte source de chaque capacité déclenchée : à la pose (évènement
  // `place`) et au fil de la lecture du combat. Une carte vendue a déjà quitté le board, son
  // effet n'est signalé que par le toast du HUD.
  const abilityTriggers: AbilityTrigger[] = [];
  const pushAbilityTriggers = (prefix: string, effects: EffectLog[]) => {
    effects.forEach((effect, index) => {
      const position = zonePositionByUid.get(effect.sourceUid);
      if (!position) return;
      abilityTriggers.push({ id: `${prefix}-${index}`, position, element: getCardDef(effect.cardId).element });
    });
  };
  const lastEvent = state.lastEvent;
  if (lastEvent?.type === 'place') pushAbilityTriggers(`place-${lastEvent.id}`, lastEvent.effects);
  if (lastEvent?.type === 'combat' && combatView) {
    pushAbilityTriggers(`combat-${lastEvent.id}`, combatView.appliedEffects);
  }

  const isLegalSlot = (zone: Zone, slot: number) => {
    if (drag === null) return false;
    if (drag.origin) {
      // Dans sa zone, ou (V2, Vol) dans l'autre zone de monstres.
      if (zone === drag.origin.zone) return isActionLegal(state, seat, { type: 'move', uid: drag.uid, slot });
      return zone !== 'enchant' && isActionLegal(state, seat, { type: 'move', uid: drag.uid, slot, zone });
    }
    return isActionLegal(state, seat, { type: 'place', uid: drag.uid, zone, slot });
  };
  // La carte tenue peut s'insérer quelque part dans cette rangée.
  const isLegalRow = (zone: Zone) =>
    Array.from({ length: rowCount(zone) + 1 }, (_, slot) => slot).some((slot) => isLegalSlot(zone, slot));

  // Le marché ouvert affiche des cartes face cachée chez l'adversaire et un fond plus sombre
  // aide à les distinguer sans éblouir ; une fois masqué (bouton HUD), rien ne justifie de
  // garder la table sombre donc on l'éclaircit pour une meilleure lisibilité générale.
  const brightTable = !marketVisible;
  const ambientIntensity = brightTable ? 1.0 : 0.6;
  const keyLightIntensity = brightTable ? 1.7 : 1.15;

  return (
    <>
      <MarketZoneTracker count={state.turn === seat ? me.market.length : 0} rectRef={marketZoneRectRef} />
      <TableAnchor elementRef={fusionZoneRef} rect={fusionZoneRect()} />
      <TableAnchor elementRef={sellZoneRef} rect={sellZoneRect()} />
      <HudAnchors
        targetRef={hudAnchorRef}
        heights={{ 'my-deck': deckTopY(me.deck.length), 'opp-deck': deckTopY(opponent.deck.length) }}
      />

      {/* Lumière chaude de lampe de taverne, plus un contre-jour froid pour détacher les cartes. */}
      <ambientLight intensity={ambientIntensity} color={theme.colors.lampAmbient} />
      <hemisphereLight args={[theme.colors.lampKey, theme.colors.void, brightTable ? 0.55 : 0.3]} />
      <directionalLight
        position={[2.5, 9, 4]}
        intensity={keyLightIntensity}
        color={theme.colors.lampKey}
      />
      <directionalLight position={[-4, 5, -4]} intensity={brightTable ? 0.45 : 0.25} color={theme.colors.rimLight} />

      <Table bright={brightTable} />

      {zonesToRender.map(({ owner, zone }) => {
        const mine = owner === seat;
        const row = rowBounds(zone, zoneCapacity(state.players[owner], zone), mine);
        const hovered = mine && interactive && insertion?.zone === zone;
        return (
          <ZoneRow
            key={`${owner}-${zone}`}
            center={[row.x, row.z]}
            halfW={row.halfW}
            zone={zone}
            highlighted={mine && interactive && isLegalRow(zone)}
            ghostX={hovered ? rowCardPose(zone, insertion.slot, rowCount(zone) + 1, true).position[0] : null}
            bright={brightTable}
          />
        );
      })}

      <Hero
        pose={playerTokenPose(true)}
        mine
        hp={displayedHp[seat]}
        clickable={false}
        onSelect={undefined}
      />
      <Hero
        pose={playerTokenPose(false)}
        mine={false}
        hp={displayedHp[opponentSeat]}
        clickable={false}
        onSelect={undefined}
      />

      <DeckPile pose={deckPose(true)} count={me.deck.length} />
      <DeckPile pose={deckPose(false)} count={opponent.deck.length} />

      {entries.map((entry) => (
        <Card
          key={entry.uid}
          cardId={entry.cardId}
          stats={entry.stats}
          ko={entry.ko}
          tauntShield={entry.tauntShield}
          protectionBubble={entry.protectionBubble}
          frozen={entry.frozen}
          lockBadge={entry.lockBadge}
          pose={entry.pose}
          spawnPose={spawnPoseFor(entry.uid, entry.mine)}
          hidden={entry.hidden}
          halo={entry.halo}
          hoverable={entry.hoverable}
          clickable={entry.clickable}
          attackTrigger={attackTrigger?.attackerUid === entry.uid ? attackTrigger.trigger : null}
          dragWorldRef={entry.uid === drag?.uid ? dragWorldRef : undefined}
          onSelect={entry.onSelect}
          onDragStart={entry.onDragStart}
          onInspect={entry.onInspect}
        />
      ))}

      <EffectiveBursts hits={effectiveHits} />
      <AbilityPulses triggers={abilityTriggers} />

      {drag && (
        <DragController
          key={drag.uid}
          start={drag.start}
          dragWorldRef={dragWorldRef}
          isLegalSlot={isLegalSlot}
          rowCount={rowCount}
          capacity={(zone) => zoneCapacity(me, zone)}
          isOverFusionZone={isOverFusionZone}
          isOverSellZone={isOverSellZone}
          onHover={onDragHover}
          onDrop={onDrop}
        />
      )}
    </>
  );
}

export default Board;
