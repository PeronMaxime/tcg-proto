// Validation d'un catalogue de cartes. Deux appelants, un seul jeu de règles :
// - `net/catalogStore.ts`, sur les données lues depuis Firestore ou localStorage. Ce sont des
//   données NON FIABLES : une carte malformée ferait planter le rendu du plateau (qui lit
//   `def.attack`, `def.effect.type`… sans filet), et le catalogue est public en lecture.
// - le panneau d'administration, sur le formulaire avant enregistrement, pour afficher les
//   erreurs à la saisie.
//
// Module pur, comme `rules.ts` : pas de réseau, pas de React. Il ne dépend que des types.

import { describeAbility, isAbilityAllowed } from './cards';
import type {
  AbilityEffect,
  CardAbility,
  CardDef,
  CardElement,
  Catalog,
  EnchantmentEffect,
  Keyword,
  Trigger,
} from './types';

// Listes des valeurs admises. Elles doublent les unions de `types.ts` — inévitable, un type
// TypeScript n'existe pas à l'exécution — mais `satisfies` garantit qu'elles restent en phase :
// ajouter un membre à l'union sans l'ajouter ici ne compile pas.
export const CARD_ELEMENTS = ['fire', 'water', 'air', 'earth'] as const satisfies readonly CardElement[];
export const KEYWORDS = [
  'reach',
  'taunt',
  'protection',
  'merchant',
  'fury',
  'toxic',
] as const satisfies readonly Keyword[];
export const TRIGGERS = [
  'summon',
  'combatStart',
  'attack',
  'defend',
  'ko',
  'sold',
] as const satisfies readonly Trigger[];
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

// Un id de carte sert de clé d'index, de clé de cache de texture et de clé du registre
// d'illustrations (`scene/cardArt.ts`). On le contraint pour qu'il reste utilisable comme
// identifiant de code quand une illustration sera ajoutée pour cette carte.
export const CARD_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9]*$/;

export const MAX_COST = 99;
export const MAX_STAT = 99;
export const MAX_COPIES = 99;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Entier borné : refuse NaN, Infinity et les décimaux, qui traverseraient sans bruit les
// comparaisons de `rules.ts` et donneraient des dégâts à virgule.
function checkInt(
  value: unknown,
  path: string,
  min: number,
  max: number,
  errors: string[],
): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    errors.push(`${path} : entier attendu.`);
    return null;
  }
  if (value < min || value > max) {
    errors.push(`${path} : doit être compris entre ${min} et ${max}.`);
    return null;
  }
  return value;
}

function checkEnum<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
  errors: string[],
): T | null {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    errors.push(`${path} : valeur attendue parmi ${allowed.join(', ')}.`);
    return null;
  }
  return value as T;
}

