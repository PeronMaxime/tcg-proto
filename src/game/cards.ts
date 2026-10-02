import { DEFAULT_CATALOG } from './defaultCatalog';
import type {
  AbilityEffect,
  CardAbility,
  CardDef,
  CardElement,
  CardInstance,
  CardRarity,
  Catalog,
  EnchantmentEffect,
  Keyword,
  MonsterDef,
  PowerWeights,
  Trigger,
  WheelElement,
} from './types';
import type { GameVersion } from './versions';
import {
  abilityEffectTypesFor,
  enchantmentEffectTypesFor,
  isPositionalEffect,
  needsChosenTarget,
} from './vocabulary';

// ---------------------------------------------------------------------------------------
// Catalogue actif
// ---------------------------------------------------------------------------------------
// Les cartes ne sont plus codées en dur : elles viennent du panneau d'administration, et
// chaque partie fige le catalogue avec lequel elle a été créée (`Room.catalog`). Pour autant,
// `getCardDef` reste SYNCHRONE : il est appelé à chaque image par la scène 3D
// (`textures.ts`, `Card.tsx`, `Board.tsx`) et par toute la logique de `rules.ts`. On garde
// donc un catalogue actif en variable de module, que la couche réseau installe via
// `setActiveCatalog` AVANT de créer un état de partie ou de rendre le plateau.
//
// Ce module reste une brique de données pure : il ne dépend ni de `rules.ts`, ni de React,
// ni de la scène. C'est l'appelant de `setActiveCatalog` qui se charge d'invalider les
// textures en cache (voir `scene/textures.ts`, `invalidateCardTextures`).

let activeCatalog: Catalog = DEFAULT_CATALOG;
let activeById: Map<string, CardDef> = indexCards(DEFAULT_CATALOG.cards);

function indexCards(cards: CardDef[]): Map<string, CardDef> {
  return new Map(cards.map((card) => [card.id, card]));
}

// Installe le catalogue utilisé par tout le reste du code. Idempotent : réinstaller le même
// objet ne coûte rien de plus que la reconstruction de l'index.
export function setActiveCatalog(catalog: Catalog): void {
  activeCatalog = catalog;
  activeById = indexCards(catalog.cards);
}

export function getActiveCatalog(): Catalog {
  return activeCatalog;
}

// Toutes les cartes du catalogue actif, dans l'ordre où l'admin les a rangées.
export function getAllCardDefs(): CardDef[] {
  return activeCatalog.cards;
}

// Version du jeu dont le catalogue actif applique les règles (`Catalog.gameVersion`, absent =
// V1). Les règles (`rules.ts`) et les textes des cartes la lisent ici, comme `getCardDef` lit
// les cartes : une partie V2 installe un catalogue V2.
export function activeGameVersion(): GameVersion {
  return activeCatalog.gameVersion ?? 'v1';
}

export function isV2Active(): boolean {
  return activeGameVersion() === 'v2';
}

export function getCardDef(cardId: string): CardDef {
  const def = findCardDef(cardId);
  if (!def) throw new Error(`Carte inconnue: ${cardId}`);
  return def;
}

// Comme `getCardDef`, mais rend `null` au lieu de lever. À utiliser partout où l'id peut
// légitimement être absent du catalogue actif — typiquement une room figée sur un catalogue
// plus ancien, ou l'aperçu de l'admin pendant une saisie.
export function findCardDef(cardId: string): CardDef | null {
  return activeById.get(cardId) ?? tokenDef(cardId);
}

// ---------------------------------------------------------------------------------------
// Créatures invoquées (V2, effet `summonToken`). Elles n'existent dans aucun catalogue : leur
// définition se déduit de leur id, `token-<élément>-<attaque>-<défense>`. Le tiret est refusé
// dans un id de carte (`CARD_ID_PATTERN`), une carte du catalogue ne peut donc pas le porter.
// ---------------------------------------------------------------------------------------

const TOKEN_PREFIX = 'token-';
const TOKEN_NAMES: Record<CardElement, string> = {
  fire: 'Flammèche',
  water: 'Ondine',
  air: 'Zéphyr',
  earth: 'Golemite',
  neutral: 'Automate',
};

