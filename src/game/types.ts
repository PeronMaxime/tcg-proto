import type { GameVersion } from './versions';

export type Seat = 'p1' | 'p2';
export type MonsterZone = 'attack' | 'defense';
export type Zone = MonsterZone | 'enchant';
export type Phase = 'start' | 'main';

export type EnchantmentEffect =
  | { type: 'monsterBuff'; zone: MonsterZone | 'all'; attack: number; defense: number }
  | { type: 'coinsPerTurn'; amount: number }
  // V2 uniquement (`game/versions.ts`) : refusés par la validation d'un catalogue V1.
  | { type: 'healBoost' } // double les soins reçus par le héros du propriétaire
  | { type: 'marketSize'; count: number } // cartes en plus à CHAQUE marché, tant qu'il est posé
  | { type: 'sellBonus'; amount: number }; // pièces en plus à chaque vente

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
  | { type: 'extraMarketCard'; count: number } // cartes en plus au marché du prochain tour du propriétaire
  // --- V2 uniquement (modifsV2.md) : refusés par la validation d'un catalogue V1. ---
  // « Monstre choisi » = désigné par le joueur, donc seulement sur Invoqué / Vendu
  // (`isAbilityAllowed`) : la résolution s'interrompt sur `GameState.pendingChoice`.
  | { type: 'armorChosen'; amount: number } // armure à un de tes monstres, choisi
  | { type: 'armorZone'; amount: number } // armure à tous les monstres de la zone de la carte
  | { type: 'armorBoard'; amount: number } // armure à tous les monstres de son propriétaire
  | { type: 'armorSelf'; amount: number } // la carte elle-même gagne de l'armure
  | { type: 'grantShield' } // protection à usage unique sur un de tes monstres, choisi
  | { type: 'summonToken'; attack: number; defense: number } // créature X/Y à côté de la carte
  | { type: 'burn' } // brûlure (cumulable) sur un monstre adverse, choisi
  | { type: 'freeze' } // gel sur un monstre adverse, choisi
  | { type: 'extinguish' } // éteint la brûlure d'un de tes monstres, choisi
  | { type: 'root' } // enracine un monstre choisi (des deux camps) jusqu'à ton prochain tour
  | { type: 'silence' } // réduit au silence un monstre adverse, choisi
  | { type: 'moveZone' } // un monstre choisi (des deux camps) change de zone
  | { type: 'moveSlot' } // un monstre choisi (des deux camps) change de place dans sa zone
  | { type: 'switchZone' }; // la carte elle-même change de zone

export interface CardAbility {
  trigger: Trigger;
  effect: AbilityEffect;
  // Ne se déclenche qu'au premier coup éligible de chaque combat, pas à chaque cycle
  // (demande utilisateur, équilibrage). Absent = à chaque déclenchement.
  oncePerCombat?: true;
}

// Élément d'une carte (demande utilisateur) : fixe la couleur de sa face et, en combat, un
// bonus de dégât contre l'élément qu'il domine (roue `ELEMENT_BEATS` dans cards.ts).
// `neutral` (V2 uniquement, demande utilisateur) : carte sans élément particulier, aux effets
// génériques utiles à tous les gameplays. Refusé par la validation d'un catalogue V1 ; hors de
// la roue des affinités, qui n'existe de toute façon plus en V2.
export type CardElement = 'fire' | 'water' | 'air' | 'earth' | 'neutral';
// Éléments de la roue des affinités (V1) : tous sauf le neutre.
export type WheelElement = Exclude<CardElement, 'neutral'>;

