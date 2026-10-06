// Poses cibles par zone (fonctions pures). Toutes les poses sont exprimées du point de
// vue de « moi » : mon camp est toujours vers +Z, l'adversaire vers -Z (§6.1).
//
// Plateau plein écran (demande utilisateur) : seules les rangées de monstres s'empilent au
// centre, les enchantements passent à droite des rangées de défense, pour que quatre rangées
// (et non six) se partagent la hauteur de l'écran et que les cartes posées se lisent sans zoom.
//
//   ligne de défense :  [Héros] [D D D] [E E E]
//   ligne d'attaque  :          [A A A] [Deck]
//   ──────────────── ligne de front ────────────────
//   (miroir pour l'adversaire)
//
// La caméra n'a plus de cadrage fixe : `computeView` la place pour que ce plateau remplisse
// l'écran moins les colonnes du HUD, quel que soit le ratio. Ce qui doit rester collé à l'écran
// (ma main qui dépasse du bas, celle de l'adversaire qui dépasse du haut, la carte survolée,
// le marché) est posé dans le repère de la caméra par `screenPose`.

import * as THREE from 'three';
import { ZONE_SIZES } from '../game/rules';
import type { Zone } from '../game/types';
import { theme } from './theme';

export interface Pose {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
}

// Rectangle posé sur la table : centre (x, z), demi-largeur et demi-profondeur.
export interface TableRect {
  x: number;
  z: number;
  halfW: number;
  halfD: number;
}

export interface CameraFraming {
  position: [number, number, number];
  lookAt: [number, number, number];
  fov: number;
}

// Cadrage calculé pour un canvas donné, partagé par la caméra (CameraRig) et toutes les poses
// qui dépendent de l'écran.
export interface View {
  framing: CameraFraming;
  width: number;
  height: number;
}

export const CAMERA_FOV = 32;
// Plongée de la caméra sous l'horizontale : presque à la verticale, pour que les rangées du
// fond ne rapetissent presque pas, avec juste assez de perspective pour garder du relief.
const CAMERA_PITCH = THREE.MathUtils.degToRad(78);

export const BOARD_CARD_SCALE = 0.8;
const CARD_W = theme.card.width * BOARD_CARD_SCALE;
const CARD_H = theme.card.height * BOARD_CARD_SCALE;
const SLOT_SPACING = 1.08;
// V2 : une rangée peut dépasser sa capacité par effet. Au-delà de sa capacité usuelle, elle se
// resserre pour tenir dans la largeur d'une rangée pleine (sans déborder sur ses voisines).
const ROW_MAX_CARDS = ZONE_SIZES;

function rowSpacing(zone: Zone, count: number): number {
  const max = ROW_MAX_CARDS[zone];
  return count <= max ? SLOT_SPACING : (SLOT_SPACING * (max - 1)) / (count - 1);
}

// Position des rangées, de mon côté (z positif ; l'adversaire est en miroir sur z). Pas de
// miroir en x (R4) : l'emplacement d'index i a le même x pour les deux joueurs.
const ROW_Z_ATTACK = 0.84;
const ROW_Z_DEFENSE = ROW_Z_ATTACK + CARD_H + 0.16;
const ROW_GAP_X = 0.4; // écart entre une rangée et ses voisines de ligne (héros, enchantements, deck)
const MONSTER_HALF_W = (ROW_MAX_CARDS.attack * SLOT_SPACING) / 2;
const ENCHANT_HALF_W = (ROW_MAX_CARDS.enchant * SLOT_SPACING) / 2;
const HERO_RADIUS = 0.55;
// Rangées de monstres décalées à gauche pour centrer l'ensemble (héros + monstres +
// enchantements) sur l'écran.
const MONSTER_X = -1.05;
const ENCHANT_X = MONSTER_X + MONSTER_HALF_W + ROW_GAP_X + ENCHANT_HALF_W;
const HERO_X = MONSTER_X - MONSTER_HALF_W - ROW_GAP_X - HERO_RADIUS;
const DECK_X = MONSTER_X + MONSTER_HALF_W + ROW_GAP_X + CARD_W / 2;