function checkName(value: unknown, path: string, errors: string[]): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${path} : le nom ne peut pas être vide.`);
    return null;
  }
  if (value.length > 40) {
    errors.push(`${path} : le nom ne doit pas dépasser 40 caractères (il ne tiendrait pas sur la carte).`);
    return null;
  }
  return value;
}

function parseAbilityEffect(raw: unknown, path: string, errors: string[]): AbilityEffect | null {
  if (!isRecord(raw)) {
    errors.push(`${path} : effet attendu.`);
    return null;
  }
  const type = checkEnum(raw.type, `${path}.type`, ABILITY_EFFECT_TYPES, errors);
  if (type === null) return null;

  switch (type) {
    case 'gainCoins':
    case 'damageOpponent':
    case 'healSelf':
    case 'bonusDamage':
    case 'shield': {
      const amount = checkInt(raw.amount, `${path}.amount`, 1, MAX_STAT, errors);
      return amount === null ? null : { type, amount };
    }
    case 'drawCard':
    case 'extraMarketCard': {
      const count = checkInt(raw.count, `${path}.count`, 1, MAX_STAT, errors);
      return count === null ? null : { type, count };
    }
    case 'buff': {
      const target = checkEnum(raw.target, `${path}.target`, ['self', 'otherAllies'] as const, errors);
      const attack = checkInt(raw.attack, `${path}.attack`, 0, MAX_STAT, errors);
      const defense = checkInt(raw.defense, `${path}.defense`, 0, MAX_STAT, errors);
      if (target === null || attack === null || defense === null) return null;
      if (attack === 0 && defense === 0) {
        errors.push(`${path} : un buff doit donner au moins +1 en attaque ou en défense.`);
        return null;
      }
      return { type, target, attack, defense };
    }
  }
}

function parseAbility(raw: unknown, path: string, errors: string[]): CardAbility | null {
  if (!isRecord(raw)) {
    errors.push(`${path} : capacité attendue.`);
    return null;
  }
  const trigger = checkEnum(raw.trigger, `${path}.trigger`, TRIGGERS, errors);
  const effect = parseAbilityEffect(raw.effect, `${path}.effect`, errors);
  if (trigger === null || effect === null) return null;

  // La combinaison déclencheur × effet est vérifiée plus tard, par `isAbilityAllowed`, qui a
  // besoin de savoir s'il s'agit d'un monstre ou d'un enchantement.
  const ability: CardAbility = { trigger, effect };
  // `oncePerCombat` est typée `true` (jamais `false`) : on n'écrit la clé que si elle est vraie.
  if (raw.oncePerCombat === true) ability.oncePerCombat = true;
  else if (raw.oncePerCombat !== undefined && raw.oncePerCombat !== false) {
    errors.push(`${path}.oncePerCombat : booléen attendu.`);
    return null;
  }
  return ability;
}

function parseEnchantmentEffect(raw: unknown, path: string, errors: string[]): EnchantmentEffect | null {
  if (!isRecord(raw)) {
    errors.push(`${path} : effet attendu.`);
    return null;
  }
  const type = checkEnum(raw.type, `${path}.type`, ENCHANTMENT_EFFECT_TYPES, errors);
  if (type === null) return null;

  if (type === 'coinsPerTurn') {
    const amount = checkInt(raw.amount, `${path}.amount`, 1, MAX_STAT, errors);
    return amount === null ? null : { type, amount };
  }
  const zone = checkEnum(raw.zone, `${path}.zone`, ['attack', 'defense', 'all'] as const, errors);
  const attack = checkInt(raw.attack, `${path}.attack`, 0, MAX_STAT, errors);
  const defense = checkInt(raw.defense, `${path}.defense`, 0, MAX_STAT, errors);
  if (zone === null || attack === null || defense === null) return null;
  if (attack === 0 && defense === 0) {
    errors.push(`${path} : l'enchantement doit donner au moins +1 en attaque ou en défense.`);
    return null;
  }
  return { type, zone, attack, defense };
}

// Combinaisons déclencheur × effet refusées par les règles (E12) : `isAbilityAllowed` en est
// la définition de référence, partagée avec `rules.ts` — on ne la redéclare pas ici.
function checkAbilitiesAllowed(def: CardDef, path: string, errors: string[]): void {
  for (const ability of def.abilities ?? []) {
    if (isAbilityAllowed(def, ability)) continue;
    errors.push(
      `${path} : la capacité « ${describeAbility(ability)} » n'est pas permise sur ${
        def.kind === 'monster' ? 'un monstre' : 'un enchantement'
      }.`,
    );
  }
}

