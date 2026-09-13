import * as THREE from 'three';
import type { CardDef } from '../game/types';
import { theme } from './theme';

// Dessin Canvas 2D des faces et du dos des cartes, mis en cache par (cardId, attaque, vie) :
// aucune police ni image à charger, rendu identique hors ligne (D5).

const TEXTURE_WIDTH = 300;
const TEXTURE_HEIGHT = 420; // ratio 5:7

const faceCache = new Map<string, THREE.CanvasTexture>();
let backTextureCache: THREE.CanvasTexture | null = null;

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  value: number,
  bg: string,
  fg: string,
): void {
  ctx.beginPath();
  ctx.arc(x, y, 28, 0, Math.PI * 2);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.font = 'bold 32px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(value), x, y + 2);
}

function makeTexture(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_WIDTH;
  canvas.height = TEXTURE_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponible');

  ctx.save();
  // Coins arrondis transparents : tout ce qui est dessiné hors de ce tracé reste invisible
  // grâce à `alphaTest` sur le matériau (voir Card.tsx).
  roundedRectPath(ctx, 3, 3, TEXTURE_WIDTH - 6, TEXTURE_HEIGHT - 6, 22);
  ctx.clip();
  draw(ctx, TEXTURE_WIDTH, TEXTURE_HEIGHT);
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function getCardFaceTexture(def: CardDef, attack: number, health: number): THREE.CanvasTexture {
  const key = `${def.id}:${attack}:${health}`;
  const cached = faceCache.get(key);
  if (cached) return cached;

  const texture = makeTexture((ctx, w, h) => {
    ctx.fillStyle = def.color;
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = theme.colors.textOnCard;
    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(def.name, w / 2, 64, w - 40);

    drawBadge(ctx, 38, 38, def.cost, theme.colors.costBadge, '#ffffff');
    drawBadge(ctx, 38, h - 38, attack, theme.colors.attackBadge, '#000000');
    drawBadge(ctx, w - 38, h - 38, health, theme.colors.healthBadge, '#ffffff');
  });

  faceCache.set(key, texture);
  return texture;
}

export function getCardBackTexture(): THREE.CanvasTexture {
  if (backTextureCache) return backTextureCache;

  backTextureCache = makeTexture((ctx, w, h) => {
    ctx.fillStyle = theme.colors.cardBack;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = theme.colors.cardBackAccent;
    ctx.lineWidth = 8;
    ctx.strokeRect(18, 18, w - 36, h - 36);
  });

  return backTextureCache;
}
