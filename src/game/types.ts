export type Seat = 'p1' | 'p2';
export type MonsterZone = 'attack' | 'defense';
export type Zone = MonsterZone | 'enchant';
export type Phase = 'start' | 'market' | 'main';

export type EnchantmentEffect =
  | { type: 'monsterBuff'; zone: MonsterZone | 'all'; attack: number; defense: number }
  | { type: 'coinsPerTurn'; amount: number };

interface CardDefBase {
  id: string;
  name: string;
  cost: number;
  color: string; // couleur de fond de la face
}

export interface MonsterDef extends CardDefBase {
  kind: 'monster';
  attack: number;
  defense: number;
}

export interface EnchantmentDef extends CardDefBase {
  kind: 'enchantment';
  effect: EnchantmentEffect;
}

export type CardDef = MonsterDef | EnchantmentDef;

export interface CardInstance {
  uid: string; // unique dans la partie, stable : c'est la key React de la carte
  cardId: string;
}

export type Slot = CardInstance | null;

export interface PlayerState {
  hp: number;
  coins: number;
  turnsPlayed: number; // tours commencés par CE joueur : base du gain de pièces (R1)
  deck: CardInstance[]; // le haut du deck est la fin du tableau, le fond est le début
  market: CardInstance[]; // marché du tour en cours ; vide hors phase 'market'
  hand: CardInstance[];
  zones: Record<Zone, Slot[]>; // longueurs fixes 5 / 5 / 3 ; index 0 = emplacement de gauche
}

export type Action =
  | { type: 'beginTurn' }
  | { type: 'buy'; uid: string }
  | { type: 'endMarket' }
  | { type: 'place'; uid: string; zone: Zone; slot: number }
  | { type: 'endTurn' };

export type CombatTarget = { kind: 'monster'; uid: string } | { kind: 'player' };

export interface CombatStep {
  attackerUid: string;
  target: CombatTarget;
  damage: number; // attaque effective de l'attaquant
  remaining: number; // défense restante du monstre (0 = KO) ou PV restants du joueur
}

// Dernier événement joué, pour que LES DEUX clients rejouent la même animation.
export type GameEvent =
  | { id: number; type: 'turnStart'; seat: Seat; coinsGained: number }
  | { id: number; type: 'buy'; seat: Seat; uid: string }
  | { id: number; type: 'marketEnd'; seat: Seat; returnedUids: string[] }
  | { id: number; type: 'place'; seat: Seat; uid: string; zone: Zone; slot: number }
  | { id: number; type: 'combat'; seat: Seat; steps: CombatStep[] };

export interface GameState {
  rulesVersion: number; // T7
  turn: Seat;
  phase: Phase;
  turnNumber: number; // compteur GLOBAL, pour l'affichage uniquement — pas pour les pièces (R1)
  players: Record<Seat, PlayerState>;
  winner: Seat | null;
  eventSeq: number;
  lastEvent: GameEvent | null;
}

export interface PlayerInfo {
  id: string;
  name: string;
}

export interface Room {
  code: string;
  status: 'waiting' | 'playing' | 'finished';
  players: { p1: PlayerInfo; p2: PlayerInfo | null };
  state: GameState | null; // null tant que p2 n'a pas rejoint
  createdAt: number; // Date.now()
  // Horodatage du dernier abandon de partie par siège, ou null si présent/jamais parti.
  // Absent sur les rooms créées avant cette fonctionnalité (accès toujours via `?.`).
  leftAt: Record<Seat, number | null>;
}
