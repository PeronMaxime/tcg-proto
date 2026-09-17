import * as THREE from 'three';
import {
  describeAbility,
  describeAura,
  describeEffect,
  describeKeywordEffect,
  KEYWORD_LABELS,
  scaleAbilityEffect,
  TRIGGER_LABELS,
} from '../game/cards';
import { GOLDEN_MULTIPLIER } from '../game/rules';
import type { CardAbility, CardDef, CardElement, Keyword } from '../game/types';
import { ART_HEIGHT, ART_WIDTH, drawCardArt } from './cardArt';
import { theme } from './theme';

// Dessin Canvas 2D des faces et du dos des cartes, mis en cache (§6.3) : aucune image à
// charger (D5). Les polices du HUD (Cinzel/Inter) sont utilisées si elles sont chargées ;
// sinon on dessine avec la police de repli, puis toutes les textures sont redessinées dès que
// les polices arrivent.

// Coordonnées de dessin en 300 × 420 (ratio 5:7), rendues en ×2 pour un texte net au zoom.
const TEXTURE_WIDTH = 300;
const TEXTURE_HEIGHT = 420;
const TEXTURE_SCALE = 2;

const DISPLAY_FONT = "'Cinzel', Georgia, 'Times New Roman', serif";
const BODY_FONT = "'Inter', system-ui, 'Segoe UI', sans-serif";

// Mise en page de la face (coordonnées logiques).
const ART_X = 22;
const ART_Y = 60;
const TEXT_BOX_TOP = 238;

export type StatTone = 'base' | 'buffed' | 'wounded';

export interface MonsterFaceStats {
  attack: number;
  defense: number;
  attackTone: StatTone;
  defenseTone: StatTone;
  golden: boolean; // monstre doré (fusion) : cadre et bandeau dorés
}

const faceCache = new Map<string, THREE.CanvasTexture>();
let backTextureCache: THREE.CanvasTexture | null = null;
// Redessine chaque texture créée (voir `watchFontLoading`).
const redraws: (() => void)[] = [];

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

function toneColor(tone: StatTone): string {
  if (tone === 'buffed') return theme.colors.statBuffed;
  if (tone === 'wounded') return theme.colors.statWounded;
  return '#ffffff';
}

