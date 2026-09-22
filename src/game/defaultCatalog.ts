import type { CardDef, Catalog } from './types';

// Catalogue de référence, livré avec le code. Depuis l'ajout du panneau d'administration, ce
// n'est plus le catalogue joué : il sert de GRAINE (le bouton « Importer les cartes livrées
// avec le jeu » écrit ces cartes dans le catalogue partagé) et de REPLI quand aucun catalogue
// n'a encore été enregistré. Le catalogue réellement utilisé par une partie est celui figé
// dans sa `Room` ; voir `cards.ts` (`setActiveCatalog`) et `net/catalogStore.ts`.
//
// C'est aussi le catalogue sur lequel portent les tests : `rules.test.ts` et `cardArt.test.ts`
// vérifient qu'il est cohérent et entièrement illustré. Les commentaires d'équilibrage
// ci-dessous décrivent donc l'état livré, pas d'éventuelles modifications faites dans l'admin.
//
// Catalogue des règles v1 — voir PLAN-tcg-proto-regles-v1.md §4. Valeurs de départ, à
// équilibrer en jouant.
//
// PLAN-effets-triggers.md §5 : batch de cartes de test des capacités (déclencheur → effet),
// un par carte au minimum, chaque déclencheur au moins deux fois et chaque effet au moins
// une fois. Les valeurs sont volontairement simples ; l'équilibrage n'est pas l'objet.
//
// Équilibrage v7 (10 PV, 2 pièces de départ, percée à 1 dégât par attaquant survivant) :
// ajusté avec une simulation IA gloutonne contre IA gloutonne. Principes : aucune carte ne doit
// rapporter plus qu'elle ne coûte une fois vendue (la vente rend 1 pièce) ; les effets
// répétés à chaque combat (Défend, KO) restent petits, les PV étant rares.
//
// v8 : le buff Attaque du Chevalier et les dégâts Défend du Golem ne se déclenchent plus
// qu'une fois par combat (`oncePerCombat`), plus à chaque cycle (demande utilisateur).
//
// v10 : les capacités et l'aura d'un monstre doré sont doublées (demande utilisateur).
//
// v11 : deck ramené à 50 cartes et rééquilibrage par simulation (bots gloutons, 3 000
// parties par carte, en mesurant le taux de victoire d'un bot qui évite / privilégie chaque
// carte). Écuyer : son « KO : pioche 1 carte » se redéclenchait à chaque combat et en faisait
// de loin la meilleure carte ; Archère, Druidesse et Mage des tempêtes (dégâts/soins directs,
// les PV étant rares) plus chers ; enchantements de monstres et Trésorerie renforcés ou moins
// chers, car presque jamais rentables.
//
// v12 : habiletés (mots-clés, `Keyword`) — demande utilisateur. Les habiletés sont posées sur
// des cartes existantes (Portée/Provocation/Protection/Négociant/Furie) et sur 5 nouvelles
// cartes, deck porté à 60. Coûts ajustés par simulation (bots gloutons) pour que chaque
// habileté reste payante sans dominer : voir le commentaire de chaque carte touchée.

