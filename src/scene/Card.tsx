import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { getCardDef } from '../game/cards';
import { handHoverPose, type Pose } from './layout';
import { theme } from './theme';
import { getCardBackTexture, getCardFaceTexture } from './textures';

export type HaloKind = 'none' | 'playable' | 'selected' | 'target';

export interface AttackTrigger {
  id: number;
  targetPosition: [number, number, number];
}

interface CardProps {
  cardId: string;
  attack: number;
  health: number;
  pose: Pose;
  spawnPose?: Pose; // pose de départ si la carte apparaît pour la première fois (D6)
  hidden: boolean;
  dying: boolean;
  halo: HaloKind;
  hoverable: boolean;
  clickable: boolean;
  attackTrigger: AttackTrigger | null;
  onSelect?: () => void;
}

const DAMP_LAMBDA = 10;
const DEATH_DURATION = 0.45; // s — le temps de la fente et du flash (§7, §12)
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
  attack,
  health,
  pose,
  spawnPose,
  hidden,
  dying,
  halo,
  hoverable,
  clickable,
  attackTrigger,
  onSelect,
}: CardProps) {
  const def = getCardDef(cardId);
  const faceTexture = useMemo(() => getCardFaceTexture(def, attack, health), [def, attack, health]);
  const backTexture = useMemo(() => getCardBackTexture(), []);
  const { width, height } = theme.card;

  const groupRef = useRef<THREE.Group>(null!);
  const flipRef = useRef<THREE.Group>(null!);
  const haloMaterialRef = useRef<THREE.MeshBasicMaterial>(null!);
  const faceMaterialRef = useRef<THREE.MeshStandardMaterial>(null!);
  const initialized = useRef(false);
  const deathElapsed = useRef(0);
  const prevHealth = useRef(health);
  const flashIntensity = useRef(0);
  const lunge = useRef<{ start: number; base: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  const lastAttackId = useRef<number | null>(null);

  const [hovered, setHovered] = useState(false);

  // Pose de départ : sur mount, `spawnPose` (deck du propriétaire) si la carte est neuve,
  // sinon directement la pose cible — pas d'animation surprise au premier rendu (§12).
  useEffect(() => {
    if (initialized.current || !groupRef.current) return;
    const start = spawnPose ?? pose;
    groupRef.current.position.set(...start.position);
    groupRef.current.rotation.set(...start.rotation);
    groupRef.current.scale.setScalar(start.scale);
    initialized.current = true;
  }, []);

  useEffect(() => {
    if (health < prevHealth.current) flashIntensity.current = 1;
    prevHealth.current = health;
  }, [health]);

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

    if (dying) {
      deathElapsed.current += delta;
      if (deathElapsed.current > DEATH_DURATION) {
        const shrink = Math.max(0, 1 - (deathElapsed.current - DEATH_DURATION) / 0.35);
        group.scale.setScalar(pose.scale * shrink);
        group.position.y = pose.position[1] - (1 - shrink) * 0.6;
      }
    } else if (lunge.current) {
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

    if (!dying && !lunge.current) {
      const effectivePose = hovered && hoverable ? handHoverPose(pose) : pose;
      group.position.x = THREE.MathUtils.damp(group.position.x, effectivePose.position[0], DAMP_LAMBDA, delta);
      group.position.y = THREE.MathUtils.damp(group.position.y, effectivePose.position[1], DAMP_LAMBDA, delta);
      group.position.z = THREE.MathUtils.damp(group.position.z, effectivePose.position[2], DAMP_LAMBDA, delta);
      group.rotation.x = THREE.MathUtils.damp(group.rotation.x, effectivePose.rotation[0], DAMP_LAMBDA, delta);
      group.rotation.y = THREE.MathUtils.damp(group.rotation.y, effectivePose.rotation[1], DAMP_LAMBDA, delta);
      group.rotation.z = THREE.MathUtils.damp(group.rotation.z, effectivePose.rotation[2], DAMP_LAMBDA, delta);
      const scale = THREE.MathUtils.damp(group.scale.x, effectivePose.scale, DAMP_LAMBDA, delta);
      group.scale.setScalar(scale);
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
      faceMaterialRef.current.emissive.setRGB(flashIntensity.current, 0, 0);
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
      onPointerOver={(e) => {
        if (!hoverable) return;
        e.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      <mesh position={[0, 0, -0.01]}>
        <planeGeometry args={[width + 0.12, height + 0.12]} />
        <meshBasicMaterial ref={haloMaterialRef} color="#000000" transparent opacity={0} />
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