export function tokenCardId(element: CardElement, attack: number, defense: number): string {
  return `${TOKEN_PREFIX}${element}-${attack}-${defense}`;
}

export function isTokenCardId(cardId: string): boolean {
  return cardId.startsWith(TOKEN_PREFIX);
}

// Une même définition par id : la scène compare les définitions par référence (`useMemo`).
const tokenDefs = new Map<string, MonsterDef | null>();

function tokenDef(cardId: string): MonsterDef | null {
  if (!isTokenCardId(cardId)) return null;
  if (!tokenDefs.has(cardId)) tokenDefs.set(cardId, buildTokenDef(cardId));
  return tokenDefs.get(cardId)!;
}

function buildTokenDef(cardId: string): MonsterDef | null {
  const [element, attack, defense] = cardId.slice(TOKEN_PREFIX.length).split('-');
  if (!(element in TOKEN_NAMES)) return null;
  const a = Number(attack);
  const d = Number(defense);
  if (!Number.isInteger(a) || !Number.isInteger(d)) return null;
  return {
    kind: 'monster',
    id: cardId,
    name: TOKEN_NAMES[element as CardElement],
    cost: 0,
    element: element as CardElement,
    rarity: 'common',
    attack: a,
    defense: d,
  };
}

export function isMonster(def: CardDef): def is MonsterDef {
  return def.kind === 'monster';
}

// Roue des éléments (demande utilisateur) : chaque élément est efficace contre celui qu'il
// pointe — eau > feu > air > terre > eau. Deux éléments non adjacents (eau/air, feu/terre)
// ou identiques sont neutres l'un pour l'autre.
// Le neutre n'y figure pas : il n'est efficace contre rien, et rien ne l'est contre lui.
export const ELEMENT_BEATS: Record<WheelElement, WheelElement> = {
  water: 'fire',
  fire: 'air',
  air: 'earth',
  earth: 'water',
};

export const ELEMENT_LABELS: Record<CardElement, string> = {
  fire: 'Feu',
  water: 'Eau',
  air: 'Air',
  earth: 'Terre',
  neutral: 'Neutre',
};

export function isElementEffective(from: CardElement, against: CardElement): boolean {
  return from !== 'neutral' && ELEMENT_BEATS[from] === against;
}

// ---------------------------------------------------------------------------------------
// Raretés (demande utilisateur). Aucune règle de jeu n'en dépend : c'est une indication de
// valeur affichée sur la face de la carte (gemme + bandeau de type) et dans l'admin.
// ---------------------------------------------------------------------------------------

export const RARITY_LABELS: Record<CardRarity, string> = {
  common: 'Commune',
  uncommon: 'Peu commune',
  rare: 'Rare',
  legendary: 'Légendaire',
};

// Rareté d'une carte, « commune » par défaut : `CardDef.rarity` est absente des cartes
// écrites avant cette fonctionnalité (catalogue figé dans une room plus ancienne). Tout le
// code d'affichage passe par ici plutôt que de lire `def.rarity` directement.
export function cardRarity(def: CardDef): CardRarity {
  return def.rarity ?? 'common';
}

// ---------------------------------------------------------------------------------------
// Habiletés (mots-clés) — demande utilisateur. Valeurs chiffrées ici (côté données), règles
// dans rules.ts : ce fichier ne dépend jamais de rules.ts (c'est rules.ts qui l'importe).
// ---------------------------------------------------------------------------------------

// Portée : dégâts infligés à CHAQUE voisin de la cible, +1 si le monstre est doré et +1 de
// plus si son élément est efficace contre celui du voisin touché.
export const KEYWORD_REACH_DAMAGE = 1;
export const KEYWORD_REACH_GOLDEN_BONUS = 1;
// Négociant : pièces en plus rendues par la vente (1 → 2, ou 3 → 4 pour une carte dorée).
export const KEYWORD_MERCHANT_BONUS = 1;
// Protection : nombre d'attaques encaissées sans dégât, remis à neuf à chaque combat.
export const KEYWORD_PROTECTION_USES = 1;

// V2 : Portée inflige toujours 1 dégât aux voisins, doré ou non (modifsV2.md).
export const KEYWORD_REACH_DAMAGE_V2 = 1;
// V2 : nombre de coups que porte un monstre Furie à chaque cycle.
export const KEYWORD_FURY_STRIKES_V2 = 2;

