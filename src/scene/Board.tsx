import { useEffect, useRef } from 'react';
import { getCardDef, isMonster } from '../game/cards';
import { getMonsterStats, isActionLegal, opponentOf, ZONE_SIZES } from '../game/rules';
import type { GameState, MonsterZone, Seat, Zone } from '../game/types';
import type { ActiveCombatStep, CombatView } from '../ui/useCombatPlayback';
import type { AttackTrigger, HaloKind } from './Card';
import Card from './Card';
import Hero from './Hero';
import {
  deckPose,
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

interface BoardProps {
  state: GameState;
  seat: Seat;
  interactive: boolean; // mon tour, aucun combat en lecture, pas de gagnant
  selectedHandUid: string | null;
  combatView: CombatView | null; // surcharges d'affichage pendant la lecture (§7)
  activeStep: ActiveCombatStep | null; // coup en cours de fente (§7)
  displayedHp: Record<Seat, number>; // PV affichés pendant la lecture (§7.3)
  onBuy: (uid: string) => void;
  onSelectHandCard: (uid: string | null) => void;
  onPlace: (zone: Zone, slot: number) => void;
  onDeselect: () => void;
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
}

function DeckPile({ pose, count }: { pose: Pose; count: number }) {
  const height = Math.max(0.02, count * 0.008);
  return (
    <mesh
      position={[pose.position[0], pose.position[1] + height / 2, pose.position[2]]}
      castShadow
      receiveShadow
    >
      <boxGeometry args={[1.0 * pose.scale, height, 1.4 * pose.scale]} />
      <meshStandardMaterial color={theme.colors.cardBack} />
    </mesh>
  );
}

function baseMonsterStats(cardId: string): { attack: number; defense: number } {
  const def = getCardDef(cardId);
  if (!isMonster(def)) throw new Error(`Carte non-monstre: ${cardId}`);
  return { attack: def.attack, defense: def.defense };
}

function Board({
  state,
  seat,
  interactive,
  selectedHandUid,
  combatView,
  activeStep,
  displayedHp,
  onBuy,
  onSelectHandCard,
  onPlace,
  onDeselect,
}: BoardProps) {
  const opponentSeat: Seat = opponentOf(seat);
  const me = state.players[seat];
  const opponent = state.players[opponentSeat];

  const seenUidsRef = useRef<Set<string> | null>(null);
  const entries: RenderEntry[] = [];
  const zonePositionByUid = new Map<string, [number, number, number]>();

  // --- Ma main ---
  for (const [index, card] of me.hand.entries()) {
    const def = getCardDef(card.cardId);
    const stats: MonsterFaceStats | null = isMonster(def)
      ? { attack: def.attack, defense: def.defense, attackTone: 'base', defenseTone: 'base' }
      : null;
    const hasLegalSlot = isMonster(def)
      ? me.zones.attack.some((s) => s === null) || me.zones.defense.some((s) => s === null)
      : me.zones.enchant.some((s) => s === null);
    const playable = interactive && state.phase === 'main' && hasLegalSlot;
    const selected = card.uid === selectedHandUid;
    entries.push({
      uid: card.uid,
      cardId: card.cardId,
      stats,
      ko: false,
      pose: handCardPose(index, me.hand.length, true),
      hidden: false,
      mine: true,
      halo: selected ? 'selected' : playable ? 'playable' : 'none',
      hoverable: true,
      clickable: interactive && state.phase === 'main',
      onSelect: () => onSelectHandCard(selected ? null : card.uid),
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

  // --- Marché du joueur actif, visible des deux côtés (H4) ---
  const activePlayer = state.players[state.turn];
  for (const [index, card] of activePlayer.market.entries()) {
    const def = getCardDef(card.cardId);
    const stats: MonsterFaceStats | null = isMonster(def)
      ? { attack: def.attack, defense: def.defense, attackTone: 'base', defenseTone: 'base' }
      : null;
    const mine = state.turn === seat;
    const buyable =
      interactive && mine && state.phase === 'market' && isActionLegal(state, seat, { type: 'buy', uid: card.uid });
    entries.push({
      uid: card.uid,
      cardId: card.cardId,
      stats,
      ko: false,
      pose: marketCardPose(index, activePlayer.market.length, mine),
      hidden: false,
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
        const effective = getMonsterStats(ownerPlayer, slot.cardId, zone as MonsterZone);
        const base = baseMonsterStats(slot.cardId);
        let defenseValue = effective.defense;
        let defenseTone: MonsterFaceStats['defenseTone'] = effective.defense > base.defense ? 'buffed' : 'base';
        if (zone === 'defense' && combatView) {
          const overridden = combatView.defense.get(slot.uid);
          if (overridden !== undefined) {
            defenseValue = overridden;
            if (overridden < effective.defense) defenseTone = 'wounded';
          }
          ko = combatView.ko.has(slot.uid);
        }
        stats = {
          attack: effective.attack,
          defense: defenseValue,
          attackTone: effective.attack > base.attack ? 'buffed' : 'base',
          defenseTone,
        };
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
        clickable: false,
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

  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[3, 8, 4]} intensity={1.1} castShadow />

      <mesh
        position={[0, -0.06, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        onClick={(e) => {
          e.stopPropagation();
          onDeselect();
        }}
      >
        <planeGeometry args={[14, 12]} />
        <meshStandardMaterial color={theme.colors.tableTop} />
      </mesh>

      {zonesToRender.map(({ owner, zone }) => {
        const mine = owner === seat;
        const size = ZONE_SIZES[zone];
        return Array.from({ length: size }, (_, index) => {
          const occupied = state.players[owner].zones[zone][index] !== null;
          const legal =
            mine &&
            interactive &&
            selectedHandUid !== null &&
            isActionLegal(state, seat, { type: 'place', uid: selectedHandUid, zone, slot: index });
          return (
            <Slot
              key={`${owner}-${zone}-${index}`}
              pose={slotPose(zone, index, mine)}
              zone={zone}
              highlighted={legal}
              clickable={legal && !occupied}
              onSelect={() => onPlace(zone, index)}
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

      <DeckPile pose={deckPose(true)} count={me.deck.length} />
      <DeckPile pose={deckPose(false)} count={opponent.deck.length} />

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
          onSelect={entry.onSelect}
        />
      ))}
    </>
  );
}

export default Board;
