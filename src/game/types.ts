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

// Habileté (demande utilisateur) : mot-clé porté par certains monstres, qui modifie une
// règle du jeu au lieu de déclencher un effet ponctuel comme `CardAbility`. Les valeurs
// chiffrées vivent dans cards.ts (`KEYWORD_*`), les règles dans rules.ts :
// - `reach`    Portée : le coup touche aussi les monstres voisins de la cible ;
// - `taunt`    Provocation : doit être attaqué en priorité tant qu'il est debout ;
// - `protection` Protection : encaisse une attaque sans prendre de dégât (1× par combat) ;
// - `merchant` Négociant : rapporte une pièce de plus à la vente ;
// - `fury`     Furie : les dégâts en excès sur un défenseur tué passent au suivant ;
// - `toxic`    Toxic : le moindre dégât infligé tue son opposant.
export type Keyword = 'reach' | 'taunt' | 'protection' | 'merchant' | 'fury' | 'toxic';

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
  // Habiletés (mots-clés) du monstre, dans l'ordre d'affichage sur la face. Absent = aucune.
  keywords?: Keyword[];
}

export interface EnchantmentDef extends CardDefBase {
  kind: 'enchantment';
  effect: EnchantmentEffect;
}

export type CardDef = MonsterDef | EnchantmentDef;

// Catalogue complet : les cartes existantes et la composition du deck de départ. Éditable
// depuis le panneau d'administration (`ui/admin`), stocké dans `catalog/current`
// (`net/catalogStore.ts`) et recopié tel quel dans chaque `Room` à la création d'une partie,
// pour qu'une modification faite en cours de partie ne change pas les cartes sous les pieds
// des joueurs. `version` est incrémentée à chaque enregistrement : elle sert de garde contre
// l'écrasement d'une écriture plus récente (deux onglets d'admin ouverts en même temps).
export interface Catalog {
  version: number;
  cards: CardDef[];
  // Nombre d'exemplaires de chaque carte dans le deck de départ, indexé par `CardDef.id`.
  // Un id absent (ou à 0) veut dire que la carte existe mais n'est pas distribuée.
  starterCounts: Record<string, number>;
}

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
  // Cartes du marché en cours verrouillées (demande utilisateur, action `lockMarketCard`) :
  // elles ne partent pas au rebut à la fin du tour et ne sont pas remplacées par une
  // relance, elles ouvrent le marché du prochain tour. Uids présents dans `market` ;
  // remis à `[]` par `beginTurn`, qui vient de les servir (les garder un tour de plus se
  // repaie). Absent sur un état écrit avant cette règle : à lire via `?? []`.
  lockedUids: string[];
  // Déplacements déjà effectués pendant le tour en cours (demande utilisateur : un seul
  // déplacement par zone et par tour, donc au plus un en attaque et un en défense). Remis à
  // `{ attack: false, defense: false }` au début de chaque tour de CE joueur (`beginTurn`).
  movesUsed: Record<MonsterZone, boolean>;
}

export type Action =
  | { type: 'beginTurn' }
  | { type: 'buy'; uid: string }
  | { type: 'place'; uid: string; zone: Zone; slot: number }
  // Déplace une carte déjà posée vers un autre emplacement de la même zone (attaque ou
  // défense) : on ne peut pas changer de zone en la déplaçant (demande utilisateur). Si
  // l'emplacement est occupé, les deux cartes échangent leur place. Un seul déplacement par
  // zone et par tour (`PlayerState.movesUsed`) : un échange compte pour un déplacement de la
  // zone concernée, pas deux.
  | { type: 'move'; uid: string; slot: number }
  // Relance le marché contre `MARKET_REROLL_COST` pièce (demande utilisateur) : les cartes
  // non verrouillées repartent au fond du deck et sont remplacées par autant de cartes du
  // dessus. Répétable tant que le joueur paie.
  | { type: 'rerollMarket' }
  // Verrouille/déverrouille une carte du marché (demande utilisateur) : verrouiller coûte
  // `MARKET_LOCK_COST` pièce et met la carte de côté pour le marché du prochain tour,
  // déverrouiller est gratuit mais ne rembourse rien.
  | { type: 'toggleMarketLock'; uid: string }
  | { type: 'fuse'; uid: string } // uid : la carte en main qui devient dorée
  | { type: 'sell'; uid: string }
  | { type: 'endTurn' };

