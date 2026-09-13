import * as THREE from 'three';
import { describeEffect } from '../game/cards';
import type { CardDef } from '../game/types';
import { theme } from './theme';

// Dessin Canvas 2D des faces et du dos des cartes, mis en cache (§6.3) : aucune police ni
// image à charger, rendu identique hors ligne (D5).

const TEXTURE_WIDTH = 300;
const TEXTURE_HEIGHT = 420; // ratio 5:7

export type StatTone = 'base' | 'buffed' | 'wounded';

export interface MonsterFaceStats {
  attack: number;
  defense: number;
  attackTone: StatTone;
  defenseTone: StatTone;
}

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

function toneColor(tone: StatTone): string {
  if (tone === 'buffed') return theme.colors.statBuffed;
  if (tone === 'wounded') return theme.colors.statWounded;
  return '#ffffff';
}

// Découpe simple d'un texte en lignes tenant dans `maxWidth`, centrées verticalement autour
// de `centerY`.
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  centerY: number,
  maxWidth: number,
  lineHeight: number,
): void {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);

  const startY = centerY - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, i) => ctx.fillText(line, centerX, startY + i * lineHeight));
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

// `stats` est `null` pour un enchantement (§6.3/§6.4). Clé de cache : `id:att:déf:tonAtt:tonDéf`
// pour un monstre, `id` pour un enchantement.
export function getCardFaceTexture(def: CardDef, stats: MonsterFaceStats | null): THREE.CanvasTexture {
  const key =
    def.kind === 'monster' && stats
      ? `${def.id}:${stats.attack}:${stats.defense}:${stats.attackTone}:${stats.defenseTone}`
      : def.id;
  const cached = faceCache.get(key);
  if (cached) return cached;

  const texture = makeTexture((ctx, w, h) => {
    if (def.kind === 'enchantment') {
      ctx.fillStyle = def.color;
      ctx.fillRect(0, 0, w, h);

      // Bandeau « Enchantement » distinctif.
      ctx.fillStyle = theme.colors.enchantBand;
      ctx.fillRect(0, 0, w, 40);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 16px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('ENCHANTEMENT', w / 2, 26);

      drawBadge(ctx, 38, 76, def.cost, theme.colors.coinBadge, '#000000');

      ctx.fillStyle = theme.colors.textOnCard;
      ctx.font = 'bold 24px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(def.name, w / 2, 130, w - 40);

      ctx.font = '20px system-ui, sans-serif';
      wrapText(ctx, describeEffect(def.effect), w / 2, h / 2 + 30, w - 60, 26);
      return;
    }

    ctx.fillStyle = def.color;
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = theme.colors.textOnCard;
    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(def.name, w / 2, 64, w - 40);

    drawBadge(ctx, 38, 38, def.cost, theme.colors.coinBadge, '#000000');

    const attack = stats?.attack ?? def.attack;
    const defense = stats?.defense ?? def.defense;
    drawBadge(ctx, 38, h - 38, attack, theme.colors.attackBadge, toneColor(stats?.attackTone ?? 'base'));
    drawBadge(ctx, w - 38, h - 38, defense, theme.colors.defenseBadge, toneColor(stats?.defenseTone ?? 'base'));
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
