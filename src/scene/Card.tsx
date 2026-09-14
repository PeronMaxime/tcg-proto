import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import * as THREE from 'three';
import { getCardDef } from '../game/cards';
import { handHoverPose, type Pose } from './layout';
import { theme } from './theme';
import { getCardBackTexture, getCardFaceTexture, type MonsterFaceStats } from './textures';

export type HaloKind = 'none' | 'playable' | 'selected' | 'target';

export interface AttackTrigger {
  id: number;
  targetPosition: [number, number, number];
}

interface CardProps {
  cardId: string;
  stats: MonsterFaceStats | null; // null pour un enchantement (§6.4)
  ko: boolean;
  pose: Pose;
  spawnPose?: Pose; // pose de départ si la carte apparaît pour la première fois (D6)
  hidden: boolean;
  halo: HaloKind;
  hoverable: boolean;
  clickable: boolean;
  attackTrigger: AttackTrigger | null;
  // Présent uniquement pour la carte tenue en glisser-déposer : position monde du pointeur
  // (voir DragController), `null` quand la carte n'est plus tenue.
  dragWorldRef?: RefObject<THREE.Vector3 | null>;
  onSelect?: () => void;
  onDragStart?: (clientX: number, clientY: number) => void;
}

const DAMP_LAMBDA = 10;
const DRAG_DAMP_LAMBDA = 28; // la carte tenue suit le pointeur de près
const DRAG_SCALE = 0.8;
const LUNGE_DURATION = 0.45; // s

function haloColor(kind: HaloKind): string {
  switch (kind) {
    case 'playable':
      return theme.colors.haloPlayable;
    case 'selected':
      return theme.colors.haloSelected;
    case 'target':
      return theme.colors.haloTarget;
    default:
      return '#000000';
  }
}