const DEFAULT_CARDS: CardDef[] = [
  {
    kind: 'monster',
    id: 'squire',
    name: 'Écuyer',
    cost: 2, // à 1, achat + Invoqué + vente rapportait une pièce nette
    attack: 1,
    defense: 2,
    element: 'air',
    abilities: [{ trigger: 'summon', effect: { type: 'gainCoins', amount: 1 } }],
  },
  {
    kind: 'monster',
    id: 'wolf',
    name: 'Loup gris',
    cost: 2,
    attack: 3,
    defense: 1,
    element: 'earth',
    abilities: [
      { trigger: 'attack', effect: { type: 'bonusDamage', amount: 2 } },
      { trigger: 'sold', effect: { type: 'healSelf', amount: 1 } },
    ],
  },
  {
    kind: 'monster',
    id: 'guard',
    name: 'Garde du pont',
    cost: 3, // v12 : +1 (Provocation, qui force l'adversaire à traverser ses 4 défense)
    attack: 1,
    defense: 4,
    element: 'water',
    keywords: ['taunt'],
    abilities: [{ trigger: 'defend', effect: { type: 'shield', amount: 1 } }],
  },
  {
    kind: 'monster',
    id: 'archer',
    name: 'Archère',
    cost: 4,
    attack: 3,
    defense: 1,
    element: 'air',
    keywords: ['reach'], // v12 : sa flèche éclabousse les voisins de sa cible
    abilities: [{ trigger: 'summon', effect: { type: 'damageOpponent', amount: 1 } }],
  },
  {
    kind: 'monster',
    id: 'knight',
    name: 'Chevalier',
    cost: 4,
    attack: 4,
    defense: 4,
    element: 'fire',
    abilities: [
      { trigger: 'attack', effect: { type: 'buff', target: 'self', attack: 1, defense: 0 }, oncePerCombat: true },
    ],
  },
  {
    kind: 'monster',
    id: 'golem',
    name: 'Golem de pierre',
    cost: 7, // v12 : +1 (Protection sur 8 de défense allongeait trop les combats)
    attack: 1,
    defense: 8,
    element: 'earth',
    keywords: ['protection'],
    abilities: [{ trigger: 'defend', effect: { type: 'damageOpponent', amount: 1 }, oncePerCombat: true }],
  },
  {
    kind: 'monster',
    id: 'drake',
    name: 'Drake',
    cost: 7, // v12 : +1, la Furie a fait de ses 5 d'attaque la carte la plus rentable
    attack: 5,
    defense: 4,
    element: 'fire',
    keywords: ['fury'], // v12 : 5 d'attaque déborde souvent sur le défenseur suivant
    abilities: [{ trigger: 'ko', effect: { type: 'healSelf', amount: 2 } }],
  },
  {
    kind: 'monster',
    id: 'titan',
    name: 'Titan',
    cost: 8,
    attack: 7,
    defense: 7,
    element: 'water',
    aura: { attack: 1, defense: 1 }, // continu, comme un enchantement (demande utilisateur)
  },
  // Début du combat : ne se déclenche que si la carte combat (en attaque à ton tour, en défense
  // quand l'adversaire t'attaque avec au moins un monstre), donc au plus une fois par manche.
  {
    kind: 'monster',
    id: 'druid',
    name: 'Druidesse',
    cost: 4,
    attack: 1,
    defense: 3,
    element: 'earth',
    abilities: [{ trigger: 'combatStart', effect: { type: 'healSelf', amount: 1 } }],
  },
  {
    kind: 'monster',
    id: 'stormMage',
    name: 'Mage des tempêtes',
    cost: 6,
    attack: 2,
    defense: 2,
    element: 'air',
    abilities: [{ trigger: 'combatStart', effect: { type: 'damageOpponent', amount: 1 } }],
  },

  {
    kind: 'monster',
    id: 'peddler',
    name: 'Colporteur',
    cost: 3,
    attack: 2,
    defense: 2,
    element: 'water',
    keywords: ['merchant'], // v12 : revendu 2 pièces, il ne coûte que 1 pièce nette
    abilities: [{ trigger: 'summon', effect: { type: 'extraMarketCard', count: 1 } }],
  },

  // --- v12 : nouvelles cartes bâties autour d'une habileté (demande utilisateur) ---
  {
    kind: 'monster',
    id: 'harpooner',
    name: 'Harponneuse',
    cost: 3,
    attack: 2,
    defense: 2,
    element: 'water',
    keywords: ['reach'],
  },
  {
    kind: 'monster',
    id: 'berserker',
    name: 'Berserker',
    cost: 3, // à 4, l'éviter faisait gagner : 2 de défense, il ne déborde qu'une fois
    attack: 4,
    defense: 2,
    element: 'fire',
    keywords: ['fury'], // grosse attaque, peu de défense : il déborde une fois puis tombe
  },
  {
    kind: 'monster',
    id: 'sentinel',
    name: "Sentinelle d'acier",
    cost: 5,
    attack: 2,
    defense: 5,
    element: 'water',
    keywords: ['taunt', 'protection'], // mur pur : il encaisse le premier coup puis bloque la file
  },
  {
    kind: 'monster',
    id: 'spider',
    name: 'Araignée venimeuse',
    cost: 4, // Toxic tue n'importe quoi : c'est sa défense, pas son attaque, qui fixe son prix
    attack: 1,
    defense: 4,
    element: 'earth',
    keywords: ['toxic'],
  },
  {
    kind: 'monster',
    id: 'wasp',
    name: 'Guêpe tueuse',
    cost: 2, // à 3, la préférer faisait perdre : elle meurt à la première riposte
    attack: 1,
    defense: 1,
    element: 'air',
    keywords: ['toxic'], // échange à sens unique : elle tue une grosse carte et meurt à la riposte
  },
  {
    kind: 'monster',
    id: 'relicKeeper',
    name: 'Gardien des reliques',
    cost: 2,
    attack: 1,
    defense: 3,
    element: 'earth',
    keywords: ['merchant'], // acheté 2, revendu 2 : un mur que l'on recycle sans perte
  },

  {
    kind: 'enchantment',
    id: 'banner',
    name: 'Étendard de guerre',
    cost: 2,
    element: 'fire',
    effect: { type: 'monsterBuff', zone: 'attack', attack: 1, defense: 1 },
  },
  {
    kind: 'enchantment',
    id: 'rampart',
    name: 'Rempart',
    cost: 1, // riposte renforcée ; +1 défense (même à 2 ou 3 +1/+1) ne valait jamais son prix
    element: 'earth',
    effect: { type: 'monsterBuff', zone: 'defense', attack: 1, defense: 0 },
  },
  {
    kind: 'enchantment',
    id: 'treasury',
    name: 'Trésorerie',
    cost: 2, // les parties sont courtes : à 3, elle n'était presque jamais rentabilisée
    element: 'water',
    effect: { type: 'coinsPerTurn', amount: 1 },
  },
  {
    kind: 'enchantment',
    id: 'blessing',
    name: 'Bénédiction',
    cost: 4,
    element: 'water',
    effect: { type: 'monsterBuff', zone: 'all', attack: 1, defense: 1 },
  },
];

