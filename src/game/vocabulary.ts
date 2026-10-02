// Valeurs admises dans un catalogue, par version du jeu (`game/versions.ts`). Elles doublent
// les unions de `types.ts` — inévitable, un type TypeScript n'existe pas à l'exécution — mais
// `satisfies` garantit qu'elles restent en phase : ajouter un membre à une liste sans l'avoir
// ajouté à l'union ne compile pas.
//
// Module de données pur, sans dépendance : `cards.ts` (textes, puissance) et `catalogSchema.ts`
// (validation) le lisent tous les deux.

import type { AbilityEffect, CardElement, CardRarity, EnchantmentEffect, Keyword, Trigger } from './types';
import type { GameVersion } from './versions';

export const CARD_ELEMENTS = ['fire', 'water', 'air', 'earth'] as const satisfies readonly CardElement[];
// V2 : le neutre en plus (demande utilisateur), pour les cartes aux effets génériques.
export const CARD_ELEMENTS_V2 = [...CARD_ELEMENTS, 'neutral'] as const satisfies readonly CardElement[];
// Raretés, de la plus commune à la plus rare : cet ordre est celui des listes de l'admin.
export const CARD_RARITIES = [
  'common',
  'uncommon',
  'rare',
  'legendary',
] as const satisfies readonly CardRarity[];

export const TRIGGERS = [
  'summon',
  'combatStart',
  'attack',
  'defend',
  'ko',
  'sold',
] as const satisfies readonly Trigger[];

// --- V1 : listes historiques, inchangées. ---
export const KEYWORDS = [
  'reach',
  'taunt',
  'protection',
  'merchant',
  'fury',
  'toxic',
] as const satisfies readonly Keyword[];
export const ABILITY_EFFECT_TYPES = [
  'gainCoins',
  'damageOpponent',
  'healSelf',
  'drawCard',
  'buff',
  'bonusDamage',
  'shield',
  'extraMarketCard',
] as const satisfies readonly AbilityEffect['type'][];
export const ENCHANTMENT_EFFECT_TYPES = [
  'monsterBuff',
  'coinsPerTurn',
] as const satisfies readonly EnchantmentEffect['type'][];

// --- V2 (modifsV2.md) : seules les habiletés et les effets de cette liste existent en V2. Tout
// le reste (auras, bonus permanents, dégâts bonus, bouclier de capacité) y a disparu. L'ordre
// est celui du document, repris dans les listes de l'admin. ---
export const KEYWORDS_V2 = [
  'reach',
  'fury',
  'taunt',
  'protection',
  'toxic',
  'pierce',
  'rooted',
  'flying',
  'merchant',
] as const satisfies readonly Keyword[];
export const ABILITY_EFFECT_TYPES_V2 = [
  'gainCoins',
  'damageOpponent',
  'healSelf',
  'drawCard',
  'extraMarketCard',
  'armorChosen',
  'armorZone',
  'armorBoard',
  'armorSelf',
  'grantShield',
  'summonToken',
  'burn',
  'freeze',
  'moveZone',
  'moveSlot',
  'switchZone',
  // États ajoutés après modifsV2.md (retourV2.md, demande utilisateur).
  'extinguish',
  'root',
  'silence',
] as const satisfies readonly AbilityEffect['type'][];
export const ENCHANTMENT_EFFECT_TYPES_V2 = [
  'healBoost',
  'monsterBuff',
  'marketSize',
  'sellBonus',
  'coinsPerTurn',
] as const satisfies readonly EnchantmentEffect['type'][];

export function elementsFor(version: GameVersion): readonly CardElement[] {
  return version === 'v2' ? CARD_ELEMENTS_V2 : CARD_ELEMENTS;
}

export function keywordsFor(version: GameVersion): readonly Keyword[] {
  return version === 'v2' ? KEYWORDS_V2 : KEYWORDS;
}

export function abilityEffectTypesFor(version: GameVersion): readonly AbilityEffect['type'][] {
  return version === 'v2' ? ABILITY_EFFECT_TYPES_V2 : ABILITY_EFFECT_TYPES;
}

export function enchantmentEffectTypesFor(version: GameVersion): readonly EnchantmentEffect['type'][] {
  return version === 'v2' ? ENCHANTMENT_EFFECT_TYPES_V2 : ENCHANTMENT_EFFECT_TYPES;
}

// V2 : effets dont la cible est désignée par le joueur. Ils ne peuvent donc se déclencher que
// sur une action du joueur, Invoqué ou Vendu (demande utilisateur) — jamais en combat.
export const CHOSEN_TARGET_EFFECTS = [
  'armorChosen',
  'grantShield',
  'burn',
  'freeze',
  'moveZone',
  'moveSlot',
  'extinguish',
  'root',
  'silence',
] as const satisfies readonly AbilityEffect['type'][];

export function needsChosenTarget(type: AbilityEffect['type']): boolean {
  return (CHOSEN_TARGET_EFFECTS as readonly string[]).includes(type);
}

// V2 : effets qui partent de la place de la carte sur le board (sa zone, sa position) : un
// monstre seulement, et pas sur Vendu (la carte a déjà quitté le board).
export const POSITIONAL_EFFECTS = [
  'armorZone',
  'armorSelf',
  'summonToken',
  'switchZone',
] as const satisfies readonly AbilityEffect['type'][];

export function isPositionalEffect(type: AbilityEffect['type']): boolean {
  return (POSITIONAL_EFFECTS as readonly string[]).includes(type);
}
