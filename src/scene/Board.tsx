import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { getCardDef, isMonster } from '../game/cards';
import { getBaseMonsterStats, isActionLegal, opponentOf, ZONE_SIZES } from '../game/rules';
import type { CardInstance, EffectLog, GameState, MonsterZone, Seat, Zone } from '../game/types';
import type { ActiveCombatStep, CombatView } from '../ui/useCombatPlayback';
import { computeMonsterFaceStats } from './cardFaceStats';
import type { AttackTrigger, HaloKind } from './Card';
import Card from './Card';
import DragController, { type DropTarget } from './DragController';
import AbilityPulses, { type AbilityTrigger } from './AbilityPulse';
import EffectiveBursts, { type EffectiveHit } from './EffectiveBurst';
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
  onBuy: (uid: string) => void;
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
  onZoomCard: (uid: string) => void;
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
    const aspect = canvasRect.width / Math.max(1, canvasRect.height);
    const scale = marketCardPose(0, count, true, aspect).scale;
    const halfW = (theme.card.width * scale) / 2;
    const halfH = (theme.card.height * scale) / 2;
    const rotationX = marketCardPose(0, count, true, aspect).rotation[0];
    const cos = Math.cos(rotationX);
    const sin = Math.sin(rotationX);

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (let index = 0; index < count; index++) {
      const [px, py, pz] = marketCardPose(index, count, true, aspect).position;
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
// doublée s'il est doré, plus le buff permanent (E9) qu'elle transporte — une carte dorée
// hérite des buffs des exemplaires absorbés par la fusion — et sans enchantements.
function unplacedStats(card: CardInstance): MonsterFaceStats | null {
  if (!isMonster(getCardDef(card.cardId))) return null;
  const golden = card.golden === true;
  const base = getBaseMonsterStats(card.cardId, golden);
  const buff = card.buff ?? { attack: 0, defense: 0 };
  return {
    attack: base.attack + buff.attack,
    defense: base.defense + buff.defense,
    attackTone: buff.attack > 0 ? 'buffed' : 'base',
    defenseTone: buff.defense > 0 ? 'buffed' : 'base',
    golden,
  };
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
  marketVisible,
  marketZoneRectRef,
  onBuy,
  onDragStart,
  onDragHover,
  onDrop,
  isOverFusionZone,
  onZoomCard,
}: BoardProps) {
  const opponentSeat: Seat = opponentOf(seat);
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  const me = state.players[seat];
  const opponent = state.players[opponentSeat];

  const seenUidsRef = useRef<Set<string> | null>(null);
  const dragWorldRef = useRef<THREE.Vector3 | null>(null);
  const entries: RenderEntry[] = [];
  const zonePositionByUid = new Map<string, [number, number, number]>();
  const zoneCardIdByUid = new Map<string, string>();

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
    // Demande utilisateur : je peux masquer mon propre marché (bouton HUD) sans que ça
    // affecte l'affichage (toujours face cachée) chez l'adversaire.
    if (mine && !marketVisible) continue;
    const buyable =
      interactive && mine && state.phase === 'main' && isActionLegal(state, seat, { type: 'buy', uid: card.uid });
    entries.push({
      uid: card.uid,
      cardId: card.cardId,
      stats: mine ? unplacedStats(card) : null,
      ko: false,
      pose: marketCardPose(index, activePlayer.market.length, mine, aspect),
      hidden: !mine,
      mine,
      halo: buyable ? 'playable' : 'none',
      hoverable: false,
      clickable: buyable,
      onSelect: () => onBuy(card.uid),
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

  for (const { owner, zone } of zonesToRender) {
    const ownerPlayer = state.players[owner];
    const mine = owner === seat;
    for (const [index, slot] of ownerPlayer.zones[zone].entries()) {
      if (!slot) continue;
      const pose = slotPose(zone, index, mine);
      zonePositionByUid.set(slot.uid, pose.position);
      zoneCardIdByUid.set(slot.uid, slot.cardId);

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

      // Une carte déjà posée peut être déplacée à la souris vers un autre emplacement libre
      // de SA zone pendant la phase principale (demande utilisateur) : uniquement la mienne,
      // uniquement en attaque/défense (pas les enchantements).
      const movable = mine && canDrag && !myMarketOpen && (zone === 'attack' || zone === 'defense');
      const dragged = slot.uid === drag?.uid;

      entries.push({
        uid: slot.uid,
        cardId: slot.cardId,
        stats,
        ko,
        pose,
        hidden: false,
        mine,
        halo: dragged ? 'selected' : 'none',
        hoverable: false,
        // Une carte posée (la mienne ou celle de l'adversaire) s'ouvre en grand au clic ; le
        // bouton Vendre n'apparaît que pour la mienne (géré dans GameScreen).
        clickable: !myMarketOpen,
        onSelect: () => onZoomCard(slot.uid),
        onDragStart: movable
          ? (x, y) => onDragStart(slot.uid, x, y, { zone: zone as MonsterZone, slot: index })
          : undefined,
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
    if (drag.origin) return zone === drag.origin.zone && isActionLegal(state, seat, { type: 'move', uid: drag.uid, slot });
    return isActionLegal(state, seat, { type: 'place', uid: drag.uid, zone, slot });
  };

  // Le marché ouvert affiche des cartes face cachée chez l'adversaire et un fond plus sombre
  // aide à les distinguer sans éblouir ; une fois masqué (bouton HUD), rien ne justifie de
  // garder la table sombre donc on l'éclaircit pour une meilleure lisibilité générale.
  const brightTable = !marketVisible;
  const tableColor = brightTable ? theme.colors.tableTopBright : theme.colors.tableTop;
  const ambientIntensity = brightTable ? 1.15 : 0.7;
  const keyLightIntensity = brightTable ? 1.6 : 1.1;
  const fillLightIntensity = brightTable ? 0.5 : 0;

  return (
    <>
      <MarketZoneTracker count={state.turn === seat ? me.market.length : 0} rectRef={marketZoneRectRef} />

      <ambientLight intensity={ambientIntensity} />
      {brightTable && <hemisphereLight args={[tableColor, '#05060a', 0.5]} />}
      <directionalLight position={[3, 8, 4]} intensity={keyLightIntensity} castShadow />
      {brightTable && <directionalLight position={[-4, 5, -3]} intensity={fillLightIntensity} />}

      <mesh position={[0, -0.06, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[14, 12]} />
        <meshStandardMaterial color={tableColor} />
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
              bright={brightTable}
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

      <EffectiveBursts hits={effectiveHits} />
      <AbilityPulses triggers={abilityTriggers} />

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
