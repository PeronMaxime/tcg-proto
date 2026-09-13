// Poses cibles par zone (fonctions pures). Toutes les poses sont exprimées du point de
// vue de « moi » : mon camp est toujours vers +Z, l'adversaire vers -Z (§7).

export interface Pose {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
}

export const CAMERA = {
  position: [0, 10, 7.5] as [number, number, number],
  lookAt: [0, 0, 0.5] as [number, number, number],
  fov: 45,
};

const BOARD_Z_MINE = 1.15;
const BOARD_Z_OPPONENT = -1.15;
const BOARD_SPACING = 1.45;

export function boardSlotPose(index: number, total: number, mine: boolean): Pose {
  const z = mine ? BOARD_Z_MINE : BOARD_Z_OPPONENT;
  const x = (index - (total - 1) / 2) * BOARD_SPACING;
  return {
    position: [x, 0.02, z],
    rotation: [-Math.PI / 2, 0, 0],
    scale: 1,
  };
}

export const HERO_POSE_MINE: Pose = {
  position: [0, 0.08, 2.75],
  rotation: [0, 0, 0],
  scale: 1,
};

export const HERO_POSE_OPPONENT: Pose = {
  position: [0, 0.08, -2.9],
  rotation: [0, 0, 0],
  scale: 1,
};

const HAND_Z_MINE = 4.1;
const HAND_Y_MINE = 0.6;
const HAND_ROTATION_X_MINE = -0.96;
const HAND_Z_OPPONENT = -4.3;
const HAND_SCALE_OPPONENT = 0.8;
const FAN_ANGLE = 0.07; // rotation.z par carte en s'éloignant du centre
const FAN_LIFT = 0.02; // baisse en y vers les bords

function fanSpacing(total: number): number {
  return total > 7 ? 0.55 : 0.78;
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

// Carte survolée dans ma main : remonte, avance vers la caméra, grossit, se redresse (§7).
export function handHoverPose(basePose: Pose): Pose {
  return {
    position: [basePose.position[0], basePose.position[1] + 0.4, basePose.position[2] + 0.6],
    rotation: [basePose.rotation[0], basePose.rotation[1], 0],
    scale: 1.5,
  };
}

const DECK_MINE: [number, number, number] = [5.2, 0.1, 2.2];
const DECK_OPPONENT: [number, number, number] = [5.2, 0.1, -2.2];

export function deckPose(mine: boolean): Pose {
  return {
    position: mine ? DECK_MINE : DECK_OPPONENT,
    rotation: [-Math.PI / 2, 0, 0],
    scale: 1,
  };
}