export const KEYWORD_LABELS: Record<Keyword, string> = {
  reach: 'Portée',
  taunt: 'Provocation',
  protection: 'Protection',
  merchant: 'Négociant',
  fury: 'Furie',
  toxic: 'Toxic',
  pierce: 'Percée',
  rooted: 'Enraciné',
  flying: 'Vol',
};

// Règle d'une habileté en V2 (modifsV2.md), énoncée sur la face de la carte.
function describeKeywordEffectV2(keyword: Keyword): string {
  switch (keyword) {
    case 'reach':
      return `en attaque, inflige aussi ${KEYWORD_REACH_DAMAGE_V2} dégât aux monstres autour de sa cible`;
    case 'fury':
      return 'en attaque, frappe deux fois';
    case 'taunt':
      return 'en défense, doit être attaqué en priorité';
    case 'protection':
      return 'annule le premier coup reçu à chaque combat';
    case 'toxic':
      return 'tue tout monstre à qui il inflige au moins 1 dégât';
    case 'pierce':
      return "ignore l'armure du monstre qu'il blesse";
    case 'rooted':
      return "ne peut pas être déplacé par l'effet d'une carte";
    case 'flying':
      return 'peut changer de zone pendant ta phase principale';
    case 'merchant':
      return `se vend ${KEYWORD_MERCHANT_BONUS} pièce de plus`;
  }
}

// Texte affiché après le nom de l'habileté sur la face de la carte, ex. « Portée : … ».
// `golden` ne change que Portée (seule habileté chiffrée à profiter de la dorure), en V1.
export function describeKeywordEffect(keyword: Keyword, golden = false): string {
  if (isV2Active()) return describeKeywordEffectV2(keyword);
  switch (keyword) {
    case 'reach': {
      const damage = KEYWORD_REACH_DAMAGE + (golden ? KEYWORD_REACH_GOLDEN_BONUS : 0);
      return `touche aussi les monstres autour de sa cible (${damage} ${pluralize(damage, 'dégât')})`;
    }
    case 'taunt':
      return "doit être attaqué en priorité tant qu'il est en vie";
    case 'protection':
      return 'annule les premiers dégâts reçus à chaque combat';
    case 'merchant':
      return `rapporte ${KEYWORD_MERCHANT_BONUS} pièce de plus à la vente`;
    case 'fury':
      return 'reporte ses dégâts en excès sur le défenseur suivant';
    case 'toxic':
      return 'tue tout monstre à qui il inflige le moindre dégât';
    // Habiletés V2 : un catalogue V1 ne peut pas les porter (`catalogSchema.ts`).
    case 'pierce':
    case 'rooted':
    case 'flying':
      return describeKeywordEffectV2(keyword);
  }
}

// Texte complet affiché sur la face, ex. « Provocation : doit être attaqué en priorité… ».
export function describeKeyword(keyword: Keyword, golden = false): string {
  return `${KEYWORD_LABELS[keyword]} : ${describeKeywordEffect(keyword, golden)}`;
}

// Texte du fil d'effets quand une habileté vient de se déclencher en jeu, ex. « Protection :
// dégâts annulés ». Distinct de `describeKeywordEffect`, qui énonce la règle sur la face de
// la carte : ici on raconte ce qui vient de se passer, au passé, comme pour une capacité.
export function describeKeywordTrigger(keyword: Keyword): string {
  switch (keyword) {
    case 'reach':
      return `${KEYWORD_LABELS.reach} : touche aussi les voisins de sa cible`;
    case 'taunt':
      return `${KEYWORD_LABELS.taunt} : l'attaque est détournée sur lui`;
    case 'protection':
      return `${KEYWORD_LABELS.protection} : les dégâts sont annulés`;
    case 'merchant':
      return `${KEYWORD_LABELS.merchant} : +${KEYWORD_MERCHANT_BONUS} pièce à la vente`;
    case 'fury':
      return isV2Active()
        ? `${KEYWORD_LABELS.fury} : frappe une seconde fois`
        : `${KEYWORD_LABELS.fury} : l'excédent passe au défenseur suivant`;
    case 'toxic':
      return `${KEYWORD_LABELS.toxic} : la cible touchée est tuée`;
    case 'pierce':
      return `${KEYWORD_LABELS.pierce} : l'armure est ignorée`;
    case 'rooted':
      return `${KEYWORD_LABELS.rooted} : il ne bouge pas`;
    case 'flying':
      return `${KEYWORD_LABELS.flying} : il change de zone`;
  }
}

