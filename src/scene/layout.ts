// Poses cibles par zone (fonctions pures). Toutes les poses sont exprimées du point de
// vue de « moi » : mon camp est toujours vers +Z, l'adversaire vers -Z (§6.1).

import type { Zone } from '../game/types';
import { theme } from './theme';

export interface Pose {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
}

export interface CameraFraming {
  position: [number, number, number];
  lookAt: [number, number, number];
  fov: number;
}

export const CAMERA: CameraFraming = {
  position: [0, 14, 7],
  lookAt: [0, 0, 0.6],
  fov: 45,
};

// Écran bas (téléphone en paysage) : la caméra a un champ vertical fixe, donc tout se règle sur
// la hauteur d'écran et les cartes y deviennent minuscules, alors que la largeur, elle, est
// en trop. Cadrage « compact » : caméra plus proche et plus plongeante, qui remplit la hauteur
// avec les six rangées et laisse la main adverse hors champ (son nombre de cartes reste dans
// le HUD). Même seuil que `@media (max-height: 500px)` dans styles.css.
export const COMPACT_MAX_HEIGHT = 500;

export const CAMERA_COMPACT: CameraFraming = {
  position: [0, 10.5, 4.6],
  lookAt: [0, 0, 0.9],
  fov: 45,
};

export function isCompactViewport(height: number): boolean {
  return height <= COMPACT_MAX_HEIGHT;
}

export function cameraFraming(compact: boolean): CameraFraming {
  return compact ? CAMERA_COMPACT : CAMERA;
}

export const BOARD_CARD_SCALE = 0.7;
const SLOT_SPACING = 1.05;
// V2 : une rangée peut dépasser sa capacité par effet. Au-delà de `ROW_MAX_CARDS` cartes, elles
// se resserrent pour tenir dans la largeur d'une rangée pleine (sans déborder sur les héros et
// les decks). Une rangée de 5 cartes au plus (toute la V1) garde l'écart d'origine.
const ROW_MAX_CARDS = 5;

function rowSpacing(count: number): number {
  return count <= ROW_MAX_CARDS ? SLOT_SPACING : (SLOT_SPACING * (ROW_MAX_CARDS - 1)) / (count - 1);
}

// Rangées de zones, en Z, de mon côté (positif) et adverse (négatif). Pas de miroir (R4) :
// l'emplacement d'index i a le même x pour les deux joueurs.
const ROW_Z: Record<Zone, number> = { attack: 0.85, defense: 2.2, enchant: 3.55 };

// Rangée compacte (demande utilisateur) : les `count` cartes d'une zone sont serrées et
// centrées, la carte d'index `index` (0 = la plus à gauche) prend la place calculée ici.
export function rowCardPose(zone: Zone, index: number, count: number, mine: boolean): Pose {
  const z = (mine ? 1 : -1) * ROW_Z[zone];
  const x = (index - (count - 1) / 2) * rowSpacing(count);
  return {
    position: [x, 0.03, z],
    rotation: [-Math.PI / 2, 0, 0],
    scale: BOARD_CARD_SCALE,
  };
}

// Rectangle de la table occupé par la rangée d'une zone à pleine capacité (`capacity`
// cartes) : centre et demi-dimensions, pour dessiner son fond et viser un dépôt.
export function rowBounds(zone: Zone, capacity: number, mine: boolean): { x: number; z: number; halfW: number; halfH: number } {
  return {
    x: 0,
    z: (mine ? 1 : -1) * ROW_Z[zone],
    halfW: (capacity * SLOT_SPACING) / 2,
    halfH: (theme.card.height * BOARD_CARD_SCALE) / 2,
  };
}

// Position d'insertion visée par un point d'abscisse `x` dans une rangée de `count` cartes :
// le nombre de cartes dont le centre est à gauche de `x` (0 = avant la première, `count` =
// après la dernière).
export function insertionIndexAt(count: number, x: number): number {
  let index = 0;
  const spacing = rowSpacing(count);
  for (let i = 0; i < count; i++) if ((i - (count - 1) / 2) * spacing < x) index++;
  return index;
}

const PLAYER_TOKEN_MINE: [number, number, number] = [-4.3, 0.08, 2.2];
const PLAYER_TOKEN_OPPONENT: [number, number, number] = [-4.3, 0.08, -2.2];

export function playerTokenPose(mine: boolean): Pose {
  return {
    position: mine ? PLAYER_TOKEN_MINE : PLAYER_TOKEN_OPPONENT,
    rotation: [0, 0, 0],
    scale: 1,
  };
}

const HAND_Z_MINE = 5.0;
const HAND_Y_MINE = 0.6;
const HAND_ROTATION_X_MINE = -0.96;
// Cadrage compact : la main remonte dans le champ, plus redressée face à la caméra plongeante.
const HAND_Z_MINE_COMPACT = 4.85;
const HAND_Y_MINE_COMPACT = 1.0;
const HAND_ROTATION_X_MINE_COMPACT = -1.15;
const HAND_Z_OPPONENT = -5.1;
const HAND_SCALE_OPPONENT = 0.6;
const FAN_ANGLE = 0.07; // rotation.z par carte en s'éloignant du centre
const FAN_LIFT = 0.02; // baisse en y vers les bords
// Décalage de chaque carte vers la caméra, le long de sa normale, selon son rang dans
// l'éventail : sans lui, deux cartes à même distance du centre (les deux du milieu d'une main
// paire) sont exactement dans le même plan — elles se chevauchent en scintillant et le
// survol tire au hasard celle qu'il agrandit.
const FAN_DEPTH_STEP = 0.004;
const HAND_MAX_WIDTH = 8; // largeur dispo pour l'éventail : resserrement continu (R2)

