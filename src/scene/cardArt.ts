import type { CardElement } from '../game/types';
import { theme } from './theme';

// Petites illustrations des cartes, dessinées en tracés Canvas 2D (aucune image à charger,
// D5) : un décor aux couleurs de l'élément puis une silhouette propre à chaque carte.
// Coordonnées dans une fenêtre de ART_WIDTH × ART_HEIGHT, sol à GROUND_Y.

export const ART_WIDTH = 256;
export const ART_HEIGHT = 160;
const GROUND_Y = 138;
const GOLD = '#f5c542';
const WINDOW_LIGHT = '#ffd27a';

type Ctx = CanvasRenderingContext2D;

function poly(ctx: Ctx, points: number[]): void {
  ctx.beginPath();
  ctx.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
  ctx.closePath();
  ctx.fill();
}

function circle(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number, rotation = 0): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rotation, 0, Math.PI * 2);
  ctx.fill();
}

function line(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, width: number): void {
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

interface ArtColors {
  ink: string; // silhouette
  light: string; // détails éclairés (lames, yeux, reflets)
  accent: string; // détails colorés (flammes, feuilles, pièces)
}

// Décor : ciel en dégradé, halo du soleil, collines lointaines et sol.
function drawScenery(ctx: Ctx, element: CardElement): void {
  const art = theme.art[element];
  const sky = ctx.createLinearGradient(0, 0, 0, ART_HEIGHT);
  sky.addColorStop(0, art.skyTop);
  sky.addColorStop(0.7, art.skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, ART_WIDTH, ART_HEIGHT);

  const glow = ctx.createRadialGradient(188, 48, 4, 188, 48, 90);
  glow.addColorStop(0, art.sun);
  glow.addColorStop(0.18, art.sun);
  glow.addColorStop(0.2, 'rgba(255, 255, 255, 0.35)');
  glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, ART_WIDTH, ART_HEIGHT);

  ctx.fillStyle = art.hills;
  ctx.beginPath();
  ctx.moveTo(0, 116);
  ctx.bezierCurveTo(40, 92, 80, 100, 110, 112);
  ctx.bezierCurveTo(150, 90, 200, 88, 256, 108);
  ctx.lineTo(256, ART_HEIGHT);
  ctx.lineTo(0, ART_HEIGHT);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = art.ground;
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y);
  ctx.bezierCurveTo(80, GROUND_Y - 6, 170, GROUND_Y + 4, 256, GROUND_Y - 3);
  ctx.lineTo(256, ART_HEIGHT);
  ctx.lineTo(0, ART_HEIGHT);
  ctx.closePath();
  ctx.fill();
}

type Drawer = (ctx: Ctx, c: ArtColors) => void;

