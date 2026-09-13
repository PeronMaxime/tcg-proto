import { useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { Pose } from './layout';
import { theme } from './theme';

interface HeroProps {
  pose: Pose;
  mine: boolean;
  hp: number;
  clickable: boolean;
  onSelect?: () => void;
}

function Hero({ pose, mine, hp, clickable, onSelect }: HeroProps) {
  const color = mine ? theme.colors.heroMine : theme.colors.heroOpponent;
  const meshRef = useRef<THREE.Mesh>(null!);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null!);
  const prevHp = useRef(hp);
  const flashIntensity = useRef(0);
  const basePosition = useRef(new THREE.Vector3(...pose.position));

  useEffect(() => {
    if (hp < prevHp.current) flashIntensity.current = 1;
    prevHp.current = hp;
  }, [hp]);

  useFrame(() => {
    if (materialRef.current) {
      flashIntensity.current = THREE.MathUtils.damp(flashIntensity.current, 0, 6, 1 / 60);
      materialRef.current.emissive.setRGB(flashIntensity.current, 0, 0);
    }
    if (meshRef.current) {
      const shake = flashIntensity.current > 0.05 ? (Math.random() - 0.5) * 0.05 * flashIntensity.current : 0;
      meshRef.current.position.set(
        basePosition.current.x + shake,
        basePosition.current.y,
        basePosition.current.z + shake,
      );
    }
  });

  return (
    <mesh
      ref={meshRef}
      position={pose.position}
      rotation={pose.rotation}
      castShadow
      receiveShadow
      onClick={(e) => {
        if (!clickable) return;
        e.stopPropagation();
        onSelect?.();
      }}
    >
      <cylinderGeometry args={[0.5, 0.5, 0.16, 32]} />
      <meshStandardMaterial ref={materialRef} color={color} />
    </mesh>
  );
}

export default Hero;
