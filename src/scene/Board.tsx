import { useEffect, useRef } from 'react';
import type * as THREE from 'three';
import { getCardDef, isMonster } from '../game/cards';
import { getBaseMonsterStats, isActionLegal, opponentOf, ZONE_SIZES } from '../game/rules';
import type { CardInstance, GameState, MonsterZone, Seat, Zone } from '../game/types';
import type { ActiveCombatStep, CombatView } from '../ui/useCombatPlayback';
import { computeMonsterFaceStats } from './cardFaceStats';
import type { AttackTrigger, HaloKind } from './Card';
import Card from './Card';
import DragController, { type DropTarget } from './DragController';
import Hero from './Hero';
import {
  deckPose,
  discardPose,
  handCardPose,
  marketCardPose,
  playerTokenPose,
  slotPose,
  type Pose,
} from './layout';
import Slot from './Slot';
import { theme } from './theme';
import type { MonsterFaceStats } from './textures';

// Liste plate unique de cartes rendue dans un seul parent (D6) : une carte qui change de
// zone garde son identité React (key = uid) et vole vers sa nouvelle pose au lieu de se
// démonter/remonter.

export interface DragState {
  uid: string;
  start: { x: number; y: number };
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
  onBuy: (uid: string) => void;
  onDragStart: (uid: string, clientX: number, clientY: number) => void;
  onDragHover: (target: DropTarget | null) => void;
  onDrop: (target: DropTarget | null) => void;
  isOverFusionZone: (clientX: number, clientY: number) => boolean;
  onZoomCard: (uid: string) => void;
}

interface RenderEntry {
  uid: string;
  cardId: string;
  stats: MonsterFaceStats | null;
  ko: boolean;
  pose: Pose;
  hidden: boolean;
  mine: boolean;
  halo: HaloKind;
  hoverable: boolean;
  clickable: boolean;
  onSelect?: () => void;
  onDragStart?: (clientX: number, clientY: number) => void;
}

// Stats affichées d'une carte hors du board (main, marché, animations) : base du monstre,
// doublée s'il est doré, sans enchantements.
function unplacedStats(card: CardInstance): MonsterFaceStats | null {
  if (!isMonster(getCardDef(card.cardId))) return null;
  const golden = card.golden === true;
  const base = getBaseMonsterStats(card.cardId, golden);
  return { ...base, attackTone: 'base', defenseTone: 'base', golden };
}

