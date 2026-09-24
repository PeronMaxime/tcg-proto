// Poses cibles par zone (fonctions pures). Toutes les poses sont exprimées du point de
// vue de « moi » : mon camp est toujours vers +Z, l'adversaire vers -Z (§6.1).

import type { Zone } from '../game/types';
import { theme } from './theme';

export interface Pose {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
}

export const CAMERA = {
  position: [0, 14, 7] as [number, number, number],
  lookAt: [0, 0, 0.6] as [number, number, number],
  fov: 45,
};

export const BOARD_CARD_SCALE = 0.7;
const SLOT_SPACING = 1.05;

// Rangées de zones, en Z, de mon côté (positif) et adverse (négatif). Pas de miroir (R4) :
// l'emplacement d'index i a le même x pour les deux joueurs.
const ROW_Z: Record<Zone, number> = { attack: 0.85, defense: 2.2, enchant: 3.55 };

// Rangée compacte (demande utilisateur) : les `count` cartes d'une zone sont serrées et
// centrées, la carte d'index `index` (0 = la plus à gauche) prend la place calculée ici.
export function rowCardPose(zone: Zone, index: number, count: number, mine: boolean): Pose {
  const z = (mine ? 1 : -1) * ROW_Z[zone];
  const x = (index - (count - 1) / 2) * SLOT_SPACING;
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
  for (let i = 0; i < count; i++) if ((i - (count - 1) / 2) * SLOT_SPACING < x) index++;
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
const HAND_Z_OPPONENT = -5.1;
const HAND_SCALE_OPPONENT = 0.6;
const FAN_ANGLE = 0.07; // rotation.z par carte en s'éloignant du centre
const FAN_LIFT = 0.02; // baisse en y vers les bords
const HAND_MAX_WIDTH = 8; // largeur dispo pour l'éventail : resserrement continu (R2)

function fanSpacing(total: number): number {
  if (total <= 1) return 0.78;
  return Math.min(0.78, HAND_MAX_WIDTH / (total - 1));
}

export function handCardPose(index: number, total: number, mine: boolean): Pose {
  const spacing = fanSpacing(total);
  const offset = index - (total - 1) / 2;
  const lift = HAND_Y_MINE - Math.abs(offset) * FAN_LIFT;

  if (mine) {
    return {
      position: [offset * spacing, lift, HAND_Z_MINE],
      rotation: [HAND_ROTATION_X_MINE, 0, -offset * FAN_ANGLE],
      scale: 1,
    };
  }

  // Éventail inversé, plus petit ; la face cachée est gérée dans Card (flag `hidden`),
  // pas par l'inclinaison : la même inclinaison que ma main oriente déjà le dos vers la
  // caméra une fois la carte retournée.
  return {
    position: [-offset * spacing, lift, HAND_Z_OPPONENT],
    rotation: [HAND_ROTATION_X_MINE, 0, offset * FAN_ANGLE],
    scale: HAND_SCALE_OPPONENT,
  };
}

// Carte survolée dans ma main : remonte, avance vers la caméra, grossit, se redresse (§6.6).
export function handHoverPose(basePose: Pose): Pose {
  return {
    position: [basePose.position[0], basePose.position[1] + 0.4, basePose.position[2] + 0.6],
    rotation: [basePose.rotation[0], basePose.rotation[1], 0],
    scale: 1.5,
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

// Le marché flotte au centre, face à la caméra, du côté du joueur actif (H4 : visible des
// deux joueurs). `mine` = est-ce le marché de "moi" (vu depuis mon écran) ? `aspect` = ratio
// largeur / hauteur du canvas : les cartes rétrécissent si la rangée ne tient plus en largeur
// (écran étroit, marché agrandi par un Colporteur).
export function marketCardPose(index: number, total: number, mine: boolean, aspect = 16 / 9): Pose {
  const offset = index - (total - 1) / 2;
  if (mine) {
    const availableWidth = Math.min(MARKET_MAX_WIDTH, MARKET_VISIBLE_HEIGHT * aspect * 0.94);
    const fitScale = availableWidth / (Math.max(total, 1) * theme.card.width * (1 + MARKET_GAP));
    const scale = Math.min(MARKET_MAX_SCALE, fitScale);
    return {
      position: [offset * theme.card.width * scale * (1 + MARKET_GAP), 3.2, 3.0],
      rotation: [-0.96, 0, 0],
      scale,
    };
  }
  return {
    position: [offset * 1.3, 1.5, -3.0],
    rotation: [-0.96, 0, 0],
    scale: 0.9,
  };
}