const ROW_X: Record<Zone, number> = { attack: MONSTER_X, defense: MONSTER_X, enchant: ENCHANT_X };
const ROW_Z: Record<Zone, number> = { attack: ROW_Z_ATTACK, defense: ROW_Z_DEFENSE, enchant: ROW_Z_DEFENSE };

// Rectangle de table que la caméra doit montrer en entier (tout le plateau des deux joueurs).
export const BOARD_BOUNDS = {
  minX: HERO_X - HERO_RADIUS,
  maxX: ENCHANT_X + ENCHANT_HALF_W,
  minZ: -(ROW_Z_DEFENSE + CARD_H / 2 + 0.08),
  maxZ: ROW_Z_DEFENSE + CARD_H / 2 + 0.08,
};

// --- Cadrage ---

// Main : hauteur d'une carte (fraction de la hauteur d'écran) et part visible au repos — le
// haut de la carte (nom, coût) dépasse du bas de l'écran, elle monte en grand au survol.
const HAND_SCREEN_HEIGHT = 0.3;
const HAND_SCREEN_HEIGHT_LOW = 0.36; // écran bas (téléphone en paysage)
const HAND_VISIBLE = 0.4;
const OPPONENT_HAND_SCREEN_HEIGHT = 0.17;
const OPPONENT_HAND_VISIBLE = 0.32;
// Même seuil que `@media (max-height: 500px)` dans styles.css.
const LOW_SCREEN_MAX_HEIGHT = 500;

function isLowScreen(height: number): boolean {
  return height <= LOW_SCREEN_MAX_HEIGHT;
}

function handScreenHeight(view: View): number {
  return isLowScreen(view.height) ? HAND_SCREEN_HEIGHT_LOW : HAND_SCREEN_HEIGHT;
}

// Marges d'écran (px) où le plateau ne doit pas aller : bout de la main adverse en haut, bout
// de ma main en bas, colonnes du HUD sur les côtés. Les colonnes restent étroites : le HUD
// tient surtout dans les coins et, au milieu, dans les vides des lignes d'attaque (à gauche
// des monstres, à droite des pioches). Sur un écran large, c'est la hauteur qui fixe la taille
// du plateau et ces marges ne servent qu'aux écrans plus carrés.
function screenInsets(width: number, height: number) {
  const low = isLowScreen(height);
  const hand = low ? HAND_SCREEN_HEIGHT_LOW : HAND_SCREEN_HEIGHT;
  return {
    side: THREE.MathUtils.clamp(width * 0.1, 60, 200),
    top: height * (OPPONENT_HAND_SCREEN_HEIGHT * OPPONENT_HAND_VISIBLE + 0.012),
    bottom: height * (hand * HAND_VISIBLE + 0.012),
  };
}

// Vecteurs du repère caméra (caméra sans lacet ni roulis, plongée de CAMERA_PITCH).
const FORWARD = new THREE.Vector3(0, -Math.sin(CAMERA_PITCH), -Math.cos(CAMERA_PITCH));
const UP = new THREE.Vector3(0, Math.cos(CAMERA_PITCH), -Math.sin(CAMERA_PITCH));

function placeCamera(camera: THREE.PerspectiveCamera, target: THREE.Vector3, distance: number) {
  camera.position.copy(target).addScaledVector(FORWARD, -distance);
  camera.lookAt(target);
  camera.updateMatrixWorld();
}

// Rectangle écran (px) couvert par le plateau vu par `camera`.
function projectedBoard(camera: THREE.PerspectiveCamera, width: number, height: number) {
  const corner = new THREE.Vector3();
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const x of [BOARD_BOUNDS.minX, BOARD_BOUNDS.maxX]) {
    for (const z of [BOARD_BOUNDS.minZ, BOARD_BOUNDS.maxZ]) {
      corner.set(x, 0, z).project(camera);
      const px = ((corner.x + 1) / 2) * width;
      const py = ((1 - corner.y) / 2) * height;
      left = Math.min(left, px);
      right = Math.max(right, px);
      top = Math.min(top, py);
      bottom = Math.max(bottom, py);
    }
  }
  return { left, right, top, bottom };
}