// Habileté (demande utilisateur) : mot-clé porté par certains monstres, qui modifie une
// règle du jeu au lieu de déclencher un effet ponctuel comme `CardAbility`. Les valeurs
// chiffrées vivent dans cards.ts (`KEYWORD_*`), les règles dans rules.ts :
// - `reach`    Portée : le coup touche aussi les monstres voisins de la cible ;
// - `taunt`    Provocation : doit être attaqué en priorité tant qu'il est debout ;
// - `protection` Protection : encaisse une attaque sans prendre de dégât (1× par combat) ;
// - `merchant` Négociant : rapporte une pièce de plus à la vente ;
// - `fury`     Furie : les dégâts en excès sur un défenseur tué passent au suivant ;
// - `toxic`    Toxic : le moindre dégât infligé tue son opposant.
// V2 (modifsV2.md) : Portée, Furie, Provocation, Protection et Toxic y changent en partie de
// règle (voir `rulesV2.ts`), et trois habiletés n'existent qu'en V2 :
// - `pierce`   Percée : ignore l'armure adverse ;
// - `rooted`   Enraciné : ne peut pas être déplacé par l'effet d'une carte ;
// - `flying`   Vol : son propriétaire peut le changer de zone pendant sa phase principale.
export type Keyword =
  | 'reach'
  | 'taunt'
  | 'protection'
  | 'merchant'
  | 'fury'
  | 'toxic'
  | 'pierce'
  | 'rooted'
  | 'flying';

// Rareté d'une carte (demande utilisateur) : purement indicative pour l'instant — elle
// n'entre dans aucune règle, elle se lit sur la face (gemme et bandeau de type) et sert à
// ranger le catalogue dans le panneau d'administration.
export type CardRarity = 'common' | 'uncommon' | 'rare' | 'legendary';

