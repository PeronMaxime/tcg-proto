import { useEffect, useRef, useState } from 'react';
import { getCardDef } from '../game/cards';
import type { CardInstance, GameState, Seat, Target } from '../game/types';
import type { AttackTrigger, HaloKind } from './Card';
import Card from './Card';
import Hero from './Hero';
import {
  HERO_POSE_MINE,
  HERO_POSE_OPPONENT,
  boardSlotPose,
  deckPose,
  handCardPose,
  type Pose,
} from './layout';
import { theme } from './theme';

// Liste plate unique de cartes rendue dans un seul parent (D6) : une carte qui change de
// zone garde son identité React (key = uid) et vole vers sa nouvelle pose au lieu de se
// démonter/remonter.

interface BoardProps {
  state: GameState;
  seat: Seat;
  isMyTurn: boolean;
  selectedAttackerUid: string | null;
  onSelectAttacker: (uid: string | null) => void;
  onPlayCard: (uid: string) => void;
  onAttack: (target: Target) => void;
  onDeselect: () => void;
}

interface RenderEntry {
  card: CardInstance;
  pose: Pose;
  hidden: boolean;
  mine: boolean;
  dying: boolean;
  halo: HaloKind;
  hoverable: boolean;
  clickable: boolean;
  onSelect?: () => void;
}

function DeckPile({ pose, count }: { pose: Pose; count: number }) {
  const height = Math.max(0.02, count * 0.012);
  return (
    <mesh
      position={[pose.position[0], pose.position[1] + height / 2, pose.position[2]]}
      castShadow
      receiveShadow
    >
      <boxGeometry args={[1.0, height, 1.4]} />
      <meshStandardMaterial color={theme.colors.cardBack} />
    </mesh>
  );
}

function Board({
  state,
  seat,
  isMyTurn,
  selectedAttackerUid,
  onSelectAttacker,
  onPlayCard,
  onAttack,
  onDeselect,
}: BoardProps) {
  const opponentSeat: Seat = seat === 'p1' ? 'p2' : 'p1';
  const me = state.players[seat];
  const opponent = state.players[opponentSeat];

  const seenUidsRef = useRef<Set<string> | null>(null);
  const lastKnownPoseRef = useRef<Map<string, Pose>>(new Map());
  const lastHandledEventIdRef = useRef<number | undefined>(undefined);
  const [attackTrigger, setAttackTrigger] = useState<{ attackerUid: string; trigger: AttackTrigger } | null>(
    null,
  );

  const entries: RenderEntry[] = [];

  for (const [index, card] of me.hand.entries()) {
    const pose = handCardPose(index, me.hand.length, true);
    const cost = getCardDef(card.cardId).cost;
    const playable = isMyTurn && cost <= me.mana && me.board.length < 7;
    entries.push({
      card,
      pose,
      hidden: false,
      mine: true,
      dying: false,
      halo: playable ? 'playable' : 'none',
      hoverable: true,
      clickable: playable,
      onSelect: () => onPlayCard(card.uid),
    });
  }

  for (const [index, card] of opponent.hand.entries()) {
    entries.push({
      card,
      pose: handCardPose(index, opponent.hand.length, false),
      hidden: true,
      mine: false,
      dying: false,
      halo: 'none',
      hoverable: false,
      clickable: false,
    });
  }

  for (const [index, card] of me.board.entries()) {
    const selected = card.uid === selectedAttackerUid;
    const canSelect = isMyTurn && card.canAttack;
    entries.push({
      card,
      pose: boardSlotPose(index, me.board.length, true),
      hidden: false,
      mine: true,
      dying: false,
      halo: selected ? 'selected' : canSelect ? 'playable' : 'none',
      hoverable: false,
      clickable: canSelect,
      onSelect: () => onSelectAttacker(selected ? null : card.uid),
    });
  }

  for (const [index, card] of opponent.board.entries()) {
    const targetable = isMyTurn && selectedAttackerUid !== null;
    entries.push({
      card,
      pose: boardSlotPose(index, opponent.board.length, false),
      hidden: false,
      mine: false,
      dying: false,
      halo: targetable ? 'target' : 'none',
      hoverable: false,
      clickable: targetable,
      onSelect: () => onAttack({ kind: 'minion', uid: card.uid }),
    });
  }

  // Cartes mortes lors de la dernière action : gardent leur dernière pose connue et
  // rétrécissent après le délai de la fente/du flash (§7).
  for (const death of state.lastDeaths) {
    const pose = lastKnownPoseRef.current.get(death.card.uid);
    if (!pose) continue;
    entries.push({
      card: death.card,
      pose,
      hidden: false,
      mine: death.owner === seat,
      dying: true,
      halo: 'none',
      hoverable: false,
      clickable: false,
    });
  }

  // Apparition depuis le deck (D6) : une carte inconnue au rendu précédent démarre sur
  // le deck de son propriétaire, face cachée.
  const currentUids = new Set(entries.map((e) => e.card.uid));
  const isFirstRender = seenUidsRef.current === null;
  const spawnPoseFor = (uid: string, mine: boolean): Pose | undefined => {
    if (isFirstRender || seenUidsRef.current!.has(uid)) return undefined;
    return deckPose(mine);
  };

  // Détection des évènements nouveaux (fente d'attaque). Le premier rendu ne déclenche
  // jamais d'animation, même si `lastEvent` existe déjà (reconnexion) — voir §12.
  useEffect(() => {
    const event = state.lastEvent;
    const currentId = event?.id ?? 0;

    if (lastHandledEventIdRef.current === undefined) {
      lastHandledEventIdRef.current = currentId;
      return;
    }
    if (currentId === lastHandledEventIdRef.current) return;
    lastHandledEventIdRef.current = currentId;

    if (event?.type === 'attack') {
      const targetSeat: Seat = event.seat === seat ? opponentSeat : seat;
      const targetPosition =
        event.target.kind === 'hero'
          ? targetSeat === seat
            ? HERO_POSE_MINE.position
            : HERO_POSE_OPPONENT.position
          : (lastKnownPoseRef.current.get(event.target.uid)?.position ?? [0, 0, 0]);
      setAttackTrigger({
        attackerUid: event.attackerUid,
        trigger: { id: event.id, targetPosition },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.lastEvent]);

  useEffect(() => {
    seenUidsRef.current = currentUids;
    for (const entry of entries) {
      if (!entry.dying) lastKnownPoseRef.current.set(entry.card.uid, entry.pose);
    }
  });

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

      <Hero
        pose={HERO_POSE_MINE}
        mine
        hp={me.hp}
        clickable={false}
        onSelect={undefined}
      />
      <Hero
        pose={HERO_POSE_OPPONENT}
        mine={false}
        hp={opponent.hp}
        clickable={isMyTurn && selectedAttackerUid !== null}
        onSelect={() => onAttack({ kind: 'hero' })}
      />

      <DeckPile pose={deckPose(true)} count={me.deck.length} />
      <DeckPile pose={deckPose(false)} count={opponent.deck.length} />

      {entries.map((entry) => (
        <Card
          key={entry.card.uid}
          cardId={entry.card.cardId}
          attack={entry.card.attack}
          health={entry.card.health}
          pose={entry.pose}
          spawnPose={spawnPoseFor(entry.card.uid, entry.mine)}
          hidden={entry.hidden}
          dying={entry.dying}
          halo={entry.halo}
          hoverable={entry.hoverable}
          clickable={entry.clickable}
          attackTrigger={attackTrigger?.attackerUid === entry.card.uid ? attackTrigger.trigger : null}
          onSelect={entry.onSelect}
        />
      ))}
    </>
  );
}

export default Board;