// Caméra au plus près qui montre tout le plateau dans l'écran moins les marges du HUD, centré
// dans l'espace restant : on cherche la distance par dichotomie, puis on recentre la visée
// (la perspective grossit le bas du plateau et le décale), et on recommence.
function fitCamera(width: number, height: number): CameraFraming {
  const insets = screenInsets(width, height);
  const avail = { left: insets.side, right: width - insets.side, top: insets.top, bottom: height - insets.bottom };
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, width / Math.max(1, height), 0.1, 200);
  camera.updateProjectionMatrix();
  const target = new THREE.Vector3(
    (BOARD_BOUNDS.minX + BOARD_BOUNDS.maxX) / 2,
    0,
    (BOARD_BOUNDS.minZ + BOARD_BOUNDS.maxZ) / 2,
  );
  let distance = 20;

  for (let pass = 0; pass < 4; pass++) {
    let near = 2;
    let far = 80;
    for (let i = 0; i < 30; i++) {
      const mid = (near + far) / 2;
      placeCamera(camera, target, mid);
      const r = projectedBoard(camera, width, height);
      const fits = r.left >= avail.left && r.right <= avail.right && r.top >= avail.top && r.bottom <= avail.bottom;
      if (fits) far = mid;
      else near = mid;
    }
    distance = far;
    placeCamera(camera, target, distance);
    const r = projectedBoard(camera, width, height);
    const unitsPerPxX = (BOARD_BOUNDS.maxX - BOARD_BOUNDS.minX) / Math.max(1, r.right - r.left);
    const unitsPerPxZ = (BOARD_BOUNDS.maxZ - BOARD_BOUNDS.minZ) / Math.max(1, r.bottom - r.top);
    target.x += ((r.left + r.right) / 2 - (avail.left + avail.right) / 2) * unitsPerPxX;
    target.z += ((r.top + r.bottom) / 2 - (avail.top + avail.bottom) / 2) * unitsPerPxZ;
  }

  placeCamera(camera, target, distance);
  return {
    position: [camera.position.x, camera.position.y, camera.position.z],
    lookAt: [target.x, target.y, target.z],
    fov: CAMERA_FOV,
  };
}

let cachedView: View | null = null;

// Cadrage d'un canvas de `width` × `height` px, mis en cache (appelé par chaque carte à
// chaque rendu, il ne se recalcule qu'au redimensionnement).
export function computeView(width: number, height: number): View {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  if (cachedView?.width !== w || cachedView.height !== h) {
    cachedView = { framing: fitCamera(w, h), width: w, height: h };
  }
  return cachedView;
}

function cameraDistance(view: View): number {
  const [px, py, pz] = view.framing.position;
  const [tx, ty, tz] = view.framing.lookAt;
  return Math.hypot(px - tx, py - ty, pz - tz);
}

// Demi-hauteur du champ de la caméra à `distance` d'elle.
function halfHeightAt(view: View, distance: number): number {
  return distance * Math.tan(THREE.MathUtils.degToRad(view.framing.fov) / 2);
}

// Pose d'une carte face à la caméra, à `distanceRatio` × la distance caméra–plateau, centrée sur
// le point écran (`ndcX`, `ndcY`) (coordonnées normalisées, -1..1) et haute de `screenHeight`
// (fraction de la hauteur d'écran). `lift` la rapproche de la caméra pour départager deux
// cartes qui se chevauchent.
export function screenPose(
  view: View,
  ndcX: number,
  ndcY: number,
  distanceRatio: number,
  screenHeight: number,
  rotationZ = 0,
  lift = 0,
): Pose {
  const distance = cameraDistance(view) * distanceRatio;
  const halfH = halfHeightAt(view, distance);
  const aspect = view.width / view.height;
  const p = new THREE.Vector3(...view.framing.position)
    .add(new THREE.Vector3(ndcX * halfH * aspect, 0, 0))
    .addScaledVector(UP, ndcY * halfH)
    .addScaledVector(FORWARD, distance - lift);
  return {
    position: [p.x, p.y, p.z],
    rotation: [-CAMERA_PITCH, 0, rotationZ],
    scale: (screenHeight * 2 * halfH) / theme.card.height,
  };
}

