// Poses cibles par zone (fonctions pures). Toutes les poses sont exprimées du point de
// vue de « moi » : mon camp est toujours vers +Z, l'adversaire vers -Z (§6.1).

import type { Zone } from '../game/types';

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

export function slotPose(zone: Zone, index: number, mine: boolean): Pose {
  const total = zone === 'enchant' ? 3 : 5;
  const z = (mine ? 1 : -1) * ROW_Z[zone];
  const x = (index - (total - 1) / 2) * SLOT_SPACING;
  return {
    position: [x, 0.03, z],
    rotation: [-Math.PI / 2, 0, 0],
    scale: BOARD_CARD_SCALE,
  };
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

// Pile de défausse (cartes vendues) : juste à côté du deck, un peu plus loin du centre —
// « en dessous » du deck vu de l'écran de son propriétaire.
const DISCARD_OFFSET = 0.9;
const DISCARD_MINE: [number, number, number] = [4.3, 0.1, 2.2 + DISCARD_OFFSET];
const DISCARD_OPPONENT: [number, number, number] = [4.3, 0.1, -2.2 - DISCARD_OFFSET];

export function discardPose(mine: boolean): Pose {
  return {
    position: mine ? DISCARD_MINE : DISCARD_OPPONENT,
    rotation: [-Math.PI / 2, 0, 0],
    scale: BOARD_CARD_SCALE,
  };
}

// Le marché flotte au centre, face à la caméra, du côté du joueur actif (H4 : visible des
// deux joueurs). `mine` = est-ce le marché de "moi" (vu depuis mon écran) ?
export function marketCardPose(index: number, total: number, mine: boolean): Pose {
  const offset = index - (total - 1) / 2;
  if (mine) {
    return {
      position: [offset * 1.7, 3.2, 3.0],
      rotation: [-0.96, 0, 0],
      scale: 1.3,
    };
  }
  return {
    position: [offset * 1.3, 1.5, -3.0],
    rotation: [-0.96, 0, 0],
    scale: 0.9,
  };
}