function fanSpacing(total: number): number {
  if (total <= 1) return 0.78;
  return Math.min(0.78, HAND_MAX_WIDTH / (total - 1));
}

export function handCardPose(index: number, total: number, mine: boolean, compact = false): Pose {
  const spacing = fanSpacing(total);
  const offset = index - (total - 1) / 2;
  const lift = (compact && mine ? HAND_Y_MINE_COMPACT : HAND_Y_MINE) - Math.abs(offset) * FAN_LIFT;
  const tilt = compact && mine ? HAND_ROTATION_X_MINE_COMPACT : HAND_ROTATION_X_MINE;
  // Normale d'une carte inclinée de `tilt` autour de x : (0, -sin(tilt), cos(tilt)).
  const depth = index * FAN_DEPTH_STEP;
  const y = lift - Math.sin(tilt) * depth;
  const dz = Math.cos(tilt) * depth;

  if (mine) {
    return {
      position: [offset * spacing, y, (compact ? HAND_Z_MINE_COMPACT : HAND_Z_MINE) + dz],
      rotation: [tilt, 0, -offset * FAN_ANGLE],
      scale: 1,
    };
  }

  // Éventail inversé, plus petit ; la face cachée est gérée dans Card (flag `hidden`),
  // pas par l'inclinaison : la même inclinaison que ma main oriente déjà le dos vers la
  // caméra une fois la carte retournée.
  return {
    position: [-offset * spacing, y, HAND_Z_OPPONENT + dz],
    rotation: [HAND_ROTATION_X_MINE, 0, offset * FAN_ANGLE],
    scale: HAND_SCALE_OPPONENT,
  };
}

// Carte survolée dans ma main : remonte vers la caméra, grossit nettement et se tourne face à
// elle pour être lisible (§6.6 ; agrandie à la demande de l'utilisateur, ~la moitié de la
// hauteur d'écran). Position absolue en y/z : le bas de la carte reste juste dans l'écran.
// En cadrage compact, la main est à moitié sous le bord de l'écran : la carte monte vers le haut
// de l'écran (z diminue) au lieu d'avancer vers la caméra, pour sortir entière.
export function handHoverPose(basePose: Pose, compact = false): Pose {
  if (compact) {
    return {
      position: [basePose.position[0], 2.5, 3.25],
      rotation: [-1.35, basePose.rotation[1], 0],
      scale: 2.1,
    };
  }
  return {
    position: [basePose.position[0], 2.4, 4.3],
    rotation: [-1.3, basePose.rotation[1], 0],
    scale: 2.6,
  };
}

const DECK_MINE: [number, number, number] = [4.3, 0.1, 2.2];
const DECK_OPPONENT: [number, number, number] = [4.3, 0.1, -2.2];

export function deckPose(mine: boolean): Pose {
  return {
    position: mine ? DECK_MINE : DECK_OPPONENT,
    rotation: [-Math.PI / 2, 0, 0],
    scale: BOARD_CARD_SCALE,
  };
}

// Mon marché : taille maximale des cartes, écart entre deux cartes (fraction de leur largeur)
// et hauteur visible de l'écran à la distance du marché (caméra CAMERA, fov 45°), pour que
// la rangée tienne en largeur quel que soit le ratio de l'écran.
const MARKET_MAX_SCALE = 1.6;
const MARKET_GAP = 0.08;
const MARKET_VISIBLE_HEIGHT = 9.5;
const MARKET_MAX_WIDTH = 9;
// Cadrage compact : le marché se place au centre du champ de CAMERA_COMPACT, face à elle.
const MARKET_Y_COMPACT = 3.5;
const MARKET_Z_COMPACT = 2.15;
const MARKET_ROTATION_X_COMPACT = -1.15;
const MARKET_VISIBLE_HEIGHT_COMPACT = 6.1;
const MARKET_MAX_SCALE_COMPACT = 1.45;

// Le marché flotte au centre, face à la caméra, du côté du joueur actif (H4 : visible des
// deux joueurs). `mine` = est-ce le marché de "moi" (vu depuis mon écran) ? `aspect` = ratio
// largeur / hauteur du canvas : les cartes rétrécissent si la rangée ne tient plus en largeur
// (écran étroit, marché agrandi par un Colporteur).
export function marketCardPose(index: number, total: number, mine: boolean, aspect = 16 / 9, compact = false): Pose {
  const offset = index - (total - 1) / 2;
  if (mine) {
    const visibleHeight = compact ? MARKET_VISIBLE_HEIGHT_COMPACT : MARKET_VISIBLE_HEIGHT;
    const availableWidth = Math.min(MARKET_MAX_WIDTH, visibleHeight * aspect * 0.94);
    const fitScale = availableWidth / (Math.max(total, 1) * theme.card.width * (1 + MARKET_GAP));
    const scale = Math.min(compact ? MARKET_MAX_SCALE_COMPACT : MARKET_MAX_SCALE, fitScale);
    return {
      position: [
        offset * theme.card.width * scale * (1 + MARKET_GAP),
        compact ? MARKET_Y_COMPACT : 3.2,
        compact ? MARKET_Z_COMPACT : 3.0,
      ],
      rotation: [compact ? MARKET_ROTATION_X_COMPACT : -0.96, 0, 0],
      scale,
    };
  }
  return {
    position: [offset * 1.3, 1.5, -3.0],
    rotation: [-0.96, 0, 0],
    scale: 0.9,
  };
}