// Abscisse écran normalisée d'un point du monde (pour garder la carte survolée au-dessus de
// sa place dans la main).
function ndcXOf(view: View, position: [number, number, number]): number {
  const offset = new THREE.Vector3(...position).sub(new THREE.Vector3(...view.framing.position));
  const depth = offset.dot(FORWARD);
  return offset.x / (halfHeightAt(view, depth) * (view.width / view.height));
}

const viewCameras = new WeakMap<View, THREE.PerspectiveCamera>();

// Abscisse écran (px) d'un point de la table vu avec le cadrage `view`.
function screenXOfTable(view: View, x: number, z: number): number {
  let camera = viewCameras.get(view);
  if (!camera) {
    camera = new THREE.PerspectiveCamera(view.framing.fov, view.width / view.height, 0.1, 200);
    camera.updateProjectionMatrix();
    placeCamera(camera, new THREE.Vector3(...view.framing.lookAt), cameraDistance(view));
    viewCameras.set(view, camera);
  }
  const point = new THREE.Vector3(x, 0, z).project(camera);
  return ((point.x + 1) / 2) * view.width;
}

// --- Rangées ---

// Rangée compacte (demande utilisateur) : les `count` cartes d'une zone sont serrées et
// centrées, la carte d'index `index` (0 = la plus à gauche) prend la place calculée ici.
export function rowCardPose(zone: Zone, index: number, count: number, mine: boolean): Pose {
  const z = (mine ? 1 : -1) * ROW_Z[zone];
  const x = ROW_X[zone] + (index - (count - 1) / 2) * rowSpacing(zone, count);
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
    x: ROW_X[zone],
    z: (mine ? 1 : -1) * ROW_Z[zone],
    halfW: (capacity * SLOT_SPACING) / 2,
    halfH: CARD_H / 2,
  };
}

// Position d'insertion visée par un point d'abscisse `x` dans une rangée de `count` cartes :
// le nombre de cartes dont le centre est à gauche de `x` (0 = avant la première, `count` =
// après la dernière).
export function insertionIndexAt(zone: Zone, count: number, x: number): number {
  let index = 0;
  const spacing = rowSpacing(zone, count);
  for (let i = 0; i < count; i++) if (ROW_X[zone] + (i - (count - 1) / 2) * spacing < x) index++;
  return index;
}

// Rectangle de table (centre, demi-largeur, demi-profondeur) du board adverse, où se dépose
// une carte à fusionner, et de mon deck, où se dépose une carte à vendre.
export function fusionZoneRect() {
  return {
    x: MONSTER_X,
    z: -(ROW_Z_ATTACK + ROW_Z_DEFENSE) / 2,
    halfW: MONSTER_HALF_W + 0.2,
    halfD: (ROW_Z_DEFENSE - ROW_Z_ATTACK + CARD_H) / 2,
  };
}

export function sellZoneRect() {
  return { x: DECK_X, z: ROW_Z_ATTACK, halfW: CARD_W / 2 + 0.15, halfD: CARD_H / 2 + 0.15 };
}

export function playerTokenPose(mine: boolean): Pose {
  return {
    position: [HERO_X, 0.08, (mine ? 1 : -1) * ROW_Z_DEFENSE],
    rotation: [0, 0, 0],
    scale: 1,
  };
}

export function deckPose(mine: boolean): Pose {
  return {
    position: [DECK_X, 0.1, (mine ? 1 : -1) * ROW_Z_ATTACK],
    rotation: [-Math.PI / 2, 0, 0],
    scale: BOARD_CARD_SCALE,
  };
}

// --- Main ---

