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
} from './types';

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

export function getCardDef(cardId: string): CardDef {
  const def = activeById.get(cardId);
  if (!def) throw new Error(`Carte inconnue: ${cardId}`);
  return def;
}

// Comme `getCardDef`, mais rend `null` au lieu de lever. À utiliser partout où l'id peut
// légitimement être absent du catalogue actif — typiquement une room figée sur un catalogue
// plus ancien, ou l'aperçu de l'admin pendant une saisie.
export function findCardDef(cardId: string): CardDef | null {
  return activeById.get(cardId) ?? null;
}

export function isMonster(def: CardDef): def is MonsterDef {
  return def.kind === 'monster';
}

// Roue des éléments (demande utilisateur) : chaque élément est efficace contre celui qu'il
// pointe — eau > feu > air > terre > eau. Deux éléments non adjacents (eau/air, feu/terre)
// ou identiques sont neutres l'un pour l'autre.
export const ELEMENT_BEATS: Record<CardElement, CardElement> = {
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
};

export function isElementEffective(from: CardElement, against: CardElement): boolean {
  return ELEMENT_BEATS[from] === against;
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

export const KEYWORD_LABELS: Record<Keyword, string> = {
  reach: 'Portée',
  taunt: 'Provocation',
  protection: 'Protection',
  merchant: 'Négociant',
  fury: 'Furie',
  toxic: 'Toxic',
};

// Texte affiché après le nom de l'habileté sur la face de la carte, ex. « Portée : … ».
// `golden` ne change que Portée (seule habileté chiffrée à profiter de la dorure).
export function describeKeywordEffect(keyword: Keyword, golden = false): string {
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
      return `${KEYWORD_LABELS.fury} : l'excédent passe au défenseur suivant`;
    case 'toxic':
      return `${KEYWORD_LABELS.toxic} : la cible touchée est tuée`;
  }
}

export function hasKeywordDef(def: CardDef, keyword: Keyword): boolean {
  return isMonster(def) && (def.keywords?.includes(keyword) ?? false);
}

export function createCardInstance(cardId: string, makeUid: () => string): CardInstance {
  const def = getCardDef(cardId);
  return { uid: makeUid(), cardId: def.id };
}

// Deck de départ : un exemplaire par unité déclarée dans `starterCounts` du catalogue actif.
// Les ids inconnus sont ignorés — `catalogSchema.ts` les refuse à l'enregistrement, ce filet
// évite qu'un catalogue écrit par une version antérieure fasse planter la création de partie.
export function buildStarterDeck(makeUid: () => string): CardInstance[] {
  const deck: CardInstance[] = [];
  for (const [cardId, count] of Object.entries(activeCatalog.starterCounts)) {
    if (!activeById.has(cardId)) continue;
    for (let i = 0; i < count; i++) {
      deck.push(createCardInstance(cardId, makeUid));
    }
  }
  return deck;
}

// Texte affiché sur la face d'un enchantement, généré depuis l'effet — jamais stocké à part.
export function describeEffect(effect: EnchantmentEffect): string {
  switch (effect.type) {
    case 'coinsPerTurn':
      return `+${effect.amount} pièce au début de ton tour`;
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
export function isAbilityAllowed(def: CardDef, ability: CardAbility): boolean {
  const { trigger, effect } = ability;
  if (effect.type === 'bonusDamage' && trigger !== 'attack') return false;
  if (effect.type === 'shield' && trigger !== 'defend') return false;
  const combatTriggers: Trigger[] = ['combatStart', 'attack', 'defend', 'ko'];
  if (def.kind === 'enchantment' && combatTriggers.includes(trigger)) return false;

  switch (effect.type) {
    case 'gainCoins':
    case 'damageOpponent':
    case 'healSelf':
    case 'bonusDamage':
    case 'shield':
      return effect.amount >= 1;
    case 'drawCard':
    case 'extraMarketCard':
      return effect.count >= 1;
    case 'buff':
      return true;
  }
}

// ---------------------------------------------------------------------------------------
// Puissance d'une carte (demande utilisateur). Indicateur d'équilibrage affiché dans le
// panneau d'administration UNIQUEMENT : aucune règle de jeu ne le lit, rien n'est stocké
// dans le catalogue — il se recalcule depuis la définition à chaque affichage.
//
// Barème : attaque + défense, plus la valeur de chaque habileté (mot-clé), de chaque
// capacité et de l'aura. Les valeurs des habiletés et des capacités viennent du barème du
// catalogue (`Catalog.powerWeights`, éditable dans l'onglet « Puissances » de l'admin) ; une
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

export interface CardPower {
  total: number;
  stats: number; // attaque + défense (0 pour un enchantement, qui ne combat pas)
  keywords: number;
  abilities: number;
  aura: number;
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
    (sum, ability) => sum + abilityWeight(ability.effect.type, weights),
    0,
  );
  const aura = isMonster(def) && def.aura ? POWER_PER_AURA : 0;
  return { total: stats + keywords + abilities + aura, stats, keywords, abilities, aura };
}
