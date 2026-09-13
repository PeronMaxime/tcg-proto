export type Seat = 'p1' | 'p2';

export interface CardDef {
  id: string;
  name: string;
  cost: number;
  attack: number;
  health: number;
  color: string; // couleur de fond de la face, pour distinguer les cartes sans illustration
}

export interface CardInstance {
  uid: string; // unique dans la partie, stable : c'est la key React de la carte
  cardId: string;
  attack: number;
  health: number; // PV actuels
  maxHealth: number;
  canAttack: boolean; // false le tour où la carte est posée
}

export interface PlayerState {
  hp: number;
  mana: number;
  maxMana: number;
  deck: CardInstance[]; // le haut du deck est la fin du tableau
  hand: CardInstance[];
  board: CardInstance[];
}

export type Target = { kind: 'hero' } | { kind: 'minion'; uid: string };

export type Action =
  | { type: 'play'; uid: string }
  | { type: 'attack'; attackerUid: string; target: Target }
  | { type: 'endTurn' };

// Dernier événement joué, pour que LES DEUX clients rejouent la même animation.
export type GameEvent =
  | { id: number; type: 'play'; seat: Seat; uid: string }
  | { id: number; type: 'attack'; seat: Seat; attackerUid: string; target: Target }
  | { id: number; type: 'turn'; seat: Seat };

export interface DeadCard {
  owner: Seat;
  card: CardInstance;
}

export interface GameState {
  turn: Seat;
  turnNumber: number;
  players: Record<Seat, PlayerState>;
  winner: Seat | null;
  eventSeq: number; // incrémenté à chaque action, sert d'id aux événements
  lastEvent: GameEvent | null;
  lastDeaths: DeadCard[]; // cartes mortes lors de la DERNIÈRE action (animation de mort)
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
}
