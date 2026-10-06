import { useMemo } from 'react';
import * as THREE from 'three';
import { BOARD_BOUNDS } from './layout';
import { theme } from './theme';

// Table de taverne (demande utilisateur) : plateau de planches de bois sombre, un tapis de
// feutre posé dessous les zones, sans aucun effet d'ombre (demande utilisateur). Tout est peint en Canvas 2D (D5 : aucune image à charger) et mis en cache au niveau du module.

// Bois : texture qui se répète, WOOD_TILE unités de table par répétition.
const WOOD_TILE = 9;
const WOOD_PX = 2048;
const PLANKS_PER_TILE = 6;
const TABLE_SIZE: [number, number] = [60, 44];

// Tapis : marge autour des rangées, et rebord de cuir cousu.
const MAT_MARGIN = 0.5;
const MAT_PX_PER_UNIT = 180;
const MAT_RIM = 0.16;

// Générateur pseudo-aléatoire à graine fixe : la table est la même à chaque partie.
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Grain fin : bruit par pixel, appliqué en une passe sur l'image entière.
function addNoise(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number, rand: () => number) {
  const image = ctx.getImageData(0, 0, w, h);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = (rand() - 0.5) * amount;
    data[i] += n;
    data[i + 1] += n;
    data[i + 2] += n;
  }
  ctx.putImageData(image, 0, 0);
}

let woodTexture: THREE.CanvasTexture | null = null;

