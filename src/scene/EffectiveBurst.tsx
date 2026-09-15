import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { CardElement } from '../game/types';
import { IMPACT_MS } from './combatPlayback';
import { theme } from './theme';

// Texte « Efficace ! » qui jaillit au-dessus d'un monstre touché par un dégât augmenté par
// l'avantage élémentaire (demande utilisateur), aux couleurs de l'élément qui frappe. Les
// bursts vivent plus longtemps que le coup qui les déclenche (STEP_MS) : ils sont donc
// gérés ici, indépendamment du curseur de lecture.

export interface EffectiveHit {
  id: string; // unique par coup et par carte touchée : un même id ne rejoue jamais l'animation
  position: [number, number, number]; // position de la carte touchée sur le board
  element: CardElement; // élément de la carte qui inflige le dégât augmenté
}

const TEXT = 'EFFICACE !';
const DURATION_MS = 1100;
const POP_PORTION = 0.18; // part de l'animation consacrée au « pop » d'apparition
const FADE_START = 0.65; // début du fondu de sortie
const BASE_SCALE: [number, number] = [1.6, 0.4]; // ratio de la texture 512×128
// Caméra plongeante placée côté +z (layout.ts) : monter « vers le haut de l'écran », c'est
// surtout reculer en -z.
const START_OFFSET: [number, number, number] = [0, 0.45, -0.1];
const DRIFT: [number, number, number] = [0, 0.3, -0.55];

const textureCache = new Map<CardElement, THREE.CanvasTexture>();

function getEffectiveTexture(element: CardElement): THREE.CanvasTexture {
  const cached = textureCache.get(element);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponible');

  const palette = theme.elements[element];
  const x = canvas.width / 2;
  const y = canvas.height / 2 + 4;
  const maxWidth = canvas.width - 24;
  ctx.font = 'italic 900 74px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  // Contour sombre avec ombre portée, pour rester lisible sur la table comme sur les cartes.
  ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
  ctx.shadowBlur = 10;
  ctx.lineWidth = 12;
  ctx.strokeStyle = palette.badge;
  ctx.strokeText(TEXT, x, y, maxWidth);
  ctx.shadowColor = 'transparent';

  const gradient = ctx.createLinearGradient(0, 24, 0, 104);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.45, palette.light);
  gradient.addColorStop(1, palette.base);
  ctx.fillStyle = gradient;
  ctx.fillText(TEXT, x, y, maxWidth);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  textureCache.set(element, texture);
  return texture;
}

function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

function Burst({ hit, onDone }: { hit: EffectiveHit; onDone: (id: string) => void }) {
  const spriteRef = useRef<THREE.Sprite>(null!);
  const materialRef = useRef<THREE.SpriteMaterial>(null!);
  const startRef = useRef(performance.now() + IMPACT_MS); // apparaît à l'impact du coup
  const doneRef = useRef(false);
  const texture = useMemo(() => getEffectiveTexture(hit.element), [hit.element]);

  useFrame(() => {
    const sprite = spriteRef.current;
    const material = materialRef.current;
    if (!sprite || !material) return;

    const t = (performance.now() - startRef.current) / DURATION_MS;
    if (t < 0 || t >= 1) {
      material.opacity = 0;
      if (t >= 1 && !doneRef.current) {
        doneRef.current = true;
        onDone(hit.id);
      }
      return;
    }

    const pop = t < POP_PORTION ? easeOutBack(t / POP_PORTION) : 1;
    const [x, y, z] = hit.position;
    sprite.position.set(
      x + START_OFFSET[0] + DRIFT[0] * t,
      y + START_OFFSET[1] + DRIFT[1] * t,
      z + START_OFFSET[2] + DRIFT[2] * t,
    );
    sprite.scale.set(BASE_SCALE[0] * pop, BASE_SCALE[1] * pop, 1);
    material.opacity = t < FADE_START ? 1 : 1 - (t - FADE_START) / (1 - FADE_START);
  });

  return (
    <sprite ref={spriteRef} position={hit.position} scale={[0.001, 0.001, 1]} renderOrder={10}>
      <spriteMaterial
        ref={materialRef}
        map={texture}
        transparent
        opacity={0}
        depthTest={false}
        depthWrite={false}
      />
    </sprite>
  );
}

function EffectiveBursts({ hits }: { hits: EffectiveHit[] }) {
  const [active, setActive] = useState<EffectiveHit[]>([]);
  const seenIdsRef = useRef(new Set<string>());
  const hitsKey = hits.map((h) => h.id).join('|');

  useEffect(() => {
    const fresh = hits.filter((h) => !seenIdsRef.current.has(h.id));
    if (fresh.length === 0) return;
    for (const h of fresh) seenIdsRef.current.add(h.id);
    setActive((prev) => [...prev, ...fresh]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hitsKey]);

  const handleDone = (id: string) => setActive((prev) => prev.filter((h) => h.id !== id));

  return (
    <>
      {active.map((hit) => (
        <Burst key={hit.id} hit={hit} onDone={handleDone} />
      ))}
    </>
  );
}

export default EffectiveBursts;