function Card({
  cardId,
  stats,
  ko,
  pose,
  spawnPose,
  hidden,
  halo,
  hoverable,
  clickable,
  attackTrigger,
  dragWorldRef,
  onSelect,
  onDragStart,
}: CardProps) {
  const def = getCardDef(cardId);
  const faceTexture = useMemo(() => getCardFaceTexture(def, stats), [def, stats]);
  const backTexture = useMemo(() => getCardBackTexture(), []);
  const { width, height } = theme.card;

  const groupRef = useRef<THREE.Group>(null!);
  const flipRef = useRef<THREE.Group>(null!);
  const haloMaterialRef = useRef<THREE.MeshBasicMaterial>(null!);
  const faceMaterialRef = useRef<THREE.MeshStandardMaterial>(null!);
  const initialized = useRef(false);
  const prevDefense = useRef(stats?.defense ?? null);
  const flashIntensity = useRef(0);
  const prevGolden = useRef(stats?.golden ?? false);
  const goldFlash = useRef(0); // éclat doré au moment d'une fusion, amorti
  const goldGlowMaterialRef = useRef<THREE.MeshBasicMaterial>(null!);
  const lunge = useRef<{ start: number; base: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  const lastAttackId = useRef<number | null>(null);
  const koAmount = useRef(0); // 0 = debout, 1 = KO complet (amorti)

  const [hovered, setHovered] = useState(false);

  // Pose de départ : sur mount, `spawnPose` (deck du propriétaire) si la carte est neuve,
  // sinon directement la pose cible — pas d'animation surprise au premier rendu (§7.2).
  useEffect(() => {
    if (initialized.current || !groupRef.current) return;
    const start = spawnPose ?? pose;
    groupRef.current.position.set(...start.position);
    groupRef.current.rotation.set(...start.rotation);
    groupRef.current.scale.setScalar(start.scale);
    initialized.current = true;
  }, []);

  useEffect(() => {
    const defense = stats?.defense ?? null;
    if (defense !== null && prevDefense.current !== null && defense < prevDefense.current) {
      flashIntensity.current = 1;
    }
    prevDefense.current = defense;
  }, [stats?.defense]);

  // Fusion : la carte posée devient dorée (même uid, donc même composant) — éclat + grossissement.
  useEffect(() => {
    const golden = stats?.golden ?? false;
    if (golden && !prevGolden.current) goldFlash.current = 1;
    prevGolden.current = golden;
  }, [stats?.golden]);

  useEffect(() => {
    if (attackTrigger && attackTrigger.id !== lastAttackId.current && groupRef.current) {
      lastAttackId.current = attackTrigger.id;
      lunge.current = {
        start: performance.now(),
        base: groupRef.current.position.clone(),
        target: new THREE.Vector3(...attackTrigger.targetPosition),
      };
    }
  }, [attackTrigger]);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;

    if (lunge.current) {
      const t = (performance.now() - lunge.current.start) / 1000 / LUNGE_DURATION;
      if (t >= 1) {
        lunge.current = null;
      } else {
        const k = Math.sin(Math.PI * t) * 0.85;
        const lungePos = lunge.current.base.clone().lerp(lunge.current.target, k);
        lungePos.y += Math.sin(Math.PI * t) * 0.3;
        group.position.copy(lungePos);
      }
    }

    koAmount.current = THREE.MathUtils.damp(koAmount.current, ko ? 1 : 0, DAMP_LAMBDA, delta);

    if (!lunge.current) {
      const dragPoint = dragWorldRef?.current ?? null;
      const effectivePose: Pose = dragPoint
        ? { position: [dragPoint.x, dragPoint.y, dragPoint.z], rotation: [-Math.PI / 2, 0, 0], scale: DRAG_SCALE }
        : hovered && hoverable
          ? handHoverPose(pose)
          : pose;
      const moveLambda = dragPoint ? DRAG_DAMP_LAMBDA : DAMP_LAMBDA;
      group.position.x = THREE.MathUtils.damp(group.position.x, effectivePose.position[0], moveLambda, delta);
      group.position.y = THREE.MathUtils.damp(
        group.position.y,
        effectivePose.position[1] - koAmount.current * 0.02,
        moveLambda,
        delta,
      );
      group.position.z = THREE.MathUtils.damp(group.position.z, effectivePose.position[2], moveLambda, delta);
      group.rotation.x = THREE.MathUtils.damp(group.rotation.x, effectivePose.rotation[0], DAMP_LAMBDA, delta);
      group.rotation.y = THREE.MathUtils.damp(group.rotation.y, effectivePose.rotation[1], DAMP_LAMBDA, delta);
      // KO : la carte pivote d'un quart de tour à plat sur la table (portrait → paysage,
      // donc « à l'horizontale ») ; elle revient d'elle-même à la verticale quand `ko`
      // repasse à `false` en fin de combat, via l'amortissement de `koAmount` (H1).
      group.rotation.z = THREE.MathUtils.damp(
        group.rotation.z,
        effectivePose.rotation[2] + koAmount.current * (Math.PI / 2),
        DAMP_LAMBDA,
        delta,
      );
      const scale = THREE.MathUtils.damp(
        group.scale.x,
        effectivePose.scale * (1 + goldFlash.current * 0.35),
        DAMP_LAMBDA,
        delta,
      );
      group.scale.setScalar(scale);
    }

    goldFlash.current = THREE.MathUtils.damp(goldFlash.current, 0, 2.5, delta);
    if (goldGlowMaterialRef.current) {
      // Liseré doré permanent qui scintille doucement, renforcé pendant l'éclat de fusion.
      const shimmer = 0.45 + Math.sin(performance.now() / 350) * 0.15;
      const target = stats?.golden && !hidden ? Math.min(1, shimmer + goldFlash.current) : 0;
      goldGlowMaterialRef.current.opacity = THREE.MathUtils.damp(
        goldGlowMaterialRef.current.opacity,
        target,
        DAMP_LAMBDA,
        delta,
      );
    }

    if (flipRef.current) {
      const targetY = hidden ? Math.PI : 0;
      flipRef.current.rotation.y = THREE.MathUtils.damp(flipRef.current.rotation.y, targetY, DAMP_LAMBDA, delta);
    }

    if (haloMaterialRef.current) {
      const pulse = 0.55 + Math.sin(performance.now() / 200) * 0.2;
      const targetOpacity = halo === 'none' ? 0 : pulse;
      haloMaterialRef.current.opacity = THREE.MathUtils.damp(
        haloMaterialRef.current.opacity,
        targetOpacity,
        DAMP_LAMBDA,
        delta,
      );
      haloMaterialRef.current.color.set(haloColor(halo));
    }

    if (faceMaterialRef.current) {
      flashIntensity.current = THREE.MathUtils.damp(flashIntensity.current, 0, 6, delta);
      const gold = goldFlash.current;
      faceMaterialRef.current.emissive.setRGB(
        Math.min(1, flashIntensity.current + gold * 0.9),
        gold * 0.7,
        gold * 0.15,
      );
      // Face assombrie pendant le KO (§6.4).
      const darken = 1 - koAmount.current * 0.65;
      faceMaterialRef.current.color.setRGB(darken, darken, darken);
      // Léger tremblement pendant le flash de dégâts.
      if (flashIntensity.current > 0.05) {
        group.position.x += (Math.random() - 0.5) * 0.02 * flashIntensity.current;
      }
    }
  });

  return (
    <group
      ref={groupRef}
      onClick={(e) => {
        if (!clickable) return;
        e.stopPropagation();
        onSelect?.();
      }}
      onPointerDown={(e) => {
        if (!onDragStart || e.nativeEvent.button !== 0) return;
        e.stopPropagation();
        setHovered(false);
        onDragStart(e.nativeEvent.clientX, e.nativeEvent.clientY);
      }}
      onPointerOver={(e) => {
        if (!hoverable) return;
        e.stopPropagation();
        setHovered(true);
        if (onDragStart) document.body.style.cursor = 'grab';
      }}
      onPointerOut={() => {
        setHovered(false);
        if (onDragStart && document.body.style.cursor === 'grab') document.body.style.cursor = '';
      }}
    >
      <mesh position={[0, 0, -0.01]}>
        <planeGeometry args={[width + 0.12, height + 0.12]} />
        <meshBasicMaterial ref={haloMaterialRef} color="#000000" transparent opacity={0} />
      </mesh>

      <mesh position={[0, 0, -0.015]}>
        <planeGeometry args={[width + 0.26, height + 0.26]} />
        <meshBasicMaterial ref={goldGlowMaterialRef} color={theme.colors.gold} transparent opacity={0} />
      </mesh>

      <group ref={flipRef}>
        <mesh castShadow>
          <planeGeometry args={[width, height]} />
          <meshStandardMaterial ref={faceMaterialRef} map={faceTexture} transparent alphaTest={0.1} />
        </mesh>
        <mesh rotation-y={Math.PI} castShadow>
          <planeGeometry args={[width, height]} />
          <meshStandardMaterial map={backTexture} transparent alphaTest={0.1} />
        </mesh>
      </group>
    </group>
  );
}

export default Card;
