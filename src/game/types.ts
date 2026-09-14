export type Seat = 'p1' | 'p2';
export type MonsterZone = 'attack' | 'defense';
export type Zone = MonsterZone | 'enchant';
export type Phase = 'start' | 'market' | 'main';

export type EnchantmentEffect =
  | { type: 'monsterBuff'; zone: MonsterZone | 'all'; attack: number; defense: number }
  | { type: 'coinsPerTurn'; amount: number };

// Déclencheurs de capacité (E1-E17, PLAN-effets-triggers.md) : `summon`/`sold` hors combat,
// `attack`/`defend`/`ko` pendant la résolution d'un échange (§1bis).
export type Trigger = 'summon' | 'attack' | 'defend' | 'ko' | 'sold';

// Effets déclenchés par une capacité. `seat` (porté par `EffectLog`) = propriétaire de la
// carte source, pas forcément le joueur actif.
export type AbilityEffect =
  | { type: 'gainCoins'; amount: number } // pièces au propriétaire
  | { type: 'damageOpponent'; amount: number } // dégâts au héros adverse
  | { type: 'healSelf'; amount: number } // PV au héros du propriétaire (E8)
  | { type: 'drawCard'; count: number } // E11
  | { type: 'buff'; target: 'self' | 'otherAllies'; attack: number; defense: number } // E9
  | { type: 'bonusDamage'; amount: number } // Attaque uniquement (E12)
  | { type: 'shield'; amount: number }; // Défend uniquement (E12)

export interface CardAbility {
  trigger: Trigger;
  effect: AbilityEffect;
}

interface CardDefBase {
  id: string;
  name: string;
  cost: number;
  color: string; // couleur de fond de la face
  abilities?: CardAbility[]; // absent = pas de capacité (E1-E17)
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
  // Monstre doré, issu de la fusion d'une carte en main avec 2 exemplaires posés (action
  // `fuse`). Absent (et jamais `false`/`undefined` explicite) sur une carte normale.
  golden?: true;
  // Buff permanent cumulé via une capacité (E9), disparaît si la carte quitte le board.
  // Absent tant qu'aucun buff n'a été reçu ; jamais écrit `{ attack: 0, defense: 0 }`.
  buff?: { attack: number; defense: number };
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
  discard: CardInstance[]; // cartes vendues (`sell`), jamais retirées autrement
}

export type Action =
  | { type: 'beginTurn' }
  | { type: 'buy'; uid: string }
  | { type: 'endMarket' }
  | { type: 'place'; uid: string; zone: Zone; slot: number }
  | { type: 'fuse'; uid: string } // uid : la carte en main qui devient dorée
  | { type: 'sell'; uid: string }
  | { type: 'endTurn' };

export type CombatTarget = { kind: 'monster'; uid: string } | { kind: 'player' };

// Effet résolu par une capacité, journalisé pour que les deux clients affichent le même
// retour visuel (§6.3). `seat` = propriétaire de la carte source.
export interface EffectLog {
  seat: Seat;
  sourceUid: string;
  cardId: string;
  trigger: Trigger;
  effect: AbilityEffect;
}

export interface CombatStep {
  cycle: number; // 1, 2, … pour la mêlée (E14) ; cycle de la percée = dernier cycle + 1 (E15)
  attackerUid: string;
  target: CombatTarget;
  damage: number; // dégâts réellement infligés par l'attaquant (bonus/bouclier inclus)
  remaining: number; // défense restante du monstre ciblé (0 = KO) ou PV restants du joueur
  retaliation: number; // riposte reçue par l'attaquant (0 en percée) (E13)
  attackerRemaining: number; // défense restante de l'attaquant après l'échange (0 = KO)
  effects: EffectLog[]; // effets résolus pendant l'échange, dans l'ordre (E5)
  hp: Record<Seat, number>; // PV des deux joueurs après l'échange, effets compris
}

// Dernier événement joué, pour que LES DEUX clients rejouent la même animation.
export type GameEvent =
  | { id: number; type: 'turnStart'; seat: Seat; coinsGained: number }
  | { id: number; type: 'buy'; seat: Seat; uid: string }
  | { id: number; type: 'marketEnd'; seat: Seat; returnedUids: string[] }
  | { id: number; type: 'place'; seat: Seat; uid: string; zone: Zone; slot: number; effects: EffectLog[] }
  // `uid` : la carte en main devenue dorée ; `fusedUids` : les 2 exemplaires absorbés.
  | { id: number; type: 'fuse'; seat: Seat; uid: string; fusedUids: string[] }
  | { id: number; type: 'sell'; seat: Seat; uid: string; zone: Zone; slot: number; effects: EffectLog[] }
  | {
      id: number;
      type: 'combat';
      seat: Seat;
      steps: CombatStep[];
      hpBefore: Record<Seat, number>; // PV au début du combat
      stalemate: boolean; // combat nul (E16)
    };

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