// Nombre d'exemplaires de chaque carte dans le deck de départ (v12 : 60 cartes au total,
// 48 monstres et 12 enchantements — même proportion qu'avec les 50 cartes de la v11).
// Les cartes à habileté restent minoritaires pour qu'une manche n'en montre pas que ça.
const DEFAULT_STARTER_COUNTS: Record<string, number> = {
  squire: 4,
  wolf: 4,
  guard: 4,
  archer: 4,
  druid: 2,
  knight: 4,
  stormMage: 2,
  golem: 3,
  drake: 3,
  titan: 2,
  peddler: 2,
  harpooner: 3,
  berserker: 3,
  sentinel: 2,
  spider: 2,
  wasp: 2,
  relicKeeper: 2,
  banner: 3,
  rampart: 3,
  treasury: 3,
  blessing: 3,
};

// Version du catalogue livré. Le catalogue enregistré dans le stockage partagé porte sa
// propre version, incrémentée à chaque enregistrement depuis l'admin (voir `catalogStore.ts`).
export const DEFAULT_CATALOG_VERSION = 1;

export const DEFAULT_CATALOG: Catalog = {
  version: DEFAULT_CATALOG_VERSION,
  cards: DEFAULT_CARDS,
  starterCounts: DEFAULT_STARTER_COUNTS,
};