const HAND_DISTANCE = 0.5; // ratio de la distance caméra–plateau : devant les cartes posées
const HOVER_DISTANCE = 0.4; // la carte survolée passe devant le reste de la main
const FAN_ANGLE = 0.06; // rotation.z par carte en s'éloignant du centre
const FAN_DROP = 0.012; // descente (ndc) vers les bords de l'éventail
// Décalage de chaque carte vers la caméra selon son rang dans l'éventail : sans lui, deux
// cartes à même distance du centre (les deux du milieu d'une main paire) sont exactement dans
// le même plan — elles se chevauchent en scintillant et le survol tire au hasard celle qu'il
// agrandit.
const FAN_DEPTH_STEP = 0.004;
const HAND_MAX_SPAN = 0.5; // largeur max de l'éventail, en fraction de la largeur d'écran

export function handCardPose(index: number, total: number, mine: boolean, view: View): Pose {
  const offset = index - (total - 1) / 2;
  const screenHeight = mine ? handScreenHeight(view) : OPPONENT_HAND_SCREEN_HEIGHT;
  const visible = mine ? HAND_VISIBLE : OPPONENT_HAND_VISIBLE;
  // Écart entre deux cartes, en ndc : 78 % d'une largeur de carte, resserré si la main est
  // trop longue pour tenir dans HAND_MAX_SPAN (resserrement continu, R2).
  const cardWidthNdc = (screenHeight * view.height * (5 / 7) * 2) / view.width;
  const spacing = total <= 1 ? 0 : Math.min(cardWidthNdc * 0.78, (HAND_MAX_SPAN * 2) / (total - 1));
  const drop = Math.abs(offset) * FAN_DROP;
  const lift = index * FAN_DEPTH_STEP;

  if (mine) {
    // Seule la part `visible` de la carte dépasse du bas de l'écran.
    const ndcY = -1 + 2 * screenHeight * (visible - 0.5) - drop;
    return screenPose(view, offset * spacing, ndcY, HAND_DISTANCE, screenHeight, -offset * FAN_ANGLE, lift);
  }

  // Main adverse : éventail inversé qui dépasse du haut de l'écran ; la face cachée est gérée
  // dans Card (flag `hidden`).
  const ndcY = 1 - 2 * screenHeight * (visible - 0.5) + drop;
  return screenPose(view, -offset * spacing, ndcY, HAND_DISTANCE, screenHeight, offset * FAN_ANGLE, lift);
}

// Carte survolée dans ma main : remonte au-dessus de sa place, face à la caméra, assez grande
// pour être lue (§6.6 ; ~la moitié de la hauteur d'écran), le bas juste au bord de l'écran.
export function handHoverPose(basePose: Pose, view: View): Pose {
  const screenHeight = isLowScreen(view.height) ? 0.66 : 0.56;
  const halfWidthNdc = (screenHeight * view.height * (5 / 7)) / view.width;
  const limit = Math.max(0, 1 - halfWidthNdc - 0.02);
  const ndcX = THREE.MathUtils.clamp(ndcXOf(view, basePose.position), -limit, limit);
  return screenPose(view, ndcX, -0.98 + screenHeight, HOVER_DISTANCE, screenHeight);
}

// --- Marché ---

const MARKET_DISTANCE = 0.55;
const MARKET_MAX_SCREEN_HEIGHT = 0.42;
const MARKET_MAX_SCREEN_HEIGHT_LOW = 0.5;
const MARKET_GAP = 0.08; // écart entre deux cartes, en fraction de leur largeur

// Emplacement du marché couché sur la table, à droite de la pioche, dans le vide de la ligne
// d'attaque : le marché de l'adversaire y est toujours (face cachée), le mien s'y range quand
// je le masque (face visible).
const MARKET_TABLE_LEFT = DECK_X + CARD_W / 2 + 0.3;
const MARKET_TABLE_RIGHT = BOARD_BOUNDS.maxX + 0.2;
const MARKET_TABLE_MAX_SCALE = 0.45;

export function marketTableRect(mine: boolean): TableRect {
  return {
    x: (MARKET_TABLE_LEFT + MARKET_TABLE_RIGHT) / 2,
    z: (mine ? 1 : -1) * ROW_Z_ATTACK,
    halfW: (MARKET_TABLE_RIGHT - MARKET_TABLE_LEFT) / 2,
    halfD: (theme.card.height * MARKET_TABLE_MAX_SCALE) / 2,
  };
}

