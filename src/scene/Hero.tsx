import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
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

const valueTextureCache = new Map<string, THREE.CanvasTexture>();

const DISPLAY_FONT = "'Cinzel', Georgia, 'Times New Roman', serif";
const TOKEN_RADIUS = 0.46;

// Dessus du médaillon (§6.5) : cœur à la couleur du joueur, double cerclage d'or comme les
// plaques du HUD, PV gravés au centre.
function getValueTexture(value: number, color: string): THREE.CanvasTexture {
  const key = `${color}-${value}`;
  const cached = valueTextureCache.get(key);
  if (cached) return cached;

  const size = 256;
  const c = size / 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.beginPath();
  ctx.arc(c, c, c - 2, 0, Math.PI * 2);
  ctx.fillStyle = theme.colors.heroRim;
  ctx.fill();

  const core = ctx.createRadialGradient(c * 0.8, c * 0.7, 4, c, c, c * 0.8);
  core.addColorStop(0, color);
  core.addColorStop(1, theme.colors.heroCore);
  ctx.beginPath();
  ctx.arc(c, c, c * 0.8, 0, Math.PI * 2);
  ctx.fillStyle = core;
  ctx.fill();

  ctx.strokeStyle = theme.colors.gold;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(c, c, c * 0.8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = theme.colors.goldDark;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(c, c, c * 0.92, 0, Math.PI * 2);
  ctx.stroke();

  ctx.font = `700 ${value >= 10 ? 104 : 120}px ${DISPLAY_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = theme.colors.parchmentLight;
  ctx.fillText(String(value), c, c + 8);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  valueTextureCache.set(key, texture);
  return texture;
}

function Hero({ pose, mine, hp, clickable, onSelect }: HeroProps) {
  const color = mine ? theme.colors.heroMine : theme.colors.heroOpponent;
  const meshRef = useRef<THREE.Mesh>(null!);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null!);
  const prevHp = useRef(hp);
  const flashIntensity = useRef(0);
  const basePosition = useRef(new THREE.Vector3(...pose.position));
  const valueTexture = useMemo(() => getValueTexture(hp, color), [hp, color]);

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
      <cylinderGeometry args={[TOKEN_RADIUS, TOKEN_RADIUS * 1.04, 0.14, 48]} />
      <meshStandardMaterial ref={materialRef} color={theme.colors.heroRim} metalness={0.5} roughness={0.45} />
      <mesh position={[0, 0.071, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[TOKEN_RADIUS, 48]} />
        <meshBasicMaterial map={valueTexture} transparent />
      </mesh>
    </mesh>
  );
}

export default Hero;