// Planches dans le sens de la largeur de l'écran. Toutes les ondulations du fil ont un nombre
// entier de périodes sur la largeur, et les planches tombent juste sur la hauteur : la texture
// se raccorde sans couture quand elle se répète.
function getWoodTexture(): THREE.CanvasTexture {
  if (woodTexture) return woodTexture;
  const rand = seeded(7);
  const size = WOOD_PX;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const plankH = size / PLANKS_PER_TILE;
  const tones = theme.table.woodTones;

  for (let p = 0; p < PLANKS_PER_TILE; p++) {
    const y0 = p * plankH;
    const base = tones[Math.floor(rand() * tones.length)];
    ctx.fillStyle = base;
    ctx.fillRect(0, y0, size, plankH);

    // Veines : longues ondulations sombres et claires, de largeur et d'opacité variées.
    for (let k = 0; k < 70; k++) {
      const yc = y0 + rand() * plankH;
      const amp1 = 2 + rand() * 9;
      const amp2 = 1 + rand() * 4;
      const per1 = 1 + Math.floor(rand() * 3);
      const per2 = 3 + Math.floor(rand() * 6);
      const ph1 = rand() * Math.PI * 2;
      const ph2 = rand() * Math.PI * 2;
      const dark = rand() < 0.7;
      ctx.strokeStyle = dark ? `rgba(20, 10, 4, ${0.08 + rand() * 0.22})` : `rgba(255, 214, 160, ${0.03 + rand() * 0.06})`;
      ctx.lineWidth = 0.6 + rand() * (dark ? 2.6 : 1.4);
      ctx.beginPath();
      for (let x = 0; x <= size; x += 8) {
        const t = (x / size) * Math.PI * 2;
        const y = yc + Math.sin(t * per1 + ph1) * amp1 + Math.sin(t * per2 + ph2) * amp2;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Nœuds : quelques cernes concentriques sur certaines planches.
    if (rand() < 0.6) {
      const kx = 120 + rand() * (size - 240);
      const ky = y0 + plankH * (0.3 + rand() * 0.4);
      const rx = 18 + rand() * 26;
      const ry = rx * (0.35 + rand() * 0.2);
      const knot = ctx.createRadialGradient(kx, ky, 0, kx, ky, rx);
      knot.addColorStop(0, 'rgba(18, 8, 3, 0.75)');
      knot.addColorStop(0.5, 'rgba(30, 14, 6, 0.35)');
      knot.addColorStop(1, 'rgba(30, 14, 6, 0)');
      ctx.fillStyle = knot;
      ctx.beginPath();
      ctx.ellipse(kx, ky, rx * 1.6, ry * 1.6, 0, 0, Math.PI * 2);
      ctx.fill();
      for (let r = 1; r <= 4; r++) {
        ctx.strokeStyle = `rgba(18, 8, 3, ${0.25 - r * 0.04})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.ellipse(kx, ky, rx * (1 + r * 0.45), ry * (1 + r * 0.6), 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Joints de bout : chaque planche est coupée une ou deux fois, en quinconce.
    const cuts = 1 + Math.floor(rand() * 2);
    for (let c = 0; c < cuts; c++) {
      const cx = ((p * 0.37 + c / cuts + rand() * 0.2) % 1) * size;
      ctx.fillStyle = 'rgba(8, 4, 2, 0.85)';
      ctx.fillRect(cx, y0, 3, plankH);
      ctx.fillStyle = 'rgba(255, 220, 170, 0.06)';
      ctx.fillRect(cx + 3, y0, 2, plankH);
    }

    // Rainure entre deux planches, avec un léger reflet sur l'arête du dessous.
    ctx.fillStyle = 'rgba(6, 3, 1, 0.9)';
    ctx.fillRect(0, y0, size, 4);
    ctx.fillStyle = 'rgba(255, 220, 170, 0.07)';
    ctx.fillRect(0, y0 + 4, size, 2);
    const shade = ctx.createLinearGradient(0, y0, 0, y0 + plankH);
    shade.addColorStop(0, 'rgba(0, 0, 0, 0.18)');
    shade.addColorStop(0.15, 'rgba(0, 0, 0, 0)');
    shade.addColorStop(0.85, 'rgba(0, 0, 0, 0)');
    shade.addColorStop(1, 'rgba(0, 0, 0, 0.22)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, y0, size, plankH);
  }

  addNoise(ctx, size, size, 14, rand);

  woodTexture = new THREE.CanvasTexture(canvas);
  woodTexture.colorSpace = THREE.SRGBColorSpace;
  woodTexture.wrapS = THREE.RepeatWrapping;
  woodTexture.wrapT = THREE.RepeatWrapping;
  woodTexture.repeat.set(TABLE_SIZE[0] / WOOD_TILE, TABLE_SIZE[1] / WOOD_TILE);
  woodTexture.anisotropy = 8;
  return woodTexture;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const MAT_W = BOARD_BOUNDS.maxX - BOARD_BOUNDS.minX + MAT_MARGIN * 2;
const MAT_H = BOARD_BOUNDS.maxZ - BOARD_BOUNDS.minZ + MAT_MARGIN * 2;
const MAT_CENTER: [number, number] = [
  (BOARD_BOUNDS.minX + BOARD_BOUNDS.maxX) / 2,
  (BOARD_BOUNDS.minZ + BOARD_BOUNDS.maxZ) / 2,
];

let matTexture: THREE.CanvasTexture | null = null;

// Tapis de feutre : rebord de cuir cousu de fil d'or, feutre légèrement pelucheux, plus
// sombre sur les bords, et la ligne de front entre les deux camps.
function getMatTexture(): THREE.CanvasTexture {
  if (matTexture) return matTexture;
  const rand = seeded(23);
  const k = MAT_PX_PER_UNIT;
  const w = Math.round(MAT_W * k);
  const h = Math.round(MAT_H * k);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const { felt, feltDark, leather, stitch } = theme.table;
  const radius = 0.32 * k;
  const rim = MAT_RIM * k;

  // Rebord de cuir.
  roundedRect(ctx, 0, 0, w, h, radius);
  ctx.fillStyle = leather;
  ctx.fill();
  ctx.save();
  ctx.clip();
  const rimShade = ctx.createLinearGradient(0, 0, 0, h);
  rimShade.addColorStop(0, 'rgba(255, 220, 170, 0.12)');
  rimShade.addColorStop(1, 'rgba(0, 0, 0, 0.25)');
  ctx.fillStyle = rimShade;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  // Feutre, assombri vers les bords.
  roundedRect(ctx, rim, rim, w - rim * 2, h - rim * 2, radius - rim * 0.6);
  ctx.save();
  ctx.clip();
  const feltGradient = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.15, w / 2, h / 2, Math.max(w, h) * 0.62);
  feltGradient.addColorStop(0, felt);
  feltGradient.addColorStop(1, feltDark);
  ctx.fillStyle = feltGradient;
  ctx.fillRect(0, 0, w, h);
  // Fibres : petits traits courts dans tous les sens.
  for (let i = 0; i < (w * h) / 60; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const a = rand() * Math.PI;
    const len = 2 + rand() * 5;
    ctx.strokeStyle = rand() < 0.5 ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.035)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  ctx.restore();

  // Couture en fil d'or sur le cuir.
  ctx.save();
  ctx.setLineDash([10, 7]);
  ctx.strokeStyle = stitch;
  ctx.lineWidth = 2.5;
  roundedRect(ctx, rim * 0.48, rim * 0.48, w - rim * 0.96, h - rim * 0.96, radius - rim * 0.4);
  ctx.stroke();
  ctx.restore();

  // Ligne de front (z = 0) : filet doré qui s'efface vers les bords, losange au centre.
  const frontY = (0 - (MAT_CENTER[1] - MAT_H / 2)) * k;
  const frontX = (0 - (MAT_CENTER[0] - MAT_W / 2)) * k;
  const line = ctx.createLinearGradient(rim, 0, w - rim, 0);
  line.addColorStop(0, 'rgba(201, 164, 65, 0)');
  line.addColorStop(0.5, 'rgba(201, 164, 65, 0.45)');
  line.addColorStop(1, 'rgba(201, 164, 65, 0)');
  ctx.fillStyle = line;
  ctx.fillRect(rim * 2, frontY - 1.5, w - rim * 4, 3);
  ctx.save();
  ctx.translate(frontX, frontY);
  ctx.rotate(Math.PI / 4);
  ctx.strokeStyle = 'rgba(201, 164, 65, 0.6)';
  ctx.lineWidth = 3;
  ctx.strokeRect(-11, -11, 22, 22);
  ctx.fillStyle = 'rgba(201, 164, 65, 0.35)';
  ctx.fillRect(-5, -5, 10, 10);
  ctx.restore();

  addNoise(ctx, w, h, 8, rand);

  matTexture = new THREE.CanvasTexture(canvas);
  matTexture.colorSpace = THREE.SRGBColorSpace;
  matTexture.anisotropy = 8;
  return matTexture;
}

// `bright` : le marché est masqué, la table s'éclaire (demande utilisateur, voir Board).
function Table({ bright }: { bright: boolean }) {
  const wood = useMemo(getWoodTexture, []);
  const mat = useMemo(getMatTexture, []);
  const tint = bright ? '#ffffff' : '#b9b2a8';

  return (
    <group>
      <mesh position={[0, -0.07, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={TABLE_SIZE} />
        <meshStandardMaterial map={wood} color={tint} roughness={0.72} metalness={0} />
      </mesh>
      <mesh position={[MAT_CENTER[0], -0.055, MAT_CENTER[1]]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[MAT_W, MAT_H]} />
        {/* Coins arrondis par `alphaTest`, pas par transparence : un tapis transparent serait
            trié avec les fonds des rangées et pourrait se dessiner après eux, donc caché. */}
        <meshStandardMaterial map={mat} color={tint} roughness={1} metalness={0} alphaTest={0.5} />
      </mesh>
    </group>
  );
}

export default Table;