export function marketTablePose(index: number, total: number, mine: boolean): Pose {
  const offset = index - (total - 1) / 2;
  const width = MARKET_TABLE_RIGHT - MARKET_TABLE_LEFT;
  const scale = Math.min(MARKET_TABLE_MAX_SCALE, width / (Math.max(total, 1) * theme.card.width * 1.1));
  const step = theme.card.width * scale * 1.1;
  return {
    position: [MARKET_TABLE_LEFT + width / 2 + offset * step, 0.06, (mine ? 1 : -1) * ROW_Z_ATTACK],
    rotation: [-Math.PI / 2, 0, 0],
    scale,
  };
}

// Le marché flotte au centre, face à la caméra, du côté du joueur actif. `mine` = est-ce le
// marché de "moi" (vu depuis mon écran) ? Les cartes rétrécissent si la rangée ne tient plus
// entre les colonnes du HUD (écran étroit, marché agrandi par un Colporteur).
export function marketCardPose(index: number, total: number, mine: boolean, view: View): Pose {
  const offset = index - (total - 1) / 2;
  if (mine) {
    // Entre le bord gauche de l'écran et ma pioche : la relance du marché, posée sur la pioche,
    // reste visible et cliquable marché ouvert.
    const left = THREE.MathUtils.clamp(view.width * 0.02, 12, 32);
    const right = screenXOfTable(view, DECK_X - CARD_W / 2, ROW_Z_ATTACK) - 16;
    const fit = (right - left) / (Math.max(total, 1) * view.height * (5 / 7) * (1 + MARKET_GAP));
    const max = isLowScreen(view.height) ? MARKET_MAX_SCREEN_HEIGHT_LOW : MARKET_MAX_SCREEN_HEIGHT;
    const screenHeight = Math.min(max, fit);
    const stepNdc = (screenHeight * view.height * (5 / 7) * (1 + MARKET_GAP) * 2) / view.width;
    const centerNdc = ((left + right) / view.width) - 1;
    return screenPose(view, centerNdc + offset * stepNdc, 0.04, MARKET_DISTANCE, screenHeight);
  }
  // Marché de l'adversaire, face cachée, couché sur la table pour ne masquer aucune de ses cartes.
  return marketTablePose(index, total, false);
}

// --- Ancrages du HUD ---

// Rectangles de table que le HUD suit à l'écran (projetés à chaque frame par `HudAnchors` dans
// Board, exposés en variables CSS `--<nom>-x/-y/-w/-h`) : le HUD se cale sur le plateau, quel
// que soit le cadrage.
//   front     : ligne de front, sur toute la largeur du plateau (bannières, bouton de combat)
//   monsters  : rangées de monstres, sur la ligne de front (le vide à leur gauche reçoit l'aide)
//   *-deck    : pioches (compteur, relance du marché)
//   *-market  : marché couché à droite de la pioche (bouton d'affichage du marché)
//   *-hero    : héros (cartouche du joueur)
export const HUD_ANCHORS: Record<string, TableRect> = {
  front: {
    x: (BOARD_BOUNDS.minX + BOARD_BOUNDS.maxX) / 2,
    z: 0,
    halfW: (BOARD_BOUNDS.maxX - BOARD_BOUNDS.minX) / 2,
    halfD: 0,
  },
  monsters: { x: MONSTER_X, z: 0, halfW: MONSTER_HALF_W, halfD: 0 },
  'my-deck': { x: DECK_X, z: ROW_Z_ATTACK, halfW: CARD_W / 2, halfD: CARD_H / 2 },
  'opp-deck': { x: DECK_X, z: -ROW_Z_ATTACK, halfW: CARD_W / 2, halfD: CARD_H / 2 },
  'my-market': marketTableRect(true),
  'my-hero': { x: HERO_X, z: ROW_Z_DEFENSE, halfW: HERO_RADIUS, halfD: HERO_RADIUS },
  'opp-hero': { x: HERO_X, z: -ROW_Z_DEFENSE, halfW: HERO_RADIUS, halfD: HERO_RADIUS },
};