export function hasKeywordDef(def: CardDef, keyword: Keyword): boolean {
  return isMonster(def) && (def.keywords?.includes(keyword) ?? false);
}

export function createCardInstance(cardId: string, makeUid: () => string): CardInstance {
  const def = getCardDef(cardId);
  return { uid: makeUid(), cardId: def.id };
}

// Deck de départ : un exemplaire par unité déclarée dans `counts` — par défaut `starterCounts`
// du catalogue actif (V1), sinon la composition du deck choisi (V2, `decks.ts`).
// Les ids inconnus sont ignorés — `catalogSchema.ts` les refuse à l'enregistrement, ce filet
// évite qu'un catalogue écrit par une version antérieure fasse planter la création de partie.
export function buildStarterDeck(
  makeUid: () => string,
  counts: Record<string, number> = activeCatalog.starterCounts,
): CardInstance[] {
  const deck: CardInstance[] = [];
  for (const [cardId, count] of Object.entries(counts)) {
    if (!activeById.has(cardId)) continue;
    for (let i = 0; i < count; i++) {
      deck.push(createCardInstance(cardId, makeUid));
    }
  }
  return deck;
}

// Valeurs d'un effet d'enchantement multipliées (enchantement doré : `GOLDEN_MULTIPLIER`).
export function scaleEnchantmentEffect(effect: EnchantmentEffect, multiplier: number): EnchantmentEffect {
  if (multiplier === 1) return effect;
  switch (effect.type) {
    case 'coinsPerTurn':
    case 'sellBonus':
      return { ...effect, amount: effect.amount * multiplier };
    case 'marketSize':
      return { ...effect, count: effect.count * multiplier };
    case 'monsterBuff':
      return { ...effect, attack: effect.attack * multiplier, defense: effect.defense * multiplier };
    case 'healBoost':
      return effect; // pas de valeur : le doublement des soins se cumule par enchantement (rulesV2.ts)
  }
}

// Texte affiché sur la face d'un enchantement, généré depuis l'effet — jamais stocké à part.
export function describeEffect(effect: EnchantmentEffect): string {
  switch (effect.type) {
    case 'coinsPerTurn':
      return `+${effect.amount} ${pluralize(effect.amount, 'pièce')} au début de ton tour`;
    case 'healBoost':
      return 'les soins reçus par ton héros sont doublés';
    case 'marketSize':
      return `+${effect.count} ${pluralize(effect.count, 'carte')} à chacun de tes marchés`;
    case 'sellBonus':
      return `tes ventes rapportent ${effect.amount} ${pluralize(effect.amount, 'pièce')} de plus`;
    case 'monsterBuff': {
      const stats =
        effect.attack > 0 && effect.defense > 0
          ? `+${effect.attack}/+${effect.defense}`
          : effect.attack > 0
            ? `+${effect.attack} attaque`
            : `+${effect.defense} défense`;
      switch (effect.zone) {
        case 'attack':
          return `${stats} à tes monstres en attaque`;
        case 'defense':
          return `${stats} à tes monstres en défense`;
        case 'all':
          return `${stats} à tous tes monstres`;
      }
    }
  }
}

// Valeurs d'un effet de capacité multipliées (monstre doré : `GOLDEN_MULTIPLIER`).
export function scaleAbilityEffect(effect: AbilityEffect, multiplier: number): AbilityEffect {
  if (multiplier === 1) return effect;
  switch (effect.type) {
    case 'drawCard':
    case 'extraMarketCard':
      return { ...effect, count: effect.count * multiplier };
    case 'buff':
      return { ...effect, attack: effect.attack * multiplier, defense: effect.defense * multiplier };
    case 'summonToken':
      return { ...effect, attack: effect.attack * multiplier, defense: effect.defense * multiplier };
    // Effets sans valeur : un monstre doré les résout tels quels.
    case 'grantShield':
    case 'burn':
    case 'freeze':
    case 'moveZone':
    case 'moveSlot':
    case 'switchZone':
    case 'extinguish':
    case 'root':
    case 'silence':
      return effect;
    default:
      return { ...effect, amount: effect.amount * multiplier };
  }
}

