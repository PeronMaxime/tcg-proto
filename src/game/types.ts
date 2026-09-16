export type Seat = 'p1' | 'p2';
export type MonsterZone = 'attack' | 'defense';
export type Zone = MonsterZone | 'enchant';
export type Phase = 'start' | 'main';

export type EnchantmentEffect =
  | { type: 'monsterBuff'; zone: MonsterZone | 'all'; attack: number; defense: number }
  | { type: 'coinsPerTurn'; amount: number };

// Déclencheurs de capacité (E1-E17, PLAN-effets-triggers.md) : `summon`/`sold` hors combat,
// `combatStart` une fois au début du combat, avant le premier coup (demande utilisateur),
// `attack`/`defend`/`ko` pendant la résolution d'un échange (§1bis).
export type Trigger = 'summon' | 'combatStart' | 'attack' | 'defend' | 'ko' | 'sold';

// Effets déclenchés par une capacité. `seat` (porté par `EffectLog`) = propriétaire de la
// carte source, pas forcément le joueur actif.
export type AbilityEffect =
  | { type: 'gainCoins'; amount: number } // pièces au propriétaire
  | { type: 'damageOpponent'; amount: number } // dégâts au héros adverse
  | { type: 'healSelf'; amount: number } // PV au héros du propriétaire (E8)
  | { type: 'drawCard'; count: number } // E11
  | { type: 'buff'; target: 'self' | 'otherAllies'; attack: number; defense: number } // E9
  | { type: 'bonusDamage'; amount: number } // Attaque uniquement (E12)
  | { type: 'shield'; amount: number } // Défend uniquement (E12)
  | { type: 'extraMarketCard'; count: number }; // cartes en plus au marché du prochain tour du propriétaire

export interface CardAbility {
  trigger: Trigger;
  effect: AbilityEffect;
  // Ne se déclenche qu'au premier coup éligible de chaque combat, pas à chaque cycle
  // (demande utilisateur, équilibrage). Absent = à chaque déclenchement.
  oncePerCombat?: true;
}

// Élément d'une carte (demande utilisateur) : fixe la couleur de sa face et, en combat, un
// bonus de dégât contre l'élément qu'il domine (roue `ELEMENT_BEATS` dans cards.ts).
export type CardElement = 'fire' | 'water' | 'air' | 'earth';

interface CardDefBase {
  id: string;
  name: string;
  cost: number;
  element: CardElement; // détermine aussi la couleur de fond de la face (theme.elements)
  abilities?: CardAbility[]; // absent = pas de capacité (E1-E17)
}

export interface MonsterDef extends CardDefBase {
  kind: 'monster';
  attack: number;
  defense: number;
  // Aura (demande utilisateur) : tant que ce monstre est posé, +attaque/+défense à tous les
  // AUTRES monstres de son propriétaire, y compris ceux posés après lui — comme un
  // enchantement `monsterBuff` sur 'all' (doublée si le monstre est doré). Absent = pas d'aura.
  aura?: { attack: number; defense: number };
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
  market: CardInstance[]; // marché du tour en cours ; accessible tant que la phase 'main' dure, vidé à la fin du tour
  hand: CardInstance[];
  zones: Record<Zone, Slot[]>; // longueurs fixes 5 / 5 / 3 ; index 0 = emplacement de gauche
  discard: CardInstance[]; // cartes vendues (`sell`), jamais retirées autrement
  // Cartes en plus à révéler au marché du prochain tour (effet `extraMarketCard`), remis à 0
  // dès que ce marché est tiré.
  extraMarketCards: number;
}

export type Action =
  | { type: 'beginTurn' }
  | { type: 'buy'; uid: string }
  | { type: 'place'; uid: string; zone: Zone; slot: number }
  // Déplace une carte déjà posée vers un autre emplacement de la même zone (attaque ou
  // défense) : on ne peut pas changer de zone en la déplaçant (demande utilisateur). Si
  // l'emplacement est occupé, les deux cartes échangent leur place.
  | { type: 'move'; uid: string; slot: number }
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
  damage: number; // dégâts réellement infligés par l'attaquant (bonus/bouclier/élément inclus)
  remaining: number; // défense restante du monstre ciblé (0 = KO) ou PV restants du joueur
  retaliation: number; // riposte reçue par l'attaquant (0 en percée) (E13), élément inclus
  attackerRemaining: number; // défense restante de l'attaquant après l'échange (0 = KO)
  // Éléments : le coup (resp. la riposte) a été augmenté par l'avantage élémentaire — sert à
  // l'animation « Efficace ! ». Toujours `false` en percée.
  effective: boolean;
  retaliationEffective: boolean;
  effects: EffectLog[]; // effets résolus pendant l'échange, dans l'ordre (E5)
  hp: Record<Seat, number>; // PV des deux joueurs après l'échange, effets compris
}

// Dernier événement joué, pour que LES DEUX clients rejouent la même animation.
export type GameEvent =
  | { id: number; type: 'turnStart'; seat: Seat; coinsGained: number }
  | { id: number; type: 'buy'; seat: Seat; uid: string }
  | { id: number; type: 'place'; seat: Seat; uid: string; zone: Zone; slot: number; effects: EffectLog[] }
  // `swappedUid` : la carte qui occupait `to` et part en `from` (échange), null si `to` était libre.
  | {
      id: number;
      type: 'move';
      seat: Seat;
      uid: string;
      zone: MonsterZone;
      from: number;
      to: number;
      swappedUid: string | null;
    }
  // `uid` : la carte en main devenue dorée ; `fusedUids` : les 2 exemplaires absorbés.
  | { id: number; type: 'fuse'; seat: Seat; uid: string; fusedUids: string[] }
  | { id: number; type: 'sell'; seat: Seat; uid: string; zone: Zone; slot: number; effects: EffectLog[] }
  | {
      id: number;
      type: 'combat';
      seat: Seat;
      steps: CombatStep[];
      hpBefore: Record<Seat, number>; // PV au début du combat
      // Effets « Début du combat », résolus avant le premier coup, et PV juste après eux.
      // Absents sur un évènement écrit avant cette fonctionnalité (accès via `?? []` / `?? hpBefore`).
      startEffects?: EffectLog[];
      hpAfterStart?: Record<Seat, number>;
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
  // Un siège qui a cliqué « Revanche » sur l'écran de victoire (demande utilisateur : la
  // partie ne redémarre que quand LES DEUX sièges sont prêts). Remis à `{ p1: false, p2:
  // false }` dès qu'une nouvelle partie démarre. Absent sur les rooms créées avant cette
  // fonctionnalité (accès toujours via `?.`).
  rematchReady?: Record<Seat, boolean>;
}