export function parseCardDef(raw: unknown, path = 'carte'): ParseResult<CardDef> {
  const errors: string[] = [];
  if (!isRecord(raw)) return { ok: false, errors: [`${path} : objet attendu.`] };

  const kind = checkEnum(raw.kind, `${path}.kind`, ['monster', 'enchantment'] as const, errors);
  const id = typeof raw.id === 'string' && CARD_ID_PATTERN.test(raw.id) ? raw.id : null;
  if (id === null) {
    errors.push(
      `${path}.id : identifiant attendu (lettres et chiffres, commençant par une lettre, ex. « golemDeGlace »).`,
    );
  }
  const name = checkName(raw.name, `${path}.name`, errors);
  const cost = checkInt(raw.cost, `${path}.cost`, 0, MAX_COST, errors);
  const element = checkEnum(raw.element, `${path}.element`, CARD_ELEMENTS, errors);

  const abilities: CardAbility[] = [];
  if (raw.abilities !== undefined) {
    if (!Array.isArray(raw.abilities)) {
      errors.push(`${path}.abilities : liste attendue.`);
    } else {
      raw.abilities.forEach((ability, i) => {
        const parsed = parseAbility(ability, `${path}.abilities[${i}]`, errors);
        if (parsed) abilities.push(parsed);
      });
    }
  }

  if (kind === null || id === null || name === null || cost === null || element === null) {
    return { ok: false, errors };
  }

  if (kind === 'enchantment') {
    const effect = parseEnchantmentEffect(raw.effect, `${path}.effect`, errors);
    if (effect === null || errors.length > 0) return { ok: false, errors };
    const def: CardDef = { kind, id, name, cost, element, effect };
    if (abilities.length > 0) def.abilities = abilities;
    checkAbilitiesAllowed(def, path, errors);
    if (errors.length > 0) return { ok: false, errors };
    return { ok: true, value: def };
  }

  const attack = checkInt(raw.attack, `${path}.attack`, 0, MAX_STAT, errors);
  const defense = checkInt(raw.defense, `${path}.defense`, 1, MAX_STAT, errors);

  const keywords: Keyword[] = [];
  if (raw.keywords !== undefined) {
    if (!Array.isArray(raw.keywords)) {
      errors.push(`${path}.keywords : liste attendue.`);
    } else {
      raw.keywords.forEach((keyword, i) => {
        const parsed = checkEnum(keyword, `${path}.keywords[${i}]`, KEYWORDS, errors);
        if (parsed === null) return;
        if (keywords.includes(parsed)) {
          errors.push(`${path}.keywords : « ${parsed} » est répétée.`);
          return;
        }
        keywords.push(parsed);
      });
    }
  }

  let aura: { attack: number; defense: number } | null = null;
  if (raw.aura !== undefined && raw.aura !== null) {
    if (!isRecord(raw.aura)) {
      errors.push(`${path}.aura : objet attendu.`);
    } else {
      const auraAttack = checkInt(raw.aura.attack, `${path}.aura.attack`, 0, MAX_STAT, errors);
      const auraDefense = checkInt(raw.aura.defense, `${path}.aura.defense`, 0, MAX_STAT, errors);
      if (auraAttack !== null && auraDefense !== null) {
        if (auraAttack === 0 && auraDefense === 0) {
          errors.push(`${path}.aura : une aura doit donner au moins +1 en attaque ou en défense.`);
        } else {
          aura = { attack: auraAttack, defense: auraDefense };
        }
      }
    }
  }

  if (attack === null || defense === null || errors.length > 0) return { ok: false, errors };

  const def: CardDef = { kind, id, name, cost, element, attack, defense };
  if (aura) def.aura = aura;
  if (keywords.length > 0) def.keywords = keywords;
  if (abilities.length > 0) def.abilities = abilities;
  checkAbilitiesAllowed(def, path, errors);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: def };
}

export function parseCatalog(raw: unknown): ParseResult<Catalog> {
  if (!isRecord(raw)) return { ok: false, errors: ['Catalogue : objet attendu.'] };

  const errors: string[] = [];
  const version = checkInt(raw.version, 'Catalogue.version', 0, Number.MAX_SAFE_INTEGER, errors);

  const cards: CardDef[] = [];
  if (!Array.isArray(raw.cards)) {
    errors.push('Catalogue.cards : liste attendue.');
  } else {
    const seen = new Set<string>();
    raw.cards.forEach((card, i) => {
      const parsed = parseCardDef(card, `cards[${i}]`);
      if (!parsed.ok) {
        errors.push(...parsed.errors);
        return;
      }
      if (seen.has(parsed.value.id)) {
        errors.push(`cards[${i}] : l'identifiant « ${parsed.value.id} » est déjà utilisé.`);
        return;
      }
      seen.add(parsed.value.id);
      cards.push(parsed.value);
    });
    if (raw.cards.length === 0) errors.push('Catalogue : il faut au moins une carte.');
  }

  const starterCounts: Record<string, number> = {};
  if (!isRecord(raw.starterCounts)) {
    errors.push('Catalogue.starterCounts : objet attendu.');
  } else {
    const ids = new Set(cards.map((card) => card.id));
    for (const [cardId, count] of Object.entries(raw.starterCounts)) {
      if (!ids.has(cardId)) {
        errors.push(`starterCounts : « ${cardId} » ne correspond à aucune carte du catalogue.`);
        continue;
      }
      const parsed = checkInt(count, `starterCounts.${cardId}`, 0, MAX_COPIES, errors);
      // 0 exemplaire = la carte existe mais n'est pas distribuée : on ne garde pas la clé,
      // pour que `buildStarterDeck` n'ait pas à filtrer.
      if (parsed !== null && parsed > 0) starterCounts[cardId] = parsed;
    }
  }

  // Un deck vide ferait planter la première pioche : `beginTurn` sert le marché depuis le deck.
  if (errors.length === 0 && Object.values(starterCounts).reduce((a, b) => a + b, 0) === 0) {
    errors.push('Catalogue : le deck de départ est vide, il faut au moins un exemplaire d’une carte.');
  }

  if (version === null || errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { version, cards, starterCounts } };
}