const DRAWERS: Record<string, Drawer> = {
  squire(ctx, c) {
    ctx.fillStyle = c.ink;
    poly(ctx, [117, 108, 126, 108, 124, 138, 115, 138]);
    poly(ctx, [130, 108, 139, 108, 142, 138, 133, 138]);
    poly(ctx, [112, 76, 144, 76, 147, 112, 109, 112]);
    circle(ctx, 128, 62, 12);
    poly(ctx, [113, 64, 143, 64, 139, 55, 117, 55]);
    poly(ctx, [142, 80, 160, 60, 166, 65, 148, 90]);
    // Épée levée.
    ctx.strokeStyle = c.light;
    ctx.lineCap = 'round';
    line(ctx, 163, 62, 180, 24, 5);
    line(ctx, 154, 58, 172, 66, 4);
    // Bouclier rond.
    ctx.fillStyle = c.ink;
    circle(ctx, 106, 98, 18);
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(106, 98, 12, 0, Math.PI * 2);
    ctx.stroke();
  },

  wolf(ctx, c) {
    ctx.fillStyle = c.ink;
    poly(ctx, [66, 136, 48, 122, 56, 116, 80, 128]); // queue
    poly(ctx, [
      84, 138, 88, 110, 100, 94, 116, 84, 128, 72, 134, 56, 132, 40, 140, 48, 146, 44, 166, 28, 170, 34, 156, 56,
      152, 70, 148, 86, 152, 108, 158, 138, 146, 138, 142, 118, 130, 122, 120, 138,
    ]);
    poly(ctx, [132, 44, 128, 26, 142, 46]); // oreille
    ctx.fillStyle = c.light;
    circle(ctx, 146, 48, 2);
  },

  guard(ctx, c) {
    // Arche du pont.
    ctx.fillStyle = c.ink;
    ctx.beginPath();
    ctx.moveTo(0, 128);
    ctx.lineTo(256, 128);
    ctx.lineTo(256, 160);
    ctx.lineTo(210, 160);
    ctx.quadraticCurveTo(128, 120, 46, 160);
    ctx.lineTo(0, 160);
    ctx.closePath();
    ctx.fill();
    poly(ctx, [116, 128, 124, 100, 136, 100, 142, 128]);
    poly(ctx, [114, 66, 144, 66, 146, 104, 112, 104]);
    circle(ctx, 130, 54, 11);
    poly(ctx, [117, 54, 143, 54, 138, 41, 122, 41]);
    // Lance.
    ctx.strokeStyle = c.ink;
    ctx.lineCap = 'round';
    line(ctx, 156, 128, 156, 26, 4);
    ctx.fillStyle = c.light;
    poly(ctx, [156, 12, 162, 30, 150, 30]);
    // Grand bouclier.
    ctx.fillStyle = c.ink;
    poly(ctx, [94, 64, 126, 64, 126, 112, 110, 124, 94, 112]);
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(110, 72);
    ctx.lineTo(110, 112);
    ctx.moveTo(100, 88);
    ctx.lineTo(120, 88);
    ctx.stroke();
  },

  archer(ctx, c) {
    ctx.fillStyle = c.ink;
    circle(ctx, 110, 58, 10);
    poly(ctx, [100, 50, 118, 44, 114, 56]); // capuche
    poly(ctx, [101, 70, 119, 70, 124, 108, 98, 108]);
    poly(ctx, [100, 106, 110, 106, 100, 138, 90, 138]);
    poly(ctx, [114, 106, 124, 106, 136, 138, 126, 138]);
    ctx.strokeStyle = c.ink;
    ctx.lineCap = 'round';
    line(ctx, 116, 78, 150, 76, 6);
    line(ctx, 112, 80, 126, 78, 6);
    // Arc et corde.
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(142, 77, 34, -1.1, 1.1);
    ctx.stroke();
    ctx.strokeStyle = c.light;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(157, 46);
    ctx.lineTo(124, 78);
    ctx.lineTo(157, 108);
    ctx.stroke();
    line(ctx, 124, 78, 196, 78, 2.5);
    ctx.fillStyle = c.light;
    poly(ctx, [204, 78, 194, 73, 194, 83]);
  },

  knight(ctx, c) {
    ctx.fillStyle = c.ink;
    poly(ctx, [104, 66, 92, 136, 118, 128]); // cape
    poly(ctx, [106, 64, 150, 64, 146, 108, 110, 108]);
    poly(ctx, [112, 106, 126, 106, 124, 138, 110, 138]);
    poly(ctx, [130, 106, 144, 106, 146, 138, 132, 138]);
    circle(ctx, 128, 48, 14);
    poly(ctx, [114, 48, 142, 48, 142, 62, 114, 62]);
    ctx.fillStyle = c.accent;
    poly(ctx, [124, 36, 132, 14, 150, 22, 136, 38]); // plumet
    // Visière.
    ctx.fillStyle = c.light;
    ctx.fillRect(118, 47, 20, 3);
    // Épée plantée devant lui.
    ctx.fillRect(126, 78, 5, 60);
    ctx.fillRect(114, 74, 29, 5);
    ctx.fillStyle = c.ink;
    circle(ctx, 128, 70, 6);
  },

  golem(ctx, c) {
    ctx.fillStyle = c.ink;
    poly(ctx, [100, 108, 124, 108, 122, 138, 98, 138]);
    poly(ctx, [134, 108, 158, 106, 162, 138, 138, 138]);
    poly(ctx, [74, 64, 96, 60, 100, 118, 72, 124]);
    poly(ctx, [160, 58, 184, 62, 190, 118, 164, 114]);
    poly(ctx, [90, 60, 166, 54, 172, 110, 86, 114]);
    poly(ctx, [114, 30, 144, 28, 148, 58, 112, 60]);
    ctx.fillStyle = c.accent;
    circle(ctx, 123, 44, 3.5);
    circle(ctx, 138, 43, 3.5);
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(118, 70);
    ctx.lineTo(128, 84);
    ctx.lineTo(122, 96);
    ctx.moveTo(150, 72);
    ctx.lineTo(144, 88);
    ctx.stroke();
  },

  drake(ctx, c) {
    ctx.fillStyle = c.ink;
    poly(ctx, [100, 88, 70, 104, 36, 100, 64, 94, 98, 78]); // queue
    ellipse(ctx, 124, 86, 34, 14, -0.15);
    poly(ctx, [146, 80, 168, 56, 184, 52, 196, 58, 182, 64, 170, 66, 158, 92]);
    poly(ctx, [174, 54, 178, 42, 184, 52]); // corne
    poly(ctx, [110, 94, 104, 116, 112, 116, 118, 96]);
    poly(ctx, [136, 94, 138, 116, 146, 116, 142, 92]);
    // Ailes déployées.
    poly(ctx, [112, 80, 76, 22, 94, 34, 102, 20, 116, 38, 126, 24, 136, 78]);
    ctx.globalAlpha = 0.75;
    poly(ctx, [126, 78, 150, 18, 156, 36, 170, 30, 160, 60, 144, 84]);
    ctx.globalAlpha = 1;
    ctx.fillStyle = c.light;
    circle(ctx, 182, 57, 2);
    // Souffle de feu.
    ctx.fillStyle = c.accent;
    poly(ctx, [196, 60, 236, 50, 222, 62, 246, 66, 220, 72, 232, 82]);
  },

  titan(ctx, c) {
    ctx.fillStyle = c.ink;
    poly(ctx, [76, 120, 92, 62, 164, 62, 180, 120]);
    circle(ctx, 128, 44, 17);
    poly(ctx, [84, 70, 60, 98, 70, 104, 98, 82]);
    poly(ctx, [158, 68, 188, 44, 196, 52, 170, 82]);
    // Trident.
    ctx.strokeStyle = c.light;
    ctx.lineCap = 'round';
    line(ctx, 194, 20, 194, 120, 4);
    ctx.beginPath();
    ctx.moveTo(182, 18);
    ctx.quadraticCurveTo(182, 34, 194, 34);
    ctx.quadraticCurveTo(206, 34, 206, 18);
    ctx.stroke();
    poly(ctx, [100, 66, 156, 66, 150, 58, 106, 58]); // épaules
    ctx.fillStyle = c.accent;
    circle(ctx, 122, 42, 2.5);
    circle(ctx, 134, 42, 2.5);
    // Couronne.
    ctx.fillStyle = c.light;
    poly(ctx, [112, 32, 112, 18, 119, 26, 128, 14, 137, 26, 144, 18, 144, 32]);
    // Vagues devant lui.
    ctx.fillStyle = theme.art.water.skyBottom;
    ctx.beginPath();
    ctx.moveTo(0, 116);
    for (let x = 0; x <= 256; x += 32) {
      ctx.quadraticCurveTo(x + 16, 104, x + 32, 116);
    }
    ctx.lineTo(256, 160);
    ctx.lineTo(0, 160);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x <= 256; x += 32) {
      ctx.moveTo(x, 116);
      ctx.quadraticCurveTo(x + 16, 104, x + 32, 116);
    }
    ctx.stroke();
  },

  druid(ctx, c) {
    // Arbre.
    ctx.fillStyle = c.ink;
    ctx.globalAlpha = 0.55;
    poly(ctx, [52, 138, 56, 80, 64, 80, 68, 138]);
    circle(ctx, 60, 70, 22);
    circle(ctx, 42, 84, 16);
    circle(ctx, 78, 86, 16);
    ctx.globalAlpha = 1;
    poly(ctx, [106, 138, 116, 72, 140, 72, 152, 138]);
    poly(ctx, [112, 76, 128, 44, 144, 76]);
    poly(ctx, [138, 86, 160, 72, 162, 80, 144, 96]);
    ctx.strokeStyle = c.ink;
    ctx.lineCap = 'round';
    line(ctx, 162, 138, 162, 44, 4);
    ctx.fillStyle = c.accent;
    ellipse(ctx, 156, 40, 8, 4, -0.6);
    ellipse(ctx, 169, 38, 8, 4, 0.6);
    ellipse(ctx, 162, 30, 4, 8, 0);
    ctx.fillStyle = c.light;
    circle(ctx, 124, 66, 1.8);
    circle(ctx, 132, 66, 1.8);
  },

  stormMage(ctx, c) {
    // Nuage d'orage.
    ctx.fillStyle = 'rgba(40, 50, 60, 0.75)';
    circle(ctx, 176, 30, 18);
    circle(ctx, 198, 26, 22);
    circle(ctx, 222, 32, 16);
    ctx.fillRect(176, 30, 46, 18);
    ctx.fillStyle = c.ink;
    poly(ctx, [102, 138, 116, 76, 140, 76, 156, 138]);
    ellipse(ctx, 128, 76, 26, 5);
    poly(ctx, [112, 76, 124, 22, 146, 76]);
    poly(ctx, [136, 88, 160, 62, 166, 68, 146, 98]);
    // Éclair.
    ctx.fillStyle = c.accent;
    poly(ctx, [198, 46, 184, 64, 194, 64, 174, 90, 166, 64, 176, 66, 186, 46]);
    ctx.fillStyle = c.light;
    circle(ctx, 124, 84, 1.8);
    circle(ctx, 132, 84, 1.8);
  },

  peddler(ctx, c) {
    ctx.fillStyle = c.ink;
    // Gros ballot sur le dos.
    ctx.beginPath();
    ctx.roundRect(84, 54, 38, 56, 10);
    ctx.fill();
    poly(ctx, [118, 70, 140, 70, 144, 110, 116, 110]);
    circle(ctx, 134, 58, 10);
    ellipse(ctx, 134, 52, 18, 4);
    poly(ctx, [126, 46, 132, 38, 142, 46]);
    poly(ctx, [120, 108, 130, 108, 116, 138, 106, 138]);
    poly(ctx, [132, 108, 142, 108, 152, 138, 142, 138]);
    poly(ctx, [138, 78, 156, 92, 152, 98, 134, 88]);
    ctx.strokeStyle = c.ink;
    ctx.lineCap = 'round';
    line(ctx, 154, 138, 160, 70, 3);
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(90, 72);
    ctx.lineTo(116, 72);
    ctx.moveTo(90, 94);
    ctx.lineTo(116, 94);
    ctx.stroke();
    // Casserole et lanterne accrochées.
    ctx.fillStyle = c.ink;
    circle(ctx, 88, 118, 8);
    ctx.fillStyle = c.accent;
    circle(ctx, 162, 80, 5);
  },

  // --- v12 : cartes bâties autour d'une habileté (voir cards.ts) ---

  harpooner(ctx, c) {
    ctx.fillStyle = c.ink;
    poly(ctx, [108, 106, 120, 106, 116, 138, 104, 138]);
    poly(ctx, [124, 106, 136, 106, 142, 138, 130, 138]);
    poly(ctx, [106, 70, 140, 70, 144, 110, 104, 110]);
    circle(ctx, 124, 58, 11);
    poly(ctx, [111, 54, 138, 50, 134, 40, 116, 44]); // capuche de pêcheuse
    poly(ctx, [138, 74, 174, 60, 177, 69, 140, 86]); // bras qui lance
    // Harpon en plein jet et sa corde.
    ctx.strokeStyle = c.ink;
    ctx.lineCap = 'round';
    line(ctx, 158, 62, 226, 40, 4);
    ctx.fillStyle = c.light;
    poly(ctx, [246, 32, 222, 40, 228, 46, 216, 50, 224, 34]);
    ctx.strokeStyle = c.light;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(160, 64);
    ctx.bezierCurveTo(130, 96, 108, 96, 86, 122);
    ctx.stroke();
    ctx.fillStyle = c.accent;
    circle(ctx, 130, 56, 1.8);
    // Ressac au premier plan.
    ctx.fillStyle = theme.art.water.skyBottom;
    ctx.beginPath();
    ctx.moveTo(0, 126);
    for (let x = 0; x <= 256; x += 32) ctx.quadraticCurveTo(x + 16, 116, x + 32, 126);
    ctx.lineTo(256, ART_HEIGHT);
    ctx.lineTo(0, ART_HEIGHT);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x <= 256; x += 32) {
      ctx.moveTo(x, 126);
      ctx.quadraticCurveTo(x + 16, 116, x + 32, 126);
    }
    ctx.stroke();
  },

  berserker(ctx, c) {
    // Flammes derrière lui : la Furie qui déborde.
    ctx.fillStyle = c.accent;
    ctx.globalAlpha = 0.5;
    poly(ctx, [58, 138, 68, 92, 76, 110, 86, 78, 96, 108, 104, 96, 108, 138]);
    poly(ctx, [152, 138, 158, 100, 168, 116, 178, 84, 188, 112, 196, 98, 200, 138]);
    ctx.globalAlpha = 1;
    ctx.fillStyle = c.ink;
    poly(ctx, [110, 104, 124, 104, 118, 138, 102, 138]);
    poly(ctx, [132, 104, 146, 104, 154, 138, 138, 138]);
    poly(ctx, [104, 66, 152, 66, 148, 108, 108, 108]); // torse massif
    circle(ctx, 128, 54, 12);
    poly(ctx, [116, 46, 110, 26, 122, 40, 126, 20, 134, 40, 146, 26, 140, 46]); // crinière hérissée
    poly(ctx, [104, 70, 76, 48, 70, 56, 100, 84]); // bras gauche levé
    poly(ctx, [152, 70, 182, 48, 188, 56, 158, 84]); // bras droit levé
    // Deux haches brandies.
    ctx.fillStyle = c.light;
    for (const [x, flip] of [[68, -1], [188, 1]] as [number, number][]) {
      ctx.save();
      ctx.translate(x, 50);
      ctx.scale(flip, 1);
      ctx.fillRect(-2, -4, 4, 34);
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.quadraticCurveTo(26, -22, 24, 10);
      ctx.quadraticCurveTo(12, 2, 0, 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = c.accent;
    circle(ctx, 122, 54, 2.2);
    circle(ctx, 134, 54, 2.2);
  },

  sentinel(ctx, c) {
    ctx.fillStyle = c.ink;
    poly(ctx, [116, 110, 128, 110, 126, 138, 114, 138]);
    poly(ctx, [136, 110, 148, 110, 152, 138, 140, 138]);
    poly(ctx, [116, 62, 154, 62, 156, 112, 114, 112]); // cuirasse
    poly(ctx, [118, 62, 152, 62, 148, 52, 122, 52]); // épaulières
    circle(ctx, 135, 42, 12);
    poly(ctx, [123, 42, 147, 42, 147, 30, 135, 22, 123, 30]); // heaume fermé
    ctx.fillStyle = c.light;
    ctx.fillRect(125, 42, 20, 3); // fente du heaume
    // Lance appuyée contre l'épaule.
    ctx.strokeStyle = c.ink;
    ctx.lineCap = 'round';
    line(ctx, 168, 138, 162, 30, 4);
    ctx.fillStyle = c.light;
    poly(ctx, [161, 14, 168, 34, 155, 34]);
    // Pavois : grand bouclier planté devant elle, rivets et emblème.
    ctx.fillStyle = c.ink;
    ctx.beginPath();
    ctx.moveTo(66, 52);
    ctx.lineTo(118, 52);
    ctx.lineTo(118, 108);
    ctx.quadraticCurveTo(92, 136, 66, 108);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = c.light;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(70, 56);
    ctx.lineTo(114, 56);
    ctx.stroke();
    ctx.fillStyle = c.accent;
    ctx.fillRect(88, 64, 8, 50);
    ctx.fillRect(74, 78, 36, 8);
    ctx.fillStyle = c.light;
    for (const y of [62, 78, 94]) {
      circle(ctx, 70, y, 2.5);
      circle(ctx, 114, y, 2.5);
    }
  },

  spider(ctx, c) {
    // Toile tendue dans l'angle.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i <= 4; i++) {
      const a = (i / 4) * (Math.PI / 2);
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * 120, Math.sin(a) * 120);
    }
    for (const r of [40, 70, 100]) {
      ctx.moveTo(r, 0);
      ctx.arc(0, 0, r, 0, Math.PI / 2);
    }
    ctx.stroke();
    // Pattes, dessinées avant le corps pour qu'elles passent derrière.
    ctx.strokeStyle = c.ink;
    ctx.lineCap = 'round';
    ctx.lineWidth = 5;
    ctx.beginPath();
    for (const [dx, lift] of [[-1, 0], [-1, 1], [1, 0], [1, 1]] as [number, number][]) {
      for (const spread of [46, 72]) {
        const x = 128 + dx * spread;
        ctx.moveTo(128 + dx * 22, 96 + lift * 8);
        ctx.quadraticCurveTo(x, 66 + lift * 10, x + dx * 16, 132 - lift * 4);
      }
    }
    ctx.stroke();
    ctx.fillStyle = c.ink;
    ellipse(ctx, 128, 100, 34, 26); // abdomen
    ellipse(ctx, 128, 74, 20, 16); // céphalothorax
    poly(ctx, [116, 62, 112, 50, 122, 60]); // crochets
    poly(ctx, [140, 62, 144, 50, 134, 60]);
    // Marque venimeuse sur le dos et yeux.
    ctx.fillStyle = c.accent;
    poly(ctx, [128, 84, 140, 100, 128, 118, 116, 100]);
    circle(ctx, 120, 70, 3);
    circle(ctx, 136, 70, 3);
    ctx.fillStyle = c.light;
    circle(ctx, 120, 70, 1.2);
    circle(ctx, 136, 70, 1.2);
  },

  wasp(ctx, c) {
    // Ailes translucides, battues vers l'arrière.
    ctx.fillStyle = c.light;
    ctx.globalAlpha = 0.55;
    ellipse(ctx, 112, 52, 40, 13, -0.5);
    ellipse(ctx, 138, 48, 32, 10, -0.25);
    ctx.globalAlpha = 1;
    ctx.fillStyle = c.ink;
    ellipse(ctx, 96, 88, 30, 20, 0.25); // abdomen
    ellipse(ctx, 132, 74, 16, 13, 0.25); // thorax
    circle(ctx, 152, 64, 12); // tête
    // Rayures venimeuses.
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const [x, len] of [[86, 16], [98, 18], [110, 14]] as [number, number][]) {
      ctx.moveTo(x - 4, 88 - len);
      ctx.lineTo(x + 4, 88 + len);
    }
    ctx.stroke();
    // Dard et antennes.
    ctx.fillStyle = c.accent;
    poly(ctx, [68, 96, 46, 116, 72, 104]);
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(158, 54);
    ctx.quadraticCurveTo(168, 38, 186, 34);
    ctx.moveTo(156, 52);
    ctx.quadraticCurveTo(160, 34, 176, 24);
    ctx.stroke();
    ctx.fillStyle = c.light;
    circle(ctx, 157, 62, 3.5);
    // Ombre portée au sol : elle vole.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ellipse(ctx, 116, 142, 34, 6);
  },

  relicKeeper(ctx, c) {
    // Lueur de la relique.
    const glow = ctx.createRadialGradient(132, 92, 6, 132, 92, 76);
    glow.addColorStop(0, 'rgba(255, 228, 150, 0.75)');
    glow.addColorStop(1, 'rgba(255, 228, 150, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, ART_WIDTH, ART_HEIGHT);
    // Stèles en arrière-plan.
    ctx.fillStyle = c.ink;
    ctx.globalAlpha = 0.45;
    ctx.fillRect(46, 84, 22, 54);
    ctx.fillRect(190, 72, 26, 66);
    ctx.globalAlpha = 1;
    // Gardien encapuchonné, robe évasée jusqu'au sol.
    poly(ctx, [100, 74, 156, 74, 170, 138, 86, 138]);
    ctx.beginPath();
    ctx.moveTo(128, 34);
    ctx.bezierCurveTo(152, 34, 160, 54, 158, 78);
    ctx.lineTo(98, 78);
    ctx.bezierCurveTo(96, 54, 104, 34, 128, 34);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ellipse(ctx, 128, 58, 15, 17); // visage dans l'ombre
    ctx.fillStyle = c.accent;
    circle(ctx, 122, 58, 2.6);
    circle(ctx, 134, 58, 2.6);
    // Bras tendus portant la relique.
    ctx.fillStyle = c.ink;
    poly(ctx, [104, 84, 122, 96, 118, 104, 100, 96]);
    poly(ctx, [152, 84, 134, 96, 138, 104, 156, 96]);
    // Urne dorée.
    ctx.fillStyle = GOLD;
    ctx.beginPath();
    ctx.moveTo(114, 94);
    ctx.bezierCurveTo(112, 118, 144, 118, 142, 94);
    ctx.closePath();
    ctx.fill();
    ellipse(ctx, 128, 94, 16, 6);
    ctx.fillStyle = WINDOW_LIGHT;
    ellipse(ctx, 128, 93, 11, 4);
    ctx.fillStyle = GOLD;
    ctx.fillRect(124, 82, 8, 10);
    circle(ctx, 128, 80, 5);
  },

  banner(ctx, c) {
    ctx.strokeStyle = c.ink;
    ctx.lineCap = 'round';
    line(ctx, 100, 138, 100, 18, 5);
    ctx.fillStyle = c.light;
    circle(ctx, 100, 16, 5);
    ctx.fillStyle = c.accent;
    ctx.beginPath();
    ctx.moveTo(103, 24);
    ctx.bezierCurveTo(140, 12, 160, 36, 200, 22);
    ctx.lineTo(186, 50);
    ctx.lineTo(204, 76);
    ctx.bezierCurveTo(160, 88, 140, 64, 103, 76);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = c.ink;
    poly(ctx, [146, 34, 151, 46, 164, 46, 154, 54, 158, 66, 146, 58, 134, 66, 138, 54, 128, 46, 141, 46]);
  },

  rampart(ctx, c) {
    ctx.fillStyle = c.ink;
    ctx.fillRect(20, 92, 216, 46);
    for (let x = 20; x < 236; x += 24) ctx.fillRect(x, 82, 14, 12);
    ctx.fillRect(146, 44, 56, 94);
    for (let x = 146; x < 202; x += 16) ctx.fillRect(x, 34, 10, 12);
    ctx.fillStyle = WINDOW_LIGHT;
    ctx.beginPath();
    ctx.roundRect(166, 60, 14, 22, [7, 7, 0, 0]);
    ctx.fill();
    ctx.strokeStyle = c.light;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let y = 104; y < 138; y += 12) {
      ctx.moveTo(24, y);
      ctx.lineTo(142, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = theme.art.earth.ground;
    ctx.beginPath();
    ctx.roundRect(62, 104, 30, 34, [15, 15, 0, 0]);
    ctx.fill();
  },

  treasury(ctx, c) {
    const glow = ctx.createRadialGradient(128, 96, 10, 128, 96, 90);
    glow.addColorStop(0, 'rgba(255, 220, 120, 0.7)');
    glow.addColorStop(1, 'rgba(255, 220, 120, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, ART_WIDTH, ART_HEIGHT);
    ctx.fillStyle = c.ink;
    ctx.fillRect(84, 94, 88, 42);
    ctx.beginPath();
    ctx.moveTo(84, 94);
    ctx.bezierCurveTo(84, 66, 172, 66, 172, 94);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = GOLD;
    ctx.fillRect(84, 92, 88, 5);
    ctx.fillRect(122, 88, 12, 16);
    const coins: [number, number][] = [
      [70, 132], [58, 134], [64, 124], [186, 132], [198, 134], [192, 124], [150, 88], [110, 86], [128, 80],
    ];
    for (const [x, y] of coins) {
      ctx.fillStyle = GOLD;
      ellipse(ctx, x, y, 8, 5);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
      ellipse(ctx, x, y + 1, 5, 2.5);
    }
  },

  blessing(ctx, c) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineCap = 'round';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      line(ctx, 128 + Math.cos(a) * 34, 62 + Math.sin(a) * 34, 128 + Math.cos(a) * 60, 62 + Math.sin(a) * 60, 3);
    }
    ctx.fillStyle = c.ink;
    ctx.beginPath();
    ctx.moveTo(102, 50);
    ctx.lineTo(154, 50);
    ctx.bezierCurveTo(154, 80, 140, 92, 128, 92);
    ctx.bezierCurveTo(116, 92, 102, 80, 102, 50);
    ctx.fill();
    ctx.fillRect(124, 90, 8, 30);
    ellipse(ctx, 128, 124, 22, 7);
    ctx.fillStyle = c.accent;
    circle(ctx, 128, 64, 6);
    ctx.fillStyle = c.light;
    ellipse(ctx, 128, 50, 26, 3);
  },
};

// Vrai si la carte a sa propre silhouette : sans elle, `drawCardArt` ne dessine que le décor
// de l'élément, ce qui est le symptôme d'une carte ajoutée au catalogue sans illustration.
export function hasCardArt(cardId: string): boolean {
  return cardId in DRAWERS;
}

// Dessine l'illustration de `cardId` dans la fenêtre (x, y) déjà clippée par l'appelant.
export function drawCardArt(ctx: Ctx, cardId: string, element: CardElement, x: number, y: number): void {
  ctx.save();
  ctx.translate(x, y);
  drawScenery(ctx, element);
  const art = theme.art[element];
  const drawer = DRAWERS[cardId];
  if (drawer) drawer(ctx, { ink: art.ink, light: art.light, accent: art.accent });
  // Vignette douce pour fondre l'illustration dans le cadre.
  const vignette = ctx.createRadialGradient(ART_WIDTH / 2, ART_HEIGHT / 2, 60, ART_WIDTH / 2, ART_HEIGHT / 2, 160);
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(1, 'rgba(0, 0, 0, 0.35)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, ART_WIDTH, ART_HEIGHT);
  ctx.restore();
}