interface CardDefBase {
  id: string;
  name: string;
  cost: number;
  element: CardElement; // détermine aussi la couleur de fond de la face (theme.elements)
  // Rareté. Absente sur une carte écrite avant cette fonctionnalité (catalogue figé dans une
  // room, document Firestore plus ancien) : à lire via `cardRarity()` de `cards.ts`, qui
  // retombe sur « commune ». `catalogSchema.ts` l'écrit toujours à l'enregistrement.
  rarity?: CardRarity;
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

// Barème de puissance (demande utilisateur). La puissance d'une carte (`cardPower`) est un
// indicateur d'équilibrage affiché dans le panneau d'administration : par défaut, une habileté
// vaut `POWER_PER_KEYWORD` points et une capacité `POWER_PER_ABILITY`, quelles qu'elles soient.
// Ce barème permet de peser chaque habileté et chaque type d'effet de capacité séparément —
// Provocation ne vaut pas Toxic, un soin ne vaut pas une pioche. Les clés absentes gardent la
// valeur fixe historique, si bien qu'un barème vide (ou absent, sur un catalogue écrit avant
// cette fonctionnalité) se comporte exactement comme avant.
export interface PowerWeights {
  keywords: Partial<Record<Keyword, number>>;
  abilities: Partial<Record<AbilityEffect['type'], number>>;
  // Valeur d'un effet d'enchantement (V2, demande utilisateur), comme pour une capacité.
  // Absent = `POWER_PER_ENCHANTMENT`.
  enchantments?: Partial<Record<EnchantmentEffect['type'], number>>;
  // Puissance visée selon la rareté et le coût en pièces (demande utilisateur), indexée par
  // rareté puis par coût (clé '1' à '10', `POWER_TARGET_COSTS`). Repère d'équilibrage seulement.
  // Case absente = `DEFAULT_POWER_TARGETS` (cards.ts).
  targets?: Partial<Record<CardRarity, Partial<Record<string, number>>>>;
}

// Deck prêt à jouer (V2, demande utilisateur) : composé dans l'admin, choisi par le joueur sur
// l'écran de choix du deck avant chaque partie. Le joueur ne construit rien lui-même.
export interface DeckDef {
  id: string;
  name: string;
  // Nombre d'exemplaires de chaque carte, indexé par `CardDef.id` (même forme que
  // `Catalog.starterCounts`). Jouable seulement à `DECK_SIZE` cartes pile (`decks.ts`) : un deck
  // en cours de composition s'enregistre, mais n'est pas proposé aux joueurs.
  counts: Record<string, number>;
}

// Catalogue complet : les cartes existantes et la composition du deck de départ. Éditable
// depuis le panneau d'administration (`ui/admin`), un par version du jeu (`game/versions.ts`),
// stocké dans `catalog/current` pour la V1 et `catalog/<version>` ensuite (`net/catalogStore.ts`) et recopié tel quel dans chaque `Room` à la création d'une partie,
// pour qu'une modification faite en cours de partie ne change pas les cartes sous les pieds
// des joueurs. `version` est incrémentée à chaque enregistrement : elle sert de garde contre
// l'écrasement d'une écriture plus récente (deux onglets d'admin ouverts en même temps).
export interface Catalog {
  version: number;
  cards: CardDef[];
  // Nombre d'exemplaires de chaque carte dans le deck de départ, indexé par `CardDef.id`.
  // Un id absent (ou à 0) veut dire que la carte existe mais n'est pas distribuée.
  // V1 seulement : en V2, toujours vide, les decks à choisir (`decks`) le remplacent.
  starterCounts: Record<string, number>;
  // V2 : decks proposés aux joueurs, dans l'ordre de l'écran de choix. Le premier deck JOUABLE
  // est celui attribué d'office au joueur qui n'a pas choisi à temps. Absent en V1.
  decks?: DeckDef[];
  // Barème de puissance, éditable depuis l'admin. Absent sur un catalogue écrit avant cette
  // fonctionnalité : à lire via `cardPower`, qui retombe sur les valeurs fixes.
  powerWeights?: PowerWeights;
  // Nombre maximal d'exemplaires d'une même carte dans un deck, selon sa rareté (onglet
  // « Paramètres » de l'admin, demande utilisateur). Rareté absente = pas de limite. Un deck V2
  // qui dépasse la limite n'est pas proposé aux joueurs (`decks.ts`).
  maxCopiesByRarity?: Partial<Record<CardRarity, number>>;
  // Version du jeu dont ce catalogue applique les règles. Écrite seulement pour la V2 (absent =
  // V1, ce qui couvre tous les catalogues écrits avant les versions) : c'est par elle que
  // `rules.ts` sait quelles règles appliquer, le catalogue étant figé dans la room.
  gameVersion?: GameVersion;
}

export interface CardInstance {
  uid: string; // unique dans la partie, stable : c'est la key React de la carte
  cardId: string;
  // Carte dorée (monstre ou enchantement), issue de la fusion d'une carte en main avec 2
  // autres exemplaires, posés ou en main (action `fuse`). Absent (et jamais `false`/`undefined` explicite) sur une carte normale.
  golden?: true;
  // Buff permanent cumulé via une capacité (E9), disparaît si la carte quitte le board.
  // Absent tant qu'aucun buff n'a été reçu ; jamais écrit `{ attack: 0, defense: 0 }`.
  buff?: { attack: number; defense: number };
  // --- V2 uniquement (`rulesV2.ts`), tous absents tant qu'ils ne servent pas. Ils disparaissent
  // quand la carte quitte le board (vente, retour au deck). ---
  armor?: number; // armure restante : absorbe les dégâts avant la défense, ne se régénère pas
  shields?: number; // protections à usage unique reçues par effet (« Ajoute une protection »)
  frozen?: true; // gelé : ne participe pas à son prochain combat
  // Brûlure cumulable (demande utilisateur) : nombre de brûlures reçues = défense perdue
  // définitivement à la fin de chacun de ses combats. Une extinction (effet `extinguish`) la
  // retire, pas la défense déjà perdue.
  burn?: number;
  // Silence : ses capacités ne se déclenchent plus jusqu'à la fin de son prochain combat (ses
  // habiletés, elles, restent actives).
  silenced?: true;
  // Enraciné (état, distinct de l'habileté) : ni effet ni son joueur ne peuvent le changer de
  // zone ou de position, jusqu'au début du prochain tour du joueur `rootedBy`, qui l'a enraciné.
  rootedBy?: Seat;
  wounds?: number; // défense perdue définitivement (brûlure)
  token?: true; // créature invoquée par un effet : disparaît au lieu de retourner au deck
}

export type Slot = CardInstance | null;

export interface PlayerState {
  hp: number;
  coins: number;
  turnsPlayed: number; // tours commencés par CE joueur : base du gain de pièces (R1)
  deck: CardInstance[]; // le haut du deck est la fin du tableau, le fond est le début
  market: CardInstance[]; // marché du tour en cours ; accessible tant que la phase 'main' dure, vidé à la fin du tour
  hand: CardInstance[];
  // Longueurs fixes 5 / 5 / 3. Rangée compacte : les cartes en tête (index 0 = la plus à
  // gauche), les `null` en fin — à lire via `zoneCards` (rules.ts), un état plus ancien
  // pouvant encore avoir des trous.
  zones: Record<Zone, Slot[]>;
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
  // V2 : capacité nominale des zones. Un effet peut faire dépasser une zone (modifsV2.md), le
  // tableau `zones[zone]` grandit alors au-delà : sa longueur n'est plus la capacité. Absent
  // (V1, états plus anciens) = la longueur du tableau, qui ne dépasse jamais.
  zoneSizes?: Record<Zone, number>;
}

export type Action =
  | { type: 'beginTurn' }
  | { type: 'buy'; uid: string }
  // Pose une carte de la main dans une zone, insérée à la position `slot` de sa rangée
  // compacte (demande utilisateur) : 0 = tout à gauche, nombre de cartes posées = tout à
  // droite, entre les deux = entre deux cartes, qui s'écartent pour lui faire place.
  | { type: 'place'; uid: string; zone: Zone; slot: number }
  // Déplace une carte déjà posée ailleurs dans la rangée de sa zone (attaque ou défense) :
  // on ne peut pas changer de zone en la déplaçant (demande utilisateur). `slot` = sa
  // position une fois déplacée, les cartes entre l'ancienne et la nouvelle se décalent d'un
  // cran. Un seul déplacement par zone et par tour (`PlayerState.movesUsed`) : les cartes
  // décalées ne comptent pas.
  // V2 : `zone` présente et différente de celle de la carte = changement de zone, réservé à
  // un monstre qui a Vol. Absente = même zone, comme en V1.
  | { type: 'move'; uid: string; slot: number; zone?: MonsterZone }
  // V2 : réponse au choix de cible en attente (`GameState.pendingChoice`). `uid: null` =
  // renoncer à l'effet. `slot` : pour `moveSlot`, la nouvelle position du monstre choisi.
  | { type: 'chooseTarget'; uid: string | null; slot?: number }
  // Relance le marché contre `MARKET_REROLL_COST` pièce (demande utilisateur) : les cartes
  // non verrouillées repartent au fond du deck et le marché est complété depuis le dessus
  // jusqu'à `MARKET_SIZE` cartes, même après un achat. Répétable tant que le joueur paie.
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
  // Portée : dégâts collatéraux aux voisins de la cible, dans l'ordre de la rangée.
  splash?: { uid: string; damage: number; remaining: number; effective: boolean }[];
  // Furie : dégâts en excès reportés sur le défenseur suivant après un défenseur tué.
  overflow?: { uid: string; damage: number; remaining: number } | null;
  // Protection : monstres dont la protection a absorbé les dégâts de ce coup — attaque,
  // riposte, mais aussi dégâts collatéraux de Portée ou de Furie, qui la cassent eux aussi.
  absorbedUids?: string[];
  effects: EffectLog[]; // effets résolus pendant l'échange, dans l'ordre (E5)
  hp: Record<Seat, number>; // PV des deux joueurs après l'échange, effets compris
  // V2 : zones de monstres des deux joueurs après l'échange (armure, cartes déplacées ou
  // invoquées pendant le combat). Absent en V1, où le board ne change pas pendant un combat.
  board?: BoardSnapshot;
}

