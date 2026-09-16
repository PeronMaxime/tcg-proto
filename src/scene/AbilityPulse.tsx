import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { CardElement } from '../game/types';
import { theme } from './theme';

// Petit effet visuel sur la carte dont une capacité vient de se déclencher (demande
// utilisateur) : un halo aux couleurs de l'élément qui s'ouvre puis s'éteint, et quelques
// étincelles qui s'envolent. Comme les bursts « Efficace ! », chaque pulse survit au rendu
// qui l'a créé et un même id ne rejoue jamais l'animation.

export interface AbilityTrigger {
  id: string;
  position: [number, number, number]; // position de la carte source sur le board
  element: CardElement;
}

const DURATION_MS = 950;
const SPARKS = 7;
// Caméra plongeante côté +z (layout.ts) : « vers le haut de l'écran » ≈ vers -z.
const LIFT: [number, number, number] = [0, 0.25, -0.05];
const SPARK_RISE: [number, number, number] = [0, 0.45, -0.75];

const glowTextureCache = new Map<CardElement, THREE.CanvasTexture>();
let sparkTexture: THREE.CanvasTexture | null = null;

// Halo : anneau lumineux et rayons fins, aux couleurs de l'élément.
function getGlowTexture(element: CardElement): THREE.CanvasTexture {
  const cached = glowTextureCache.get(element);
  if (cached) return cached;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponible');
  const c = size / 2;
  const palette = theme.elements[element];

  const glow = ctx.createRadialGradient(c, c, 0, c, c, c);
  glow.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
  glow.addColorStop(0.25, palette.light);
  glow.addColorStop(0.6, `${palette.base}88`);
  glow.addColorStop(1, `${palette.base}00`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineCap = 'round';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const inner = i % 2 === 0 ? 40 : 56;
    ctx.lineWidth = i % 2 === 0 ? 5 : 3;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * inner, c + Math.sin(a) * inner);
    ctx.lineTo(c + Math.cos(a) * (c - 12), c + Math.sin(a) * (c - 12));
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  glowTextureCache.set(element, texture);
  return texture;
}

// Étincelle : petite étoile à quatre branches, blanche (teintée par le matériau).
function getSparkTexture(): THREE.CanvasTexture {
  if (sparkTexture) return sparkTexture;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponible');
  const c = size / 2;
  const glow = ctx.createRadialGradient(c, c, 0, c, c, c);
  glow.addColorStop(0, 'rgba(255, 255, 255, 1)');
  glow.addColorStop(0.3, 'rgba(255, 255, 255, 0.5)');
  glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(c, 2);
  ctx.quadraticCurveTo(c, c, size - 2, c);
  ctx.quadraticCurveTo(c, c, c, size - 2);
  ctx.quadraticCurveTo(c, c, 2, c);
  ctx.quadraticCurveTo(c, c, c, 2);
  ctx.fill();
  sparkTexture = new THREE.CanvasTexture(canvas);
  sparkTexture.colorSpace = THREE.SRGBColorSpace;
  return sparkTexture;
}

function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - x, 3);
}

function Pulse({ trigger, onDone }: { trigger: AbilityTrigger; onDone: (id: string) => void }) {
  const glowRef = useRef<THREE.Sprite>(null!);
  const glowMaterialRef = useRef<THREE.SpriteMaterial>(null!);
  const sparkRefs = useRef<(THREE.Sprite | null)[]>([]);
  const startRef = useRef(performance.now());
  const doneRef = useRef(false);
  const glowTexture = useMemo(() => getGlowTexture(trigger.element), [trigger.element]);
  const spark = useMemo(() => getSparkTexture(), []);
  const sparkColor = theme.elements[trigger.element].light;
  // Direction et vitesse de chaque étincelle, fixées une fois pour toutes.
  const sparkParams = useMemo(
    () =>
      Array.from({ length: SPARKS }, (_, i) => {
        const angle = (i / SPARKS) * Math.PI * 2 + Math.random() * 0.6;
        return { dx: Math.cos(angle) * 0.55, dz: Math.sin(angle) * 0.3, speed: 0.7 + Math.random() * 0.5 };
      }),
    [],
  );

  useFrame(() => {
    const t = (performance.now() - startRef.current) / DURATION_MS;
    const [x, y, z] = trigger.position;
    if (t >= 1) {
      if (glowMaterialRef.current) glowMaterialRef.current.opacity = 0;
      sparkRefs.current.forEach((s) => s && ((s.material as THREE.SpriteMaterial).opacity = 0));
      if (!doneRef.current) {
        doneRef.current = true;
        onDone(trigger.id);
      }
      return;
    }

    const glow = glowRef.current;
    if (glow && glowMaterialRef.current) {
      const grow = easeOutCubic(Math.min(1, t / 0.45));
      const scale = 0.6 + grow * 1.5;
      glow.position.set(x + LIFT[0], y + LIFT[1], z + LIFT[2]);
      glow.scale.set(scale, scale, 1);
      glow.material.rotation = t * 1.2;
      glowMaterialRef.current.opacity = t < 0.3 ? 1 : 1 - (t - 0.3) / 0.7;
    }

    sparkRefs.current.forEach((s, i) => {
      if (!s) return;
      const p = sparkParams[i];
      const k = easeOutCubic(Math.min(1, t * p.speed * 1.3));
      s.position.set(
        x + LIFT[0] + p.dx * k + SPARK_RISE[0] * t,
        y + LIFT[1] + SPARK_RISE[1] * t,
        z + LIFT[2] + p.dz * k + SPARK_RISE[2] * t,
      );
      const size = 0.22 * (1 - t * 0.6);
      s.scale.set(size, size, 1);
      (s.material as THREE.SpriteMaterial).opacity = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
    });
  });

  return (
    <>
      <sprite ref={glowRef} position={trigger.position} scale={[0.001, 0.001, 1]} renderOrder={9}>
        <spriteMaterial
          ref={glowMaterialRef}
          map={glowTexture}
          transparent
          opacity={0}
          depthTest={false}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      {sparkParams.map((_, i) => (
        <sprite
          key={i}
          ref={(el) => {
            sparkRefs.current[i] = el;
          }}
          position={trigger.position}
          scale={[0.001, 0.001, 1]}
          renderOrder={9}
        >
          <spriteMaterial
            map={spark}
            color={sparkColor}
            transparent
            opacity={0}
            depthTest={false}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </sprite>
      ))}
    </>
  );
}

function AbilityPulses({ triggers }: { triggers: AbilityTrigger[] }) {
  const [active, setActive] = useState<AbilityTrigger[]>([]);
  // Au premier rendu, les déclenchements déjà présents (ex. rechargement de la page) sont
  // marqués comme vus sans être rejoués.
  const seenIdsRef = useRef<Set<string> | null>(null);
  if (seenIdsRef.current === null) seenIdsRef.current = new Set(triggers.map((t) => t.id));
  const triggersKey = triggers.map((t) => t.id).join('|');

  useEffect(() => {
    const seen = seenIdsRef.current!;
    const fresh = triggers.filter((t) => !seen.has(t.id));
    if (fresh.length === 0) return;
    for (const t of fresh) seen.add(t.id);
    setActive((prev) => [...prev, ...fresh]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggersKey]);

  const handleDone = (id: string) => setActive((prev) => prev.filter((t) => t.id !== id));

  return (
    <>
      {active.map((trigger) => (
        <Pulse key={trigger.id} trigger={trigger} onDone={handleDone} />
      ))}
    </>
  );
}

export default AbilityPulses;
