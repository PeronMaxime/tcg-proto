// Validation d'un catalogue de cartes. Deux appelants, un seul jeu de règles :
// - `net/catalogStore.ts`, sur les données lues depuis Firestore ou localStorage. Ce sont des
//   données NON FIABLES : une carte malformée ferait planter le rendu du plateau (qui lit
//   `def.attack`, `def.effect.type`… sans filet), et le catalogue est public en lecture.
// - le panneau d'administration, sur le formulaire avant enregistrement, pour afficher les
//   erreurs à la saisie.
//
// Module pur, comme `rules.ts` : pas de réseau, pas de React. Il ne dépend que des types.

import {
  POWER_TARGET_COSTS,
  describeAbility,
  describeEffect,
  isAbilityAllowed,
  isEnchantmentEffectAllowed,
} from './cards';
import type {
  AbilityEffect,
  CardAbility,
  CardDef,
  Catalog,
  DeckDef,
  EnchantmentEffect,
  Keyword,
  PowerWeights,
} from './types';
import type { GameVersion } from './versions';
import {
  ABILITY_EFFECT_TYPES,
  ABILITY_EFFECT_TYPES_V2,
  CARD_ELEMENTS,
  CARD_RARITIES,
  ENCHANTMENT_EFFECT_TYPES,
  ENCHANTMENT_EFFECT_TYPES_V2,
  KEYWORDS,
  KEYWORDS_V2,
  TRIGGERS,
  abilityEffectTypesFor,
  enchantmentEffectTypesFor,
  keywordsFor,
} from './vocabulary';

// Listes des valeurs admises : elles vivent dans `vocabulary.ts` (une par version du jeu),
// réexportées ici pour les appelants historiques.
export {
  ABILITY_EFFECT_TYPES,
  ABILITY_EFFECT_TYPES_V2,
  CARD_ELEMENTS,
  CARD_RARITIES,
  ENCHANTMENT_EFFECT_TYPES,
  ENCHANTMENT_EFFECT_TYPES_V2,
  KEYWORDS,
  KEYWORDS_V2,
  TRIGGERS,
  abilityEffectTypesFor,
  enchantmentEffectTypesFor,
  keywordsFor,
};

// Tous les types d'effet connus, toutes versions confondues : la lecture accepte d'abord le
// type, puis `isAbilityAllowed` / `isEnchantmentEffectAllowed` le refusent s'il n'appartient
// pas à la version du catalogue — le message d'erreur nomme alors l'effet en clair.
const ALL_ABILITY_EFFECT_TYPES = [...new Set([...ABILITY_EFFECT_TYPES, ...ABILITY_EFFECT_TYPES_V2])];
const ALL_ENCHANTMENT_EFFECT_TYPES = [...new Set([...ENCHANTMENT_EFFECT_TYPES, ...ENCHANTMENT_EFFECT_TYPES_V2])];

// Un id de carte sert de clé d'index, de clé de cache de texture et de clé du registre
// d'illustrations (`scene/cardArt.ts`). On le contraint pour qu'il reste utilisable comme
// identifiant de code quand une illustration sera ajoutée pour cette carte.
export const CARD_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9]*$/;

// Valeur maximale d'une entrée du barème de puissance (`Catalog.powerWeights`). 0 est admis :
// c'est ainsi qu'on déclare qu'une habileté ou un effet ne pèse rien dans l'équilibrage.
export const MAX_POWER_WEIGHT = 99;

// Plafond du coefficient de valeur d'un effet de capacité. Contrairement aux valeurs du
// barème, il admet des décimales (un demi-point, une fois et demie) : c'est tout son intérêt
// face au champ de puissance, qui ne prend que des entiers. 0 annule la capacité.
export const MAX_POWER_COEFFICIENT = 9;

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