// Zones de monstres des deux joueurs à un instant du combat (V2), pour la lecture animée.
export type BoardSnapshot = Record<Seat, Record<MonsterZone, CardInstance[]>>;

// V2 : effet de capacité en attente d'une cible choisie par le joueur `seat` (effets
// « monstre choisi », voir `AbilityEffect`). `queue` : les effets suivants de la même carte et
// du même déclencheur, à résoudre après celui-ci, dans l'ordre (E2).
export interface PendingChoice {
  seat: Seat;
  sourceUid: string;
  cardId: string;
  trigger: Trigger;
  effect: AbilityEffect;
  queue: AbilityEffect[];
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
  // `from`/`to` : positions dans la rangée compacte, avant et après le déplacement.
  | {
      id: number;
      type: 'move';
      seat: Seat;
      uid: string;
      zone: MonsterZone;
      from: number;
      to: number;
      toZone?: MonsterZone; // V2 Vol : zone d'arrivée, si elle diffère de `zone`
    }
  // V2 : un choix de cible vient d'être résolu (ou abandonné, `uid: null`).
  | { id: number; type: 'choice'; seat: Seat; uid: string | null; effects: EffectLog[] }
  // `uid` : la carte en main devenue dorée ; `fusedUids` : les 2 exemplaires absorbés (posés ou en main).
  | { id: number; type: 'fuse'; seat: Seat; uid: string; fusedUids: string[] }
  | { id: number; type: 'sell'; seat: Seat; uid: string; zone: Zone | 'hand'; slot: number; effects: EffectLog[] }
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
      // V2 : board au début du combat et juste après les effets « Début du combat ».
      boardBefore?: BoardSnapshot;
      boardAfterStart?: BoardSnapshot;
      // V2 : monstres renvoyés au fond du deck par leur brûlure à la fin du combat.
      burnedOut?: { seat: Seat; uid: string; cardId: string }[];
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
  // V2 : effet en attente d'une cible choisie par le joueur actif. Tant qu'il est là, seule
  // l'action `chooseTarget` est permise. Absent = rien en attente.
  pendingChoice?: PendingChoice;
}