function DeckPile({ pose, count, color }: { pose: Pose; count: number; color: string }) {
  const height = Math.max(0.02, count * 0.008);
  return (
    <mesh
      position={[pose.position[0], pose.position[1] + height / 2, pose.position[2]]}
      castShadow
      receiveShadow
    >
      <boxGeometry args={[1.0 * pose.scale, height, 1.4 * pose.scale]} />
      <meshStandardMaterial color={color} />
    </mesh>
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
  onBuy,
  onDragStart,
  onDragHover,
  onDrop,
  isOverFusionZone,
  onZoomCard,
}: BoardProps) {
  const opponentSeat: Seat = opponentOf(seat);
  const me = state.players[seat];
  const opponent = state.players[opponentSeat];

  const seenUidsRef = useRef<Set<string> | null>(null);
  const dragWorldRef = useRef<THREE.Vector3 | null>(null);
  const entries: RenderEntry[] = [];
  const zonePositionByUid = new Map<string, [number, number, number]>();

  // --- Ma main ---
  const canDrag = interactive && state.phase === 'main';
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
      pose: handCardPose(index, me.hand.length, true),
      hidden: false,
      mine: true,
      halo: dragged ? 'selected' : playable ? 'playable' : 'none',
      hoverable: !drag,
      clickable: false,
      onDragStart: canDrag ? (x, y) => onDragStart(card.uid, x, y) : undefined,
    });
  }

  // --- Main adverse (cachée) ---
  for (const [index, card] of opponent.hand.entries()) {
    entries.push({
      uid: card.uid,
      cardId: card.cardId,
      stats: null,
      ko: false,
      pose: handCardPose(index, opponent.hand.length, false),
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
    const buyable =
      interactive && mine && state.phase === 'market' && isActionLegal(state, seat, { type: 'buy', uid: card.uid });
    entries.push({
      uid: card.uid,
      cardId: card.cardId,
      stats: mine ? unplacedStats(card) : null,
      ko: false,
      pose: marketCardPose(index, activePlayer.market.length, mine),
      hidden: !mine,
      mine,
      halo: buyable ? 'playable' : 'none',
      hoverable: false,
      clickable: buyable,
      onSelect: () => onBuy(card.uid),
    });
  }

  // --- Cartes posées, deux joueurs, trois zones ---
  const zonesToRender: { owner: Seat; zone: Zone }[] = [
    { owner: seat, zone: 'attack' },
    { owner: seat, zone: 'defense' },
    { owner: seat, zone: 'enchant' },
    { owner: opponentSeat, zone: 'attack' },
    { owner: opponentSeat, zone: 'defense' },
    { owner: opponentSeat, zone: 'enchant' },
  ];

  for (const { owner, zone } of zonesToRender) {
    const ownerPlayer = state.players[owner];
    const mine = owner === seat;
    for (const [index, slot] of ownerPlayer.zones[zone].entries()) {
      if (!slot) continue;
      const pose = slotPose(zone, index, mine);
      zonePositionByUid.set(slot.uid, pose.position);

      const def = getCardDef(slot.cardId);
      let stats: MonsterFaceStats | null = null;
      let ko = false;
      if (isMonster(def)) {
        // `zone` est forcément 'attack' ou 'defense' ici : les règles n'autorisent un
        // monstre que sur ces deux zones (`isActionLegal`).
        const computed = computeMonsterFaceStats(ownerPlayer, slot, zone as MonsterZone, combatView);
        stats = computed.stats;
        ko = computed.ko;
      }

      entries.push({
        uid: slot.uid,
        cardId: slot.cardId,
        stats,
        ko,
        pose,
        hidden: false,
        mine,
        halo: 'none',
        hoverable: false,
        // Une carte posée (la mienne ou celle de l'adversaire) s'ouvre en grand au clic ; le
        // bouton Vendre n'apparaît que pour la mienne (géré dans GameScreen).
        clickable: true,
        onSelect: () => onZoomCard(slot.uid),
      });
    }
  }

  // --- Retours au deck : invendus qui volent vers la pile (§6.5) ---
  if (state.lastEvent?.type === 'marketEnd') {
    const owner = state.lastEvent.seat;
    const ownerPlayer = state.players[owner];
    const mine = owner === seat;
    for (const uid of state.lastEvent.returnedUids) {
      const card = ownerPlayer.deck.find((c) => c.uid === uid);
      if (!card) continue;
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

  // --- Carte vendue qui vole vers la défausse ---
  if (state.lastEvent?.type === 'sell') {
    const owner = state.lastEvent.seat;
    const ownerPlayer = state.players[owner];
    const mine = owner === seat;
    const uid = state.lastEvent.uid;
    const card = ownerPlayer.discard.find((c) => c.uid === uid);
    if (card) {
      entries.push({
        uid: card.uid,
        cardId: card.cardId,
        stats: null,
        ko: false,
        pose: discardPose(mine),
        hidden: true,
        mine,
        halo: 'none',
        hoverable: false,
        clickable: false,
      });
    }
  }

  // --- Fusion dorée : les 2 exemplaires absorbés quittent le board et se fondent dans la
  // carte devenue dorée, dans la main (ils sont déjà en défausse dans l'état) ---
  if (state.lastEvent?.type === 'fuse') {
    const { seat: owner, uid: goldenUid, fusedUids } = state.lastEvent;
    const ownerPlayer = state.players[owner];
    const mine = owner === seat;
    const handIndex = ownerPlayer.hand.findIndex((c) => c.uid === goldenUid);
    if (handIndex !== -1) {
      const goldenPose = handCardPose(handIndex, ownerPlayer.hand.length, mine);
      for (const uid of fusedUids) {
        const card = ownerPlayer.discard.find((c) => c.uid === uid);
        if (!card) continue;
        entries.push({
          uid: card.uid,
          cardId: card.cardId,
          stats: unplacedStats(card),
          ko: false,
          pose: { ...goldenPose, scale: goldenPose.scale * 0.05 },
          hidden: false,
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

  const isLegalSlot = (zone: Zone, slot: number) =>
    drag !== null && isActionLegal(state, seat, { type: 'place', uid: drag.uid, zone, slot });

  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[3, 8, 4]} intensity={1.1} castShadow />

      <mesh position={[0, -0.06, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[14, 12]} />
        <meshStandardMaterial color={theme.colors.tableTop} />
      </mesh>

      {zonesToRender.map(({ owner, zone }) => {
        const mine = owner === seat;
        const size = ZONE_SIZES[zone];
        return Array.from({ length: size }, (_, index) => {
          const legal = mine && interactive && isLegalSlot(zone, index);
          const hovered =
            legal && dropTarget?.kind === 'slot' && dropTarget.zone === zone && dropTarget.slot === index;
          return (
            <Slot
              key={`${owner}-${zone}-${index}`}
              pose={slotPose(zone, index, mine)}
              zone={zone}
              highlighted={legal}
              hovered={hovered}
            />
          );
        });
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

      <DeckPile pose={deckPose(true)} count={me.deck.length} color={theme.colors.cardBack} />
      <DeckPile pose={deckPose(false)} count={opponent.deck.length} color={theme.colors.cardBack} />
      <DeckPile pose={discardPose(true)} count={me.discard.length} color={theme.colors.discardPile} />
      <DeckPile pose={discardPose(false)} count={opponent.discard.length} color={theme.colors.discardPile} />

      {entries.map((entry) => (
        <Card
          key={entry.uid}
          cardId={entry.cardId}
          stats={entry.stats}
          ko={entry.ko}
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
        />
      ))}

      {drag && (
        <DragController
          key={drag.uid}
          start={drag.start}
          dragWorldRef={dragWorldRef}
          isLegalSlot={isLegalSlot}
          isOverFusionZone={isOverFusionZone}
          onHover={onDragHover}
          onDrop={onDrop}
        />
      )}
    </>
  );
}

export default Board;