// Texte affiché sur la face d'un monstre à aura, généré depuis la donnée.
export function describeAura(aura: { attack: number; defense: number }): string {
  const stats =
    aura.attack > 0 && aura.defense > 0
      ? `+${aura.attack}/+${aura.defense}`
      : aura.attack > 0
        ? `+${aura.attack} attaque`
        : `+${aura.defense} défense`;
  return `${stats} à tes autres monstres`;
}

// Libellés affichés des déclencheurs (PLAN-effets-triggers.md §4).
export const TRIGGER_LABELS: Record<Trigger, string> = {
  summon: 'Invoqué',
  combatStart: 'Début du combat',
  attack: 'Attaque',
  defend: 'Défend',
  ko: 'KO',
  sold: 'Vendu',
};

function pluralize(amount: number, word: string): string {
  return amount > 1 ? `${word}s` : word;
}

// Texte d'un effet de capacité, généré depuis sa donnée — jamais stocké à part.
function describeAbilityEffect(effect: AbilityEffect): string {
  switch (effect.type) {
    case 'gainCoins':
      return `+${effect.amount} ${pluralize(effect.amount, 'pièce')}`;
    case 'damageOpponent':
      return `${effect.amount} ${pluralize(effect.amount, 'dégât')} au héros adverse`;
    case 'healSelf':
      return `+${effect.amount} PV à ton héros`;
    case 'drawCard':
      return `pioche ${effect.count} ${pluralize(effect.count, 'carte')}`;
    case 'buff': {
      const stats =
        effect.attack > 0 && effect.defense > 0
          ? `+${effect.attack}/+${effect.defense}`
          : effect.attack > 0
            ? `+${effect.attack} attaque`
            : `+${effect.defense} défense`;
      return effect.target === 'self' ? `gagne ${stats}` : `${stats} à tes autres monstres`;
    }
    case 'bonusDamage':
      return `+${effect.amount} ${pluralize(effect.amount, 'dégât')} sur ce coup`;
    case 'shield':
      return `subit ${effect.amount} ${pluralize(effect.amount, 'dégât')} de moins`;
    case 'extraMarketCard':
      return `+${effect.count} ${pluralize(effect.count, 'carte')} au marché au prochain tour`;
    case 'armorChosen':
      return `+${effect.amount} armure à un de tes monstres`;
    case 'armorZone':
      return `+${effect.amount} armure aux monstres de sa zone`;
    case 'armorBoard':
      return `+${effect.amount} armure à tous tes monstres`;
    case 'armorSelf':
      return `gagne ${effect.amount} armure`;
    case 'grantShield':
      return 'une protection à un de tes monstres';
    case 'summonToken':
      return `invoque une créature ${effect.attack}/${effect.defense}`;
    case 'burn':
      return 'brûle un monstre adverse';
    case 'freeze':
      return 'gèle un monstre adverse';
    case 'moveZone':
      return "change un monstre de zone";
    case 'moveSlot':
      return 'déplace un monstre dans sa zone';
    case 'switchZone':
      return 'change de zone';
    case 'extinguish':
      return "éteint la brûlure d'un de tes monstres";
    case 'root':
      return "enracine un monstre jusqu'à ton prochain tour";
    case 'silence':
      return 'réduit au silence un monstre adverse';
  }
}

// Texte complet d'une capacité affiché sur la face de la carte, ex. « Invoqué : +1 pièce ».
export function describeAbility(ability: CardAbility): string {
  const trigger = TRIGGER_LABELS[ability.trigger] + (ability.oncePerCombat ? ' (1×/combat)' : '');
  return `${trigger} : ${describeAbilityEffect(ability.effect)}`;
}