// Comme `checkInt`, mais pour une valeur qui admet des décimales (le coefficient de valeur).
// On refuse quand même `NaN` et l'infini, qui contamineraient toute puissance calculée.
function checkNumber(
  value: unknown,
  path: string,
  min: number,
  max: number,
  errors: string[],
): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push(`${path} : nombre attendu.`);
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
  const type = checkEnum(raw.type, `${path}.type`, ALL_ABILITY_EFFECT_TYPES, errors);
  if (type === null) return null;

  switch (type) {
    case 'gainCoins':
    case 'damageOpponent':
    case 'healSelf':
    case 'bonusDamage':
    case 'shield':
    case 'armorChosen':
    case 'armorZone':
    case 'armorBoard':
    case 'armorSelf': {
      const amount = checkInt(raw.amount, `${path}.amount`, 1, MAX_STAT, errors);
      return amount === null ? null : { type, amount };
    }
    case 'grantShield':
    case 'burn':
    case 'freeze':
    case 'moveZone':
    case 'moveSlot':
    case 'switchZone':
    case 'extinguish':
    case 'root':
    case 'silence':
      return { type };
    case 'summonToken': {
      const attack = checkInt(raw.attack, `${path}.attack`, 0, MAX_STAT, errors);
      const defense = checkInt(raw.defense, `${path}.defense`, 1, MAX_STAT, errors);
      return attack === null || defense === null ? null : { type, attack, defense };
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
  const type = checkEnum(raw.type, `${path}.type`, ALL_ENCHANTMENT_EFFECT_TYPES, errors);
  if (type === null) return null;

  if (type === 'coinsPerTurn' || type === 'sellBonus') {
    const amount = checkInt(raw.amount, `${path}.amount`, 1, MAX_STAT, errors);
    return amount === null ? null : { type, amount };
  }
  if (type === 'marketSize') {
    const count = checkInt(raw.count, `${path}.count`, 1, MAX_STAT, errors);
    return count === null ? null : { type, count };
  }
  if (type === 'healBoost') return { type };
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
function checkAbilitiesAllowed(def: CardDef, path: string, errors: string[], version: GameVersion): void {
  for (const ability of def.abilities ?? []) {
    if (isAbilityAllowed(def, ability, version)) continue;
    errors.push(
      `${path} : la capacité « ${describeAbility(ability)} » n'est pas permise sur ${
        def.kind === 'monster' ? 'un monstre' : 'un enchantement'
      }${version === 'v2' ? ' en V2' : ''}.`,
    );
  }
}

// `version` : version du jeu du catalogue, qui fixe les habiletés et les effets admis.
export function parseCardDef(raw: unknown, path = 'carte', version: GameVersion = 'v1'): ParseResult<CardDef> {
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
  // Rareté absente = carte écrite avant les raretés (ou catalogue importé à la main) : on la
  // range en « commune » plutôt que de refuser le catalogue, et on l'écrit explicitement pour
  // que la carte ressorte complète de la validation.
  const rarity = raw.rarity === undefined ? 'common' : checkEnum(raw.rarity, `${path}.rarity`, CARD_RARITIES, errors);

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

  if (kind === null || id === null || name === null || cost === null || element === null || rarity === null) {
    return { ok: false, errors };
  }

  if (kind === 'enchantment') {
    const effect = parseEnchantmentEffect(raw.effect, `${path}.effect`, errors);
    if (effect === null || errors.length > 0) return { ok: false, errors };
    if (!isEnchantmentEffectAllowed(effect, version)) {
      errors.push(`${path}.effect : « ${describeEffect(effect)} » n'existe pas dans cette version du jeu.`);
      return { ok: false, errors };
    }
    const def: CardDef = { kind, id, name, cost, element, rarity, effect };
    if (abilities.length > 0) def.abilities = abilities;
    checkAbilitiesAllowed(def, path, errors, version);
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
        const parsed = checkEnum(keyword, `${path}.keywords[${i}]`, keywordsFor(version), errors);
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
    if (version === 'v2') {
      // Les auras n'existent plus en V2 (modifsV2.md) : les bonus permanents sont réservés aux
      // enchantements.
      errors.push(`${path}.aura : les auras n'existent pas en V2.`);
    } else if (!isRecord(raw.aura)) {
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

  const def: CardDef = { kind, id, name, cost, element, rarity, attack, defense };
  if (aura) def.aura = aura;
  if (keywords.length > 0) def.keywords = keywords;
  if (abilities.length > 0) def.abilities = abilities;
  checkAbilitiesAllowed(def, path, errors, version);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: def };
}

// Barème de puissance. Chaque entrée est facultative : une clé absente garde la valeur fixe
// historique (voir `cardPower`). On ne garde donc que les clés effectivement écrites, ce qui
// évite de figer dans le catalogue des valeurs que personne n'a choisies.
//
// Lit un groupe du barème (`group`) : des valeurs entières (`coefficient` faux) ou des
// coefficients décimaux, indexés par les clés de `allowed`. Rend `null` pour un groupe absent.
function parseWeightGroup<K extends string>(
  raw: Record<string, unknown>,
  group: string,
  allowed: readonly K[],
  coefficient: boolean,
  errors: string[],
): Partial<Record<K, number>> | null {
  const value = raw[group];
  if (value === undefined) return null;
  if (!isRecord(value)) {
    errors.push(`powerWeights.${group} : objet attendu.`);
    return null;
  }
  const entries: Partial<Record<K, number>> = {};
  for (const [key, entry] of Object.entries(value)) {
    const path = `powerWeights.${group}.${key}`;
    const parsedKey = checkEnum(key, path, allowed, errors);
    if (parsedKey === null) continue;
    const parsed = coefficient
      ? checkNumber(entry, path, 0, MAX_POWER_COEFFICIENT, errors)
      : checkInt(entry, path, 0, MAX_POWER_WEIGHT, errors);
    if (parsed !== null) entries[parsedKey] = parsed;
  }
  return entries;
}

function parsePowerWeights(raw: unknown, errors: string[], version: GameVersion): PowerWeights | null {
  if (!isRecord(raw)) {
    errors.push('Catalogue.powerWeights : objet attendu.');
    return null;
  }
  const abilities = abilityEffectTypesFor(version);
  const weights: PowerWeights = {
    keywords: parseWeightGroup(raw, 'keywords', keywordsFor(version), false, errors) ?? {},
    abilities: parseWeightGroup(raw, 'abilities', abilities, false, errors) ?? {},
  };

  // `abilityCoefficients` reste absent tant qu'aucun coefficient n'a été réglé : un barème
  // écrit avant cette fonctionnalité se relit tel quel, et on n'écrit pas une clé de plus
  // dans le catalogue pour y stocker le coefficient neutre. Même règle pour les deux groupes
  // des enchantements (V2).
  const coefficients = parseWeightGroup(raw, 'abilityCoefficients', abilities, true, errors);
  if (coefficients && Object.keys(coefficients).length > 0) weights.abilityCoefficients = coefficients;

  if (version === 'v2') {
    const types = enchantmentEffectTypesFor(version);
    const enchantments = parseWeightGroup(raw, 'enchantments', types, false, errors);
    if (enchantments && Object.keys(enchantments).length > 0) weights.enchantments = enchantments;
    const enchantmentCoefficients = parseWeightGroup(raw, 'enchantmentCoefficients', types, true, errors);
    if (enchantmentCoefficients && Object.keys(enchantmentCoefficients).length > 0) {
      weights.enchantmentCoefficients = enchantmentCoefficients;
    }
  } else if (raw.enchantments !== undefined || raw.enchantmentCoefficients !== undefined) {
    errors.push("powerWeights : le barème des enchantements n'existe qu'en V2.");
  }

  // Puissance visée par rareté et par coût : même règle, la clé n'est écrite que si une case a
  // été réglée.
  if (raw.targets !== undefined) {
    if (!isRecord(raw.targets)) {
      errors.push('powerWeights.targets : objet attendu.');
    } else {
      const costs = POWER_TARGET_COSTS.map(String);
      const targets: NonNullable<PowerWeights['targets']> = {};
      for (const [rarity, row] of Object.entries(raw.targets)) {
        const rowPath = `powerWeights.targets.${rarity}`;
        const parsedRarity = checkEnum(rarity, rowPath, CARD_RARITIES, errors);
        if (parsedRarity === null) continue;
        if (!isRecord(row)) {
          errors.push(`${rowPath} : objet attendu.`);
          continue;
        }
        const entries: Partial<Record<string, number>> = {};
        for (const [cost, entry] of Object.entries(row)) {
          const parsedCost = checkEnum(cost, `${rowPath}.${cost}`, costs, errors);
          if (parsedCost === null) continue;
          const parsed = checkInt(entry, `${rowPath}.${cost}`, 0, MAX_POWER_WEIGHT, errors);
          if (parsed !== null) entries[parsedCost] = parsed;
        }
        if (Object.keys(entries).length > 0) targets[parsedRarity] = entries;
      }
      if (Object.keys(targets).length > 0) weights.targets = targets;
    }
  }

  return weights;
}

export const MAX_DECK_NAME_LENGTH = 40;

// Decks à choisir (V2). Leur TAILLE n'est pas vérifiée ici : un deck en cours de composition
// doit pouvoir s'enregistrer, il n'est simplement pas proposé aux joueurs (`decks.ts`). On
// refuse en revanche ce qui casserait la lecture : forme, identifiants, cartes inconnues.
function parseDecks(raw: unknown, cardIds: Set<string>, errors: string[]): DeckDef[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    errors.push('Catalogue.decks : liste attendue.');
    return [];
  }
  const decks: DeckDef[] = [];
  const seen = new Set<string>();
  raw.forEach((deck, i) => {
    const path = `decks[${i}]`;
    if (!isRecord(deck)) {
      errors.push(`${path} : objet attendu.`);
      return;
    }
    if (typeof deck.id !== 'string' || !CARD_ID_PATTERN.test(deck.id)) {
      errors.push(`${path}.id : lettres et chiffres attendus, en commençant par une lettre.`);
      return;
    }
    if (seen.has(deck.id)) {
      errors.push(`${path} : l'identifiant « ${deck.id} » est déjà utilisé.`);
      return;
    }
    seen.add(deck.id);
    const name = typeof deck.name === 'string' ? deck.name.trim() : '';
    if (!name) errors.push(`${path} : le deck doit avoir un nom.`);
    else if (name.length > MAX_DECK_NAME_LENGTH)
      errors.push(`${path} : nom trop long (${MAX_DECK_NAME_LENGTH} caractères au plus).`);
    const counts: Record<string, number> = {};
    if (!isRecord(deck.counts)) {
      errors.push(`${path}.counts : objet attendu.`);
    } else {
      for (const [cardId, count] of Object.entries(deck.counts)) {
        if (!cardIds.has(cardId)) {
          errors.push(`Deck « ${name || deck.id} » : « ${cardId} » ne correspond à aucune carte du catalogue.`);
          continue;
        }
        const parsed = checkInt(count, `${path}.counts.${cardId}`, 0, MAX_COPIES, errors);
        if (parsed !== null && parsed > 0) counts[cardId] = parsed;
      }
    }
    decks.push({ id: deck.id, name, counts });
  });
  return decks;
}

// `gameVersion` : version du jeu du catalogue (`game/versions.ts`), qui fixe les habiletés et
// les effets admis. Le catalogue rendu porte `gameVersion` pour la V2 (absent pour la V1, comme
// avant les versions) : c'est par lui que les règles savent quelle version appliquer.
export function parseCatalog(raw: unknown, gameVersion: GameVersion = 'v1'): ParseResult<Catalog> {
  if (!isRecord(raw)) return { ok: false, errors: ['Catalogue : objet attendu.'] };

  const errors: string[] = [];
  const version = checkInt(raw.version, 'Catalogue.version', 0, Number.MAX_SAFE_INTEGER, errors);

  const cards: CardDef[] = [];
  if (!Array.isArray(raw.cards)) {
    errors.push('Catalogue.cards : liste attendue.');
  } else {
    const seen = new Set<string>();
    raw.cards.forEach((card, i) => {
      const parsed = parseCardDef(card, `cards[${i}]`, gameVersion);
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

  // V2 : plus de deck de départ commun, les decks à choisir (`decks`) le remplacent.
  const starterCounts: Record<string, number> = {};
  if (gameVersion !== 'v1') {
    // rien à lire : `starterCounts` reste vide
  } else if (!isRecord(raw.starterCounts)) {
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
  // En V2, un deck incomplet n'est simplement pas proposé aux joueurs (`decks.ts`).
  if (
    gameVersion === 'v1' &&
    errors.length === 0 &&
    Object.values(starterCounts).reduce((a, b) => a + b, 0) === 0
  ) {
    errors.push('Catalogue : le deck de départ est vide, il faut au moins un exemplaire d’une carte.');
  }

  // Barème absent = catalogue écrit avant cette fonctionnalité : la puissance retombe sur les
  // valeurs fixes, et la clé n'est pas créée tant que l'admin n'a rien pesé.
  const powerWeights =
    raw.powerWeights === undefined ? null : parsePowerWeights(raw.powerWeights, errors, gameVersion);

  const decks =
    gameVersion === 'v1' ? null : parseDecks(raw.decks, new Set(cards.map((card) => card.id)), errors);

  if (version === null || errors.length > 0) return { ok: false, errors };
  const catalog: Catalog = { version, cards, starterCounts };
  if (powerWeights) catalog.powerWeights = powerWeights;
  if (gameVersion !== 'v1') catalog.gameVersion = gameVersion;
  if (decks) catalog.decks = decks;
  return { ok: true, value: catalog };
}

// ---------------------------------------------------------------------------------------
// Passage d'un catalogue à la V2 (modifsV2.md : toute habileté et tout effet absents de la
// liste V2 doivent disparaître de la V2). Le catalogue V2 a été amorcé comme une copie de la
// V1 : il porte encore des auras, des bonus permanents, des dégâts bonus… On les RETIRE au lieu
// de refuser le catalogue, à la lecture comme à l'amorçage : les cartes gardent tout ce qui
// existe encore en V2 (statistiques, habiletés et capacités communes). Un enchantement dont
// l'effet n'existe plus disparaît, faute d'effet à porter.
//
// Ne touche qu'à ce qui n'existe pas en V2, sans rien valider d'autre : `parseCatalog(…, 'v2')`
// passe ensuite. Données non fiables en entrée, d'où les gardes de forme.
// ---------------------------------------------------------------------------------------

export function migrateCatalogToV2(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const keywords = new Set<string>(KEYWORDS_V2);
  const abilityTypes = new Set<string>(ABILITY_EFFECT_TYPES_V2);
  const enchantmentTypes = new Set<string>(ENCHANTMENT_EFFECT_TYPES_V2);
  const removedIds = new Set<string>();

  const cards = Array.isArray(raw.cards)
    ? raw.cards.flatMap((card): unknown[] => {
        if (!isRecord(card)) return [card];
        if (card.kind === 'enchantment' && isRecord(card.effect) && !enchantmentTypes.has(String(card.effect.type))) {
          if (typeof card.id === 'string') removedIds.add(card.id);
          return [];
        }
        const next: Record<string, unknown> = { ...card };
        delete next.aura;
        if (Array.isArray(card.keywords)) {
          const kept = card.keywords.filter((k) => keywords.has(String(k)));
          if (kept.length > 0) next.keywords = kept;
          else delete next.keywords;
        }
        if (Array.isArray(card.abilities)) {
          const kept = card.abilities.filter(
            (a) => !isRecord(a) || !isRecord(a.effect) || abilityTypes.has(String(a.effect.type)),
          );
          if (kept.length > 0) next.abilities = kept;
          else delete next.abilities;
        }
        return [next];
      })
    : raw.cards;

  // Le deck de départ commun devient le premier deck à choisir (catalogue V2 écrit avant les
  // decks, ou amorcé depuis la V1) : il n'est pas perdu, mais il faudra peut-être le compléter
  // pour atteindre `DECK_SIZE` cartes.
  const withoutRemoved = (counts: unknown) =>
    isRecord(counts) ? Object.fromEntries(Object.entries(counts).filter(([id]) => !removedIds.has(id))) : counts;
  const decks = Array.isArray(raw.decks)
    ? raw.decks.map((deck) => (isRecord(deck) ? { ...deck, counts: withoutRemoved(deck.counts) } : deck))
    : isRecord(raw.starterCounts)
      ? [{ id: 'deck1', name: 'Deck de départ', counts: withoutRemoved(raw.starterCounts) }]
      : [];
  const next: Record<string, unknown> = { ...raw, cards, starterCounts: {}, decks };
  if (isRecord(raw.powerWeights)) {
    const weights: Record<string, unknown> = { ...raw.powerWeights };
    const keep = (group: string, allowed: Set<string>) => {
      const value = weights[group];
      if (isRecord(value)) weights[group] = Object.fromEntries(Object.entries(value).filter(([k]) => allowed.has(k)));
    };
    keep('keywords', keywords);
    keep('abilities', abilityTypes);
    keep('abilityCoefficients', abilityTypes);
    keep('enchantments', enchantmentTypes);
    keep('enchantmentCoefficients', enchantmentTypes);
    next.powerWeights = weights;
  }
  next.gameVersion = 'v2';
  return next;
}