export interface PlayerInfo {
  id: string;
  name: string;
}

export interface Room {
  code: string;
  // `choosingDecks` (V2) : les deux joueurs sont assis et choisissent leur deck (`deckChoice`),
  // `state` reste null jusqu'au démarrage de la partie.
  status: 'waiting' | 'choosingDecks' | 'playing' | 'finished';
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
  // Variante de règles choisie à la création de la room (demande utilisateur) : nombre
  // maximal de cartes par zone de monstres, repris à chaque revanche. Absent sur les rooms
  // créées avant les variantes : à lire via `room.monsterZoneSize ?? DEFAULT_MONSTER_ZONE_SIZE`.
  monsterZoneSize?: number;
  // Version du jeu choisie à la création de la room (voir `game/versions.ts`) : elle désigne le
  // catalogue recopié dans `catalog`, à la première partie comme à chaque revanche. Absent sur
  // les rooms créées avant les versions : à lire via `room.gameVersion ?? DEFAULT_GAME_VERSION`.
  gameVersion?: GameVersion;
  // V2 : deck validé par chaque siège (id dans `catalog.decks`), null tant qu'il n'a pas choisi.
  // Conservé pendant la partie, remis à null à chaque revanche (on rechoisit son deck). Le choix
  // adverse n'est pas affiché avant la partie, mais il est lisible dans la room : simple
  // discrétion d'interface, pas un secret.
  deckChoice?: Record<Seat, string | null>;
  // V2 : fin du choix des decks (Date.now() du client qui a ouvert le choix + `DECK_CHOICE_MS`).
  // Passé ce délai, le premier client qui le constate attribue le deck par défaut aux sièges qui
  // n'ont pas validé et démarre la partie.
  deckDeadline?: number;
}