// E12 (+ combat réservé aux monstres) : `bonusDamage` seulement sur Attaque, `shield`
// seulement sur Défend ; `combatStart`/`attack`/`defend`/`ko` interdits sur un enchantement ; `amount`/
// `count` doivent valoir au moins 1 (E16).
//
// V2 (`version`, par défaut celle du catalogue actif) : seuls les effets de la liste V2
// existent ; un effet à cible choisie ne se déclenche que sur Invoqué ou Vendu (le joueur doit
// pouvoir choisir) ; un effet qui part de la place de la carte demande un monstre, et pas Vendu.
export function isAbilityAllowed(
  def: CardDef,
  ability: CardAbility,
  version: GameVersion = activeGameVersion(),
): boolean {
  const { trigger, effect } = ability;
  if (!abilityEffectTypesFor(version).includes(effect.type)) return false;
  if (effect.type === 'bonusDamage' && trigger !== 'attack') return false;
  if (effect.type === 'shield' && trigger !== 'defend') return false;
  const combatTriggers: Trigger[] = ['combatStart', 'attack', 'defend', 'ko'];
  if (def.kind === 'enchantment' && combatTriggers.includes(trigger)) return false;
  if (needsChosenTarget(effect.type) && trigger !== 'summon' && trigger !== 'sold') return false;
  if (isPositionalEffect(effect.type) && (def.kind !== 'monster' || trigger === 'sold')) return false;

  switch (effect.type) {
    case 'gainCoins':
    case 'damageOpponent':
    case 'healSelf':
    case 'bonusDamage':
    case 'shield':
    case 'armorChosen':
    case 'armorZone':
    case 'armorBoard':
    case 'armorSelf':
      return effect.amount >= 1;
    case 'drawCard':
    case 'extraMarketCard':
      return effect.count >= 1;
    case 'summonToken':
      return effect.attack >= 0 && effect.defense >= 1;
    case 'buff':
    case 'grantShield':
    case 'burn':
    case 'freeze':
    case 'moveZone':
    case 'moveSlot':
    case 'switchZone':
    case 'extinguish':
    case 'root':
    case 'silence':
      return true;
  }
}

// V2 : effets d'enchantement admis par la version.
export function isEnchantmentEffectAllowed(
  effect: EnchantmentEffect,
  version: GameVersion = activeGameVersion(),
): boolean {
  return enchantmentEffectTypesFor(version).includes(effect.type);
}

// ---------------------------------------------------------------------------------------
// Puissance d'une carte (demande utilisateur). Indicateur d'équilibrage affiché dans le
// panneau d'administration UNIQUEMENT : aucune règle de jeu ne le lit, rien n'est stocké
// dans le catalogue — il se recalcule depuis la définition à chaque affichage.
//
// Barème : attaque + défense, plus la valeur de chaque habileté (mot-clé), de chaque
// capacité et de l'aura. Les valeurs des habiletés et des capacités viennent du barème du
// catalogue (`Catalog.powerWeights`, éditable dans l'onglet « Paramètres » de l'admin) ; une
// entrée absente vaut la valeur fixe ci-dessous, celle d'avant le barème.
// ---------------------------------------------------------------------------------------

export const POWER_PER_KEYWORD = 2;
export const POWER_PER_ABILITY = 1;
export const POWER_PER_AURA = 1;

// Valeur d'une habileté et d'un type d'effet de capacité selon un barème. `weights` absent
// (catalogue d'avant le barème, ou barème incomplet) = valeur fixe historique.
export function keywordWeight(keyword: Keyword, weights?: PowerWeights): number {
  return weights?.keywords?.[keyword] ?? POWER_PER_KEYWORD;
}

export function abilityWeight(effect: AbilityEffect['type'], weights?: PowerWeights): number {
  return weights?.abilities?.[effect] ?? POWER_PER_ABILITY;
}

// Effet d'enchantement (V2, demande utilisateur) : même principe qu'une capacité, une valeur
// par type d'effet. Ne compte que pour un catalogue V2 : la puissance des enchantements V1
// reste celle d'avant.
export const POWER_PER_ENCHANTMENT = 1;

export function enchantmentWeight(effect: EnchantmentEffect['type'], weights?: PowerWeights): number {
  return weights?.enchantments?.[effect] ?? POWER_PER_ENCHANTMENT;
}