// Chiffre avec contour sombre, lisible sur n'importe quel fond.
function outlinedNumber(ctx: CanvasRenderingContext2D, value: number, x: number, y: number, size: number, fill: string): void {
  ctx.font = `800 ${size}px ${BODY_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
  ctx.strokeText(String(value), x, y + 1);
  ctx.fillStyle = fill;
  ctx.fillText(String(value), x, y + 1);
  ctx.textBaseline = 'alphabetic';
}

// Pièce dorée portant le coût.
function drawCostCoin(ctx: CanvasRenderingContext2D, x: number, y: number, cost: number): void {
  const gradient = ctx.createRadialGradient(x - 7, y - 8, 2, x, y, 24);
  gradient.addColorStop(0, theme.colors.goldLight);
  gradient.addColorStop(0.55, theme.colors.gold);
  gradient.addColorStop(1, theme.colors.goldDark);
  ctx.beginPath();
  ctx.arc(x, y, 23, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = theme.colors.goldDark;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, 17, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(122, 90, 12, 0.5)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  outlinedNumber(ctx, cost, x, y, 26, '#ffffff');
}

// Attaque : médaillon rouge avec une épée en filigrane.
function drawAttackStat(ctx: CanvasRenderingContext2D, x: number, y: number, value: number, tone: StatTone): void {
  const gradient = ctx.createRadialGradient(x - 6, y - 8, 2, x, y, 28);
  gradient.addColorStop(0, '#f07a5a');
  gradient.addColorStop(1, theme.colors.attackBadge);
  ctx.beginPath();
  ctx.arc(x, y, 26, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = theme.colors.goldDark;
  ctx.stroke();
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-Math.PI / 4);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.fillRect(-2.5, -20, 5, 30);
  ctx.fillRect(-10, 8, 20, 4);
  ctx.fillRect(-2, 12, 4, 8);
  ctx.restore();
  outlinedNumber(ctx, value, x, y, 28, toneColor(tone));
}

// Défense : écu bleu.
function drawDefenseStat(ctx: CanvasRenderingContext2D, x: number, y: number, value: number, tone: StatTone): void {
  ctx.beginPath();
  ctx.moveTo(x - 24, y - 26);
  ctx.lineTo(x + 24, y - 26);
  ctx.lineTo(x + 24, y - 2);
  ctx.bezierCurveTo(x + 24, y + 16, x + 10, y + 24, x, y + 30);
  ctx.bezierCurveTo(x - 10, y + 24, x - 24, y + 16, x - 24, y - 2);
  ctx.closePath();
  const gradient = ctx.createLinearGradient(x, y - 26, x, y + 30);
  gradient.addColorStop(0, '#6f95f5');
  gradient.addColorStop(1, theme.colors.defenseBadge);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = theme.colors.goldDark;
  ctx.stroke();
  outlinedNumber(ctx, value, x, y - 1, 28, toneColor(tone));
}

interface TextRun {
  text: string;
  bold: boolean;
}

// Découpe des segments (gras / normal) en lignes tenant dans `maxWidth`.
function layoutRuns(ctx: CanvasRenderingContext2D, runs: TextRun[], size: number, maxWidth: number): TextRun[][][] {
  const words: TextRun[] = runs.flatMap((run) =>
    run.text.split(' ').filter(Boolean).map((text) => ({ text, bold: run.bold })),
  );
  const lines: TextRun[][][] = [];
  let current: TextRun[] = [];
  let width = 0;
  const measure = (word: TextRun) => {
    ctx.font = `${word.bold ? 700 : 500} ${size}px ${BODY_FONT}`;
    return ctx.measureText(word.text).width;
  };
  ctx.font = `500 ${size}px ${BODY_FONT}`;
  const space = ctx.measureText(' ').width;
  for (const word of words) {
    const w = measure(word);
    if (current.length > 0 && width + space + w > maxWidth) {
      lines.push([current]);
      current = [];
      width = 0;
    }
    width += (current.length > 0 ? space : 0) + w;
    current.push(word);
  }
  if (current.length > 0) lines.push([current]);
  return lines;
}

// Encadré parchemin listant des paragraphes (effet d'enchantement, aura, capacités), le
// déclencheur en gras. La taille du texte diminue jusqu'à ce que tout tienne.
function drawTextBox(ctx: CanvasRenderingContext2D, w: number, paragraphs: TextRun[][], top: number, bottom: number): void {
  const x = 22;
  const boxWidth = w - 44;
  roundedRectPath(ctx, x, top, boxWidth, bottom - top, 10);
  const parchment = ctx.createLinearGradient(0, top, 0, bottom);
  parchment.addColorStop(0, theme.colors.parchmentLight);
  parchment.addColorStop(1, theme.colors.parchment);
  ctx.fillStyle = parchment;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(90, 60, 20, 0.55)';
  ctx.stroke();
  if (paragraphs.length === 0) return;

  const available = bottom - top - 16;
  let size = 16;
  let laidOut: TextRun[][][][] = [];
  let lineHeight = 0;
  let gap = 0;
  let totalHeight = 0;
  for (; size >= 10; size -= 1) {
    lineHeight = Math.round(size * 1.25);
    gap = Math.round(size * 0.45);
    laidOut = paragraphs.map((runs) => layoutRuns(ctx, runs, size, boxWidth - 24));
    const lineCount = laidOut.reduce((n, p) => n + p.length, 0);
    totalHeight = lineCount * lineHeight + (paragraphs.length - 1) * gap;
    if (totalHeight <= available) break;
  }

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = theme.colors.inkOnParchment;
  let y = top + (bottom - top) / 2 - totalHeight / 2 + lineHeight / 2;
  laidOut.forEach((paragraph, index) => {
    if (index > 0) {
      // Fin séparateur entre deux paragraphes.
      ctx.fillStyle = 'rgba(90, 60, 20, 0.25)';
      ctx.fillRect(w / 2 - 40, y - lineHeight / 2 - gap / 2, 80, 1);
      ctx.fillStyle = theme.colors.inkOnParchment;
    }
    for (const [words] of paragraph) {
      const widths = words.map((word) => {
        ctx.font = `${word.bold ? 700 : 500} ${size}px ${BODY_FONT}`;
        return ctx.measureText(word.text).width;
      });
      ctx.font = `500 ${size}px ${BODY_FONT}`;
      const space = ctx.measureText(' ').width;
      const lineWidth = widths.reduce((a, b) => a + b, 0) + space * (words.length - 1);
      let cursor = w / 2 - lineWidth / 2;
      words.forEach((word, i) => {
        ctx.font = `${word.bold ? 700 : 500} ${size}px ${BODY_FONT}`;
        ctx.fillText(word.text, cursor, y);
        cursor += widths[i] + space;
      });
      y += lineHeight;
    }
    y += gap;
  });
  ctx.textBaseline = 'alphabetic';
}

// « Invoqué : +1 pièce » → déclencheur en gras, effet normal.
function abilityRuns(ability: CardAbility): TextRun[] {
  const full = describeAbility(ability);
  const trigger = TRIGGER_LABELS[ability.trigger];
  const splitAt = full.indexOf(' : ');
  if (splitAt === -1 || !full.startsWith(trigger)) return [{ text: full, bold: false }];
  return [
    { text: full.slice(0, splitAt + 2), bold: true },
    { text: full.slice(splitAt + 3), bold: false },
  ];
}

// « Portée : touche aussi… » → nom de l'habileté en gras, effet normal (même forme qu'une
// capacité, pour que la face reste homogène).
function keywordRuns(keyword: Keyword, golden: boolean): TextRun[] {
  return [
    { text: `${KEYWORD_LABELS[keyword]} :`, bold: true },
    { text: describeKeywordEffect(keyword, golden), bold: false },
  ];
}

// Fond de la carte : cadre sombre teinté par l'élément, panneau intérieur en dégradé.
function drawFrame(ctx: CanvasRenderingContext2D, element: CardElement, w: number, h: number, golden: boolean): void {
  const palette = theme.elements[element];
  ctx.fillStyle = palette.badge;
  ctx.fillRect(0, 0, w, h);

  roundedRectPath(ctx, 10, 10, w - 20, h - 20, 16);
  const inner = ctx.createLinearGradient(0, 0, 0, h);
  inner.addColorStop(0, palette.light);
  inner.addColorStop(0.5, palette.base);
  inner.addColorStop(1, palette.badge);
  ctx.fillStyle = inner;
  ctx.fill();

  // Motif discret de losanges sur le panneau.
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let d = -h; d < w + h; d += 18) {
    ctx.moveTo(d, 0);
    ctx.lineTo(d + h, h);
    ctx.moveTo(d, h);
    ctx.lineTo(d + h, 0);
  }
  ctx.stroke();
  ctx.restore();

  const border = ctx.createLinearGradient(0, 0, w, h);
  if (golden) {
    border.addColorStop(0, theme.colors.goldLight);
    border.addColorStop(0.35, theme.colors.gold);
    border.addColorStop(0.5, theme.colors.goldLight);
    border.addColorStop(0.65, theme.colors.gold);
    border.addColorStop(1, theme.colors.goldDark);
  } else {
    border.addColorStop(0, 'rgba(255, 255, 255, 0.55)');
    border.addColorStop(1, 'rgba(255, 255, 255, 0.12)');
  }
  roundedRectPath(ctx, golden ? 8 : 10, golden ? 8 : 10, w - (golden ? 16 : 20), h - (golden ? 16 : 20), 16);
  ctx.lineWidth = golden ? 14 : 2.5;
  ctx.strokeStyle = border;
  ctx.stroke();
}

// Bandeau du nom, façon plaque de parchemin.
function drawNamePlate(ctx: CanvasRenderingContext2D, name: string, w: number): void {
  roundedRectPath(ctx, 52, 16, w - 104, 36, 8);
  const gradient = ctx.createLinearGradient(0, 16, 0, 52);
  gradient.addColorStop(0, theme.colors.parchmentLight);
  gradient.addColorStop(1, theme.colors.parchment);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = theme.colors.goldDark;
  ctx.stroke();

  ctx.fillStyle = theme.colors.inkOnParchment;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = 19;
  ctx.font = `700 ${size}px ${DISPLAY_FONT}`;
  while (size > 12 && ctx.measureText(name).width > w - 120) {
    size -= 1;
    ctx.font = `700 ${size}px ${DISPLAY_FONT}`;
  }
  ctx.fillText(name, w / 2, 35);
  ctx.textBaseline = 'alphabetic';
}

// Fenêtre d'illustration encadrée.
function drawArtWindow(ctx: CanvasRenderingContext2D, def: CardDef): void {
  ctx.save();
  roundedRectPath(ctx, ART_X, ART_Y, ART_WIDTH, ART_HEIGHT, 8);
  ctx.clip();
  drawCardArt(ctx, def.id, def.element, ART_X, ART_Y);
  ctx.restore();
  roundedRectPath(ctx, ART_X, ART_Y, ART_WIDTH, ART_HEIGHT, 8);
  ctx.lineWidth = 3;
  ctx.strokeStyle = theme.colors.goldDark;
  ctx.stroke();
}

// Petit bandeau de type (« Monstre », « Enchantement »…) à cheval sur le bas de l'illustration.
function drawTypeBanner(ctx: CanvasRenderingContext2D, label: string, w: number, golden: boolean): void {
  const y = ART_Y + ART_HEIGHT - 11;
  ctx.font = `700 11px ${DISPLAY_FONT}`;
  const width = Math.max(110, ctx.measureText(label).width + 36);
  roundedRectPath(ctx, w / 2 - width / 2, y, width, 20, 10);
  ctx.fillStyle = golden ? theme.colors.goldDark : 'rgba(15, 12, 10, 0.85)';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = golden ? theme.colors.goldLight : theme.colors.gold;
  ctx.stroke();
  ctx.fillStyle = golden ? theme.colors.goldLight : '#f3e6c8';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, w / 2, y + 10.5);
  ctx.textBaseline = 'alphabetic';
}

// Petit logo vectoriel de l'élément (tracés Canvas, aucune police ni image : D5), centré sur
// (cx, cy) dans un carré d'environ 36 px de côté.
function drawElementIcon(ctx: CanvasRenderingContext2D, element: CardElement, cx: number, cy: number): void {
  const { icon, badge } = theme.elements[element];
  ctx.fillStyle = icon;
  ctx.strokeStyle = icon;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (element) {
    case 'fire': {
      ctx.beginPath();
      ctx.moveTo(cx, cy - 18);
      ctx.bezierCurveTo(cx + 4, cy - 8, cx + 14, cy - 4, cx + 12, cy + 6);
      ctx.bezierCurveTo(cx + 11, cy + 14, cx + 5, cy + 17, cx, cy + 17);
      ctx.bezierCurveTo(cx - 5, cy + 17, cx - 11, cy + 14, cx - 12, cy + 6);
      ctx.bezierCurveTo(cx - 13, cy - 2, cx - 6, cy - 4, cx - 5, cy - 11);
      ctx.bezierCurveTo(cx - 1, cy - 7, cx - 1, cy - 12, cx, cy - 18);
      ctx.fill();
      // Cœur de la flamme, dans la couleur de la pastille.
      ctx.fillStyle = badge;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.bezierCurveTo(cx + 3, cy + 5, cx + 6, cy + 7, cx + 5, cy + 11);
      ctx.bezierCurveTo(cx + 4, cy + 14, cx - 4, cy + 14, cx - 5, cy + 11);
      ctx.bezierCurveTo(cx - 6, cy + 7, cx - 2, cy + 5, cx, cy);
      ctx.fill();
      break;
    }
    case 'water': {
      ctx.beginPath();
      ctx.moveTo(cx, cy - 18);
      ctx.bezierCurveTo(cx + 6, cy - 8, cx + 13, cy - 1, cx + 13, cy + 5);
      ctx.bezierCurveTo(cx + 13, cy + 13, cx + 7, cy + 17, cx, cy + 17);
      ctx.bezierCurveTo(cx - 7, cy + 17, cx - 13, cy + 13, cx - 13, cy + 5);
      ctx.bezierCurveTo(cx - 13, cy - 1, cx - 6, cy - 8, cx, cy - 18);
      ctx.fill();
      // Reflet.
      ctx.strokeStyle = badge;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy + 5, 7, Math.PI * 0.6, Math.PI * 0.95);
      ctx.stroke();
      break;
    }
    case 'air': {
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(cx - 15, cy - 7);
      ctx.lineTo(cx + 5, cy - 7);
      ctx.arc(cx + 5, cy - 12, 5, Math.PI / 2, Math.PI * 1.1, true);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - 17, cy + 1);
      ctx.lineTo(cx + 14, cy + 1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - 12, cy + 9);
      ctx.lineTo(cx + 2, cy + 9);
      ctx.arc(cx + 2, cy + 13, 4, -Math.PI / 2, Math.PI * 0.9);
      ctx.stroke();
      break;
    }
    case 'earth': {
      ctx.beginPath();
      ctx.moveTo(cx - 17, cy + 13);
      ctx.lineTo(cx - 4, cy - 12);
      ctx.lineTo(cx + 3, cy + 1);
      ctx.lineTo(cx + 8, cy - 5);
      ctx.lineTo(cx + 17, cy + 13);
      ctx.closePath();
      ctx.fill();
      // Neige du grand sommet.
      ctx.fillStyle = badge;
      ctx.beginPath();
      ctx.moveTo(cx - 4, cy - 12);
      ctx.lineTo(cx - 8, cy - 4);
      ctx.lineTo(cx - 4, cy - 6);
      ctx.lineTo(cx - 1, cy - 4);
      ctx.closePath();
      ctx.fill();
      break;
    }
  }
}

// Pastille ronde portant le logo de l'élément.
function drawElementBadge(ctx: CanvasRenderingContext2D, element: CardElement, x: number, y: number): void {
  ctx.beginPath();
  ctx.arc(x, y, 23, 0, Math.PI * 2);
  ctx.fillStyle = theme.elements[element].badge;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = theme.colors.gold;
  ctx.stroke();
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(0.85, 0.85);
  drawElementIcon(ctx, element, 0, 0);
  ctx.restore();
}

function makeTexture(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_WIDTH * TEXTURE_SCALE;
  canvas.height = TEXTURE_HEIGHT * TEXTURE_SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponible');

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  const render = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(TEXTURE_SCALE, TEXTURE_SCALE);
    // Coins arrondis transparents : tout ce qui est dessiné hors de ce tracé reste invisible
    // grâce à `alphaTest` sur le matériau (voir Card.tsx).
    roundedRectPath(ctx, 3, 3, TEXTURE_WIDTH - 6, TEXTURE_HEIGHT - 6, 18);
    ctx.clip();
    draw(ctx, TEXTURE_WIDTH, TEXTURE_HEIGHT);
    ctx.restore();
    texture.needsUpdate = true;
  };
  render();
  redraws.push(render);
  watchFontLoading();
  return texture;
}

// Les textures dessinées avant l'arrivée des polices web sont redessinées une fois chargées.
let watchingFonts = false;
function watchFontLoading(): void {
  if (watchingFonts || typeof document === 'undefined' || !document.fonts) return;
  watchingFonts = true;
  const redrawAll = () => redraws.forEach((render) => render());
  document.fonts.addEventListener('loadingdone', redrawAll);
  void Promise.all([
    document.fonts.load(`700 19px ${DISPLAY_FONT}`),
    document.fonts.load(`500 16px ${BODY_FONT}`),
    document.fonts.load(`700 16px ${BODY_FONT}`),
    document.fonts.load(`800 28px ${BODY_FONT}`),
  ]).then(redrawAll, () => {});
}

// `stats` est `null` pour un enchantement (§6.3/§6.4). Clé de cache :
// `id:att:déf:tonAtt:tonDéf:doré` pour un monstre, `id` pour un enchantement.
export function getCardFaceTexture(def: CardDef, stats: MonsterFaceStats | null): THREE.CanvasTexture {
  const key =
    def.kind === 'monster' && stats
      ? `${def.id}:${stats.attack}:${stats.defense}:${stats.attackTone}:${stats.defenseTone}:${stats.golden}`
      : def.id;
  const cached = faceCache.get(key);
  if (cached) return cached;

  const texture = makeTexture((ctx, w, h) => {
    if (def.kind === 'enchantment') {
      drawFrame(ctx, def.element, w, h, false);
      drawArtWindow(ctx, def);
      drawNamePlate(ctx, def.name, w);
      drawCostCoin(ctx, 32, 34, def.cost);
      drawElementBadge(ctx, def.element, w - 32, 34);
      drawTypeBanner(ctx, 'Enchantement', w, false);

      // Effet permanent, puis capacités (déclencheur → effet) (§6.1).
      const paragraphs: TextRun[][] = [
        [{ text: describeEffect(def.effect), bold: false }],
        ...(def.abilities ?? []).map(abilityRuns),
      ];
      drawTextBox(ctx, w, paragraphs, TEXT_BOX_TOP, h - 22);
      return;
    }

    const golden = stats?.golden ?? false;
    drawFrame(ctx, def.element, w, h, golden);
    drawArtWindow(ctx, def);
    drawNamePlate(ctx, def.name, w);
    drawCostCoin(ctx, 32, 34, def.cost);
    drawElementBadge(ctx, def.element, w - 32, 34);
    drawTypeBanner(ctx, golden ? '★ Monstre doré ★' : 'Monstre', w, golden);

    // Habiletés, puis aura, puis capacités. Monstre doré : valeurs affichées doublées, comme
    // elles se résolvent (Portée n'est pas doublée mais gagne 1 dégât, `describeKeywordEffect`).
    const multiplier = golden ? GOLDEN_MULTIPLIER : 1;
    const paragraphs: TextRun[][] = (def.abilities ?? []).map((ability) =>
      abilityRuns({ ...ability, effect: scaleAbilityEffect(ability.effect, multiplier) }),
    );
    for (const keyword of [...(def.keywords ?? [])].reverse()) {
      paragraphs.unshift(keywordRuns(keyword, golden));
    }
    if (def.aura) {
      paragraphs.unshift([
        { text: 'Aura :', bold: true },
        { text: describeAura({ attack: def.aura.attack * multiplier, defense: def.aura.defense * multiplier }), bold: false },
      ]);
    }
    drawTextBox(ctx, w, paragraphs, TEXT_BOX_TOP, h - 62);

    const attack = stats?.attack ?? def.attack;
    const defense = stats?.defense ?? def.defense;
    drawAttackStat(ctx, 44, h - 40, attack, stats?.attackTone ?? 'base');
    drawDefenseStat(ctx, w - 44, h - 42, defense, stats?.defenseTone ?? 'base');
  });

  faceCache.set(key, texture);
  return texture;
}

export function getCardBackTexture(): THREE.CanvasTexture {
  if (backTextureCache) return backTextureCache;

  backTextureCache = makeTexture((ctx, w, h) => {
    const gradient = ctx.createRadialGradient(w / 2, h / 2, 20, w / 2, h / 2, h * 0.7);
    gradient.addColorStop(0, '#3a4256');
    gradient.addColorStop(1, theme.colors.cardBack);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    // Motif de losanges.
    ctx.strokeStyle = 'rgba(201, 164, 65, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let d = -h; d < w + h; d += 22) {
      ctx.moveTo(d, 0);
      ctx.lineTo(d + h, h);
      ctx.moveTo(d, h);
      ctx.lineTo(d + h, 0);
    }
    ctx.stroke();

    roundedRectPath(ctx, 14, 14, w - 28, h - 28, 12);
    ctx.lineWidth = 4;
    ctx.strokeStyle = theme.colors.gold;
    ctx.stroke();
    roundedRectPath(ctx, 24, 24, w - 48, h - 48, 8);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(201, 164, 65, 0.6)';
    ctx.stroke();

    // Emblème central : losange doré et étoile.
    const cx = w / 2;
    const cy = h / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 62);
    ctx.lineTo(cx + 44, cy);
    ctx.lineTo(cx, cy + 62);
    ctx.lineTo(cx - 44, cy);
    ctx.closePath();
    ctx.fillStyle = 'rgba(15, 17, 21, 0.6)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = theme.colors.gold;
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 24 : 10;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fillStyle = theme.colors.goldLight;
    ctx.fill();
  });

  return backTextureCache;
}

// Image PNG de la même face que celle affichée sur la carte 3D (§6.3), pour le zoom HTML au
// clic sur une carte du board : garantit que le zoom montre exactement les mêmes chiffres,
// sans dupliquer le dessin.
export function getCardFaceDataUrl(def: CardDef, stats: MonsterFaceStats | null): string {
  return getCardFaceTexture(def, stats).image.toDataURL('image/png');
}

// ---------------------------------------------------------------------------------------
// Emblème de bouclier (K3 Protection) posé au-dessus d'un monstre dont la protection est
// encore intacte (demande utilisateur) — voir `Card.tsx`. Un seul canvas, mis en cache.
// ---------------------------------------------------------------------------------------

const SHIELD_TEXTURE_SIZE = 256;
let shieldTextureCache: THREE.CanvasTexture | null = null;

function shieldPath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(128, 34);
  ctx.lineTo(212, 62);
  ctx.bezierCurveTo(212, 150, 184, 196, 128, 224);
  ctx.bezierCurveTo(72, 196, 44, 150, 44, 62);
  ctx.closePath();
}

export function getShieldTexture(): THREE.CanvasTexture {
  if (shieldTextureCache) return shieldTextureCache;

  const canvas = document.createElement('canvas');
  canvas.width = SHIELD_TEXTURE_SIZE;
  canvas.height = SHIELD_TEXTURE_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponible');

  // Halo diffus : le bouclier reste visible même par-dessus une illustration claire.
  const glow = ctx.createRadialGradient(128, 128, 20, 128, 128, 126);
  glow.addColorStop(0, 'rgba(150, 220, 255, 0.55)');
  glow.addColorStop(0.55, 'rgba(90, 170, 255, 0.28)');
  glow.addColorStop(1, 'rgba(90, 170, 255, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, SHIELD_TEXTURE_SIZE, SHIELD_TEXTURE_SIZE);

  // Plaque du bouclier, translucide pour laisser deviner la carte au travers.
  const plate = ctx.createLinearGradient(0, 30, 0, 226);
  plate.addColorStop(0, 'rgba(226, 246, 255, 0.92)');
  plate.addColorStop(0.45, 'rgba(120, 190, 250, 0.78)');
  plate.addColorStop(1, 'rgba(46, 104, 190, 0.85)');
  ctx.fillStyle = plate;
  shieldPath(ctx);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.lineWidth = 9;
  ctx.lineJoin = 'round';
  shieldPath(ctx);
  ctx.stroke();

  // Croix centrale + reflet, pour lire l'emblème même en tout petit sur la table.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.fillRect(120, 72, 16, 110);
  ctx.fillRect(84, 108, 88, 16);
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(128, 40);
  ctx.lineTo(196, 64);
  ctx.bezierCurveTo(196, 110, 186, 146, 128, 176);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  shieldTextureCache = texture;
  return texture;
}