export type CombatTarget = { kind: 'monster'; uid: string } | { kind: 'player' };

// Effet résolu, journalisé pour que les deux clients affichent le même retour visuel
// (§6.3) : le fil d'effets du HUD et la pulsation sur la carte source en vivent. `seat` =
// propriétaire de la carte source. Deux formes, distinguées par `kind` :
// - une capacité (`CardAbility`) qui a résolu son effet — la forme historique, dont `kind`
//   est omis pour rester compatible avec les évènements écrits avant les habiletés ;
// - une habileté (`Keyword`) qui vient de modifier la résolution (Provocation qui détourne
//   l'attaque, Protection qui l'annule, Portée, Furie, Toxic, Négociant à la vente). Elles
//   n'ont pas d'`AbilityEffect` : c'est le mot-clé lui-même qui est journalisé.
export interface AbilityEffectLog {
  kind?: 'ability';
  seat: Seat;
  sourceUid: string;
  cardId: string;
  trigger: Trigger;
  effect: AbilityEffect;
}

export interface KeywordEffectLog {
  kind: 'keyword';
  seat: Seat;
  sourceUid: string;
  cardId: string;
  keyword: Keyword;
}

export type EffectLog = AbilityEffectLog | KeywordEffectLog;

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
  // Habiletés (K1-K6, voir `Keyword`). Toutes absentes sur un évènement écrit avant les
  // habiletés, et sur un coup qui n'en déclenche aucune : à lire avec `?? []` / `?? null`.
  // Portée : dégâts collatéraux aux voisins de la cible, dans l'ordre des emplacements.
  splash?: { uid: string; damage: number; remaining: number; effective: boolean }[];
  // Furie : dégâts en excès reportés sur le défenseur suivant après un défenseur tué.
  overflow?: { uid: string; damage: number; remaining: number } | null;
  // Protection : monstres dont la protection a absorbé les dégâts de ce coup — attaque,
  // riposte, mais aussi dégâts collatéraux de Portée ou de Furie, qui la cassent eux aussi.
  absorbedUids?: string[];
  effects: EffectLog[]; // effets résolus pendant l'échange, dans l'ordre (E5)
  hp: Record<Seat, number>; // PV des deux joueurs après l'échange, effets compris
}

// Dernier événement joué, pour que LES DEUX clients rejouent la même animation.
export type GameEvent =
  | { id: number; type: 'turnStart'; seat: Seat; coinsGained: number }
  | { id: number; type: 'buy'; seat: Seat; uid: string }
  // `uids` : le marché tel qu'il ressort de la relance (cartes verrouillées comprises, dans
  // l'ordre) ; `cost` : les pièces dépensées.
  | { id: number; type: 'marketReroll'; seat: Seat; uids: string[]; cost: number }
  // `locked` : l'état de la carte APRÈS l'action ; `cost` : 0 au déverrouillage.
  | { id: number; type: 'marketLock'; seat: Seat; uid: string; locked: boolean; cost: number }
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
  // Joueur désigné par le lancer de pièce du début de partie (demande utilisateur) : c'est
  // lui qui joue le premier tour, l'autre reçoit `SECOND_PLAYER_BONUS_COINS`. Conservé dans
  // l'état pour que LES DEUX clients animent la même pièce, et que le résultat survive à un
  // rafraîchissement.
  starter: Seat;
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
  // Catalogue figé à la création de la partie (voir `Catalog`) : les deux clients jouent
  // forcément avec les mêmes cartes, et une édition faite dans l'admin pendant la partie ne
  // s'applique qu'à la suivante. Absent sur les rooms créées avant le panneau
  // d'administration : à lire via `room.catalog ?? DEFAULT_CATALOG`.
  catalog?: Catalog;
}