// Points ajoutés selon la valeur de l'effet (demande utilisateur) : le barème donne ce que
// vaut l'effet à une seule unité, et chaque unité au-delà de la première ajoute 1 point —
// des dégâts à 3 pesant 3 au barème valent donc 5. Pour un effet à deux valeurs (+X/+Y,
// créature X/Y), 1 point par paire au-delà de la première : +2/+2 ajoute 1, +3/+3 ajoute 2,
// +2/+1 n'ajoute rien. Un effet sans valeur (gel, silence…) n'ajoute rien.
export function effectAmountBonus(effect: AbilityEffect | EnchantmentEffect): number {
  if ('attack' in effect) return Math.max(0, Math.floor((effect.attack + effect.defense) / 2) - 1);
  if ('amount' in effect) return Math.max(0, effect.amount - 1);
  if ('count' in effect) return Math.max(0, effect.count - 1);
  return 0;
}

// Ce que pèse un effet de capacité ou d'enchantement : sa valeur au barème, plus son bonus de
// valeur.
export function abilityPower(effect: AbilityEffect, weights?: PowerWeights): number {
  return abilityWeight(effect.type, weights) + effectAmountBonus(effect);
}

export function enchantmentPower(effect: EnchantmentEffect, weights?: PowerWeights): number {
  return enchantmentWeight(effect.type, weights) + effectAmountBonus(effect);
}

// Puissance visée selon la rareté et le coût (demande utilisateur) : le repère auquel comparer
// la puissance d'une carte. Une ligne par rareté, une colonne par coût de 1 à 10 pièces ; le
// barème du catalogue (`PowerWeights.targets`) remplace case par case ces valeurs par défaut.
export const POWER_TARGET_COSTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export const DEFAULT_POWER_TARGETS: Record<CardRarity, readonly number[]> = {
  common: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20],
  uncommon: [3, 5, 7, 9, 11, 13, 15, 17, 19, 21],
  rare: [4, 7, 10, 13, 16, 19, 22, 25, 28, 31],
  legendary: [5, 9, 13, 17, 21, 25, 29, 33, 37, 41],
};

// Puissance visée pour une rareté et un coût. `undefined` hors de la grille (coût 0 ou > 10).
export function powerTarget(rarity: CardRarity, cost: number, weights?: PowerWeights): number | undefined {
  return weights?.targets?.[rarity]?.[String(cost)] ?? DEFAULT_POWER_TARGETS[rarity][cost - 1];
}

// Écart entre la puissance d'une carte et celle visée pour sa rareté et son coût (demande
// utilisateur) : positif = trop forte, négatif = trop faible, 0 = pile dans le barème.
// `null` quand le coût sort de la grille (aucune valeur visée à comparer).
export interface PowerBalance {
  power: number;
  target: number;
  gap: number;
}

export function powerBalance(
  def: CardDef,
  weights: PowerWeights | undefined = activeCatalog.powerWeights,
): PowerBalance | null {
  const target = powerTarget(cardRarity(def), def.cost, weights);
  if (target === undefined) return null;
  const power = cardPower(def, weights).total;
  return { power, target, gap: power - target };
}

export interface CardPower {
  total: number;
  stats: number; // attaque + défense (0 pour un enchantement, qui ne combat pas)
  keywords: number;
  abilities: number;
  aura: number;
  enchantment: number; // effet d'un enchantement, en V2 seulement (0 sinon)
}

// `weights` par défaut : celui du catalogue actif. Le panneau d'administration installe son
// brouillon comme catalogue actif à chaque frappe (`useCatalogAdmin`), donc l'affichage suit
// le barème en cours d'édition sans avoir à le passer partout — mais on peut toujours le
// donner explicitement, notamment pour comparer deux barèmes.
export function cardPower(def: CardDef, weights: PowerWeights | undefined = activeCatalog.powerWeights): CardPower {
  const stats = isMonster(def) ? def.attack + def.defense : 0;
  const keywords = isMonster(def)
    ? (def.keywords ?? []).reduce((sum, keyword) => sum + keywordWeight(keyword, weights), 0)
    : 0;
  const abilities = (def.abilities ?? []).reduce(
    (sum, ability) => sum + abilityPower(ability.effect, weights),
    0,
  );
  const aura = isMonster(def) && def.aura ? POWER_PER_AURA : 0;
  const enchantment = !isMonster(def) && isV2Active() ? enchantmentPower(def.effect, weights) : 0;
  return { total: stats + keywords + abilities + aura + enchantment, stats, keywords, abilities, aura, enchantment };
}
