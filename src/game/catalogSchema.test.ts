import { describe, expect, it } from 'vitest';
import { parseCardDef, parseCatalog } from './catalogSchema';
import { DEFAULT_CATALOG } from './defaultCatalog';
import type { Catalog } from './types';

// Le catalogue vient d'un stockage partagé, public en lecture et écrit par l'admin : une
// carte malformée ferait planter le rendu du plateau, qui lit `def.attack` ou
// `def.effect.type` sans filet. Ces tests couvrent ce que la validation doit refuser.

function monster(overrides: Record<string, unknown> = {}): unknown {
  return { kind: 'monster', id: 'test', name: 'Test', cost: 2, attack: 1, defense: 1, ...overrides };
}

function catalog(cards: unknown[], starterCounts: Record<string, number>): unknown {
  return { version: 1, cards, starterCounts };
}

describe('parseCardDef', () => {
  it('accepte une carte minimale', () => {
    const parsed = parseCardDef(monster({ element: 'fire' }));
    expect(parsed.ok).toBe(true);
  });

  it("refuse un identifiant qui ne peut pas servir de clé d'illustration", () => {
    for (const id of ['', '2tetes', 'mon-monstre', 'mon monstre']) {
      expect(parseCardDef(monster({ element: 'fire', id })).ok).toBe(false);
    }
  });

  it('refuse un élément inconnu, un coût négatif et une défense nulle', () => {
    expect(parseCardDef(monster({ element: 'lumiere' })).ok).toBe(false);
    expect(parseCardDef(monster({ element: 'fire', cost: -1 })).ok).toBe(false);
    expect(parseCardDef(monster({ element: 'fire', defense: 0 })).ok).toBe(false);
  });

  it('refuse les valeurs non entières, qui traverseraient les comparaisons de rules.ts', () => {
    expect(parseCardDef(monster({ element: 'fire', attack: 1.5 })).ok).toBe(false);
    expect(parseCardDef(monster({ element: 'fire', cost: Number.NaN })).ok).toBe(false);
  });

  it('refuse un effet de capacité inconnu', () => {
    const def = monster({
      element: 'fire',
      abilities: [{ trigger: 'summon', effect: { type: 'gagnerLaPartie', amount: 1 } }],
    });
    expect(parseCardDef(def).ok).toBe(false);
  });

  it('refuse une combinaison déclencheur × effet interdite par les règles (E12)', () => {
    // `bonusDamage` n'est lu que pendant l'attaque : ailleurs il ne se produirait jamais.
    const def = monster({
      element: 'fire',
      abilities: [{ trigger: 'summon', effect: { type: 'bonusDamage', amount: 2 } }],
    });
    expect(parseCardDef(def).ok).toBe(false);
  });

  it('refuse une capacité de combat sur un enchantement, qui ne combat pas', () => {
    const def = {
      kind: 'enchantment',
      id: 'ench',
      name: 'Ench',
      cost: 1,
      element: 'water',
      effect: { type: 'coinsPerTurn', amount: 1 },
      abilities: [{ trigger: 'attack', effect: { type: 'gainCoins', amount: 1 } }],
    };
    expect(parseCardDef(def).ok).toBe(false);
  });

  it('refuse une habileté répétée et une habileté inconnue', () => {
    expect(parseCardDef(monster({ element: 'fire', keywords: ['taunt', 'taunt'] })).ok).toBe(false);
    expect(parseCardDef(monster({ element: 'fire', keywords: ['invisible'] })).ok).toBe(
      false,
    );
  });

  it("n'écrit pas les clés optionnelles vides, pour que Firestore ne stocke pas d'undefined", () => {
    const parsed = parseCardDef(monster({ element: 'fire', keywords: [], abilities: [] }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect('keywords' in parsed.value).toBe(false);
    expect('abilities' in parsed.value).toBe(false);
    expect('aura' in parsed.value).toBe(false);
  });
});

describe('parseCatalog', () => {
  it('accepte le catalogue livré avec le jeu', () => {
    const parsed = parseCatalog(DEFAULT_CATALOG);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.cards).toHaveLength(DEFAULT_CATALOG.cards.length);
  });

  it('refuse deux cartes portant le même identifiant', () => {
    const parsed = parseCatalog(
      catalog([monster({ element: 'fire' }), monster({ element: 'water' })], { test: 1 }),
    );
    expect(parsed.ok).toBe(false);
  });

  it('refuse un starterCounts qui référence une carte absente', () => {
    const parsed = parseCatalog(catalog([monster({ element: 'fire' })], { test: 1, fantome: 2 }));
    expect(parsed.ok).toBe(false);
  });

  it('refuse un catalogue vide ou un deck de départ vide', () => {
    expect(parseCatalog(catalog([], {})).ok).toBe(false);
    expect(parseCatalog(catalog([monster({ element: 'fire' })], {})).ok).toBe(false);
  });

  it('laisse tomber les cartes déclarées à 0 exemplaire plutôt que de garder la clé', () => {
    const parsed = parseCatalog(
      catalog([monster({ element: 'fire' }), monster({ element: 'water', id: 'autre' })], {
        test: 3,
        autre: 0,
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.starterCounts).toEqual({ test: 3 });
  });

  it('refuse un objet qui n’est pas un catalogue', () => {
    for (const raw of [null, 42, 'catalogue', [], { version: 1 }]) {
      expect(parseCatalog(raw).ok).toBe(false);
    }
  });

  it('rend un catalogue directement utilisable comme Catalog', () => {
    const parsed = parseCatalog(DEFAULT_CATALOG);
    if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
    const value: Catalog = parsed.value;
    expect(value.version).toBe(DEFAULT_CATALOG.version);
  });
});
