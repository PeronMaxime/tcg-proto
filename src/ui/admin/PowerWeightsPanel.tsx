import { useMemo } from 'react';
import {
  KEYWORD_LABELS,
  POWER_PER_ABILITY,
  POWER_PER_AURA,
  POWER_PER_KEYWORD,
  abilityWeight,
  describeKeywordEffect,
  isMonster,
  keywordWeight,
} from '../../game/cards';
import { ABILITY_EFFECT_TYPES, KEYWORDS, MAX_POWER_WEIGHT } from '../../game/catalogSchema';
import type { AbilityEffect, Keyword, PowerWeights } from '../../game/types';
import AdminHeader from './AdminHeader';
import { ABILITY_EFFECT_LABELS } from './CardEditor';
import type { CatalogAdmin } from './useCatalogAdmin';

// Barème de puissance (demande utilisateur) : la liste des habiletés et des effets de
// capacité, avec la valeur que chacun pèse dans la puissance d'une carte. Tant qu'une ligne
// est laissée à vide, elle garde la valeur fixe historique (`POWER_PER_KEYWORD` /
// `POWER_PER_ABILITY`) — un barème vierge calcule donc exactement comme avant cet onglet.
//
// Le barème vit dans le catalogue (`Catalog.powerWeights`) et s'enregistre avec lui : la
// puissance reste un indicateur d'équilibrage pour l'admin, aucune règle de jeu ne la lit.

type AbilityEffectType = AbilityEffect['type'];

// Une ligne par habileté / par effet : combien de cartes la portent, et combien de points
// elle leur apporte au total. Ce sont ces deux chiffres qui disent si une valeur est lourde
// de conséquences ou anecdotique.
interface Usage {
  cards: number;
  occurrences: number;
}

function emptyUsage(): Usage {
  return { cards: 0, occurrences: 0 };
}

interface PowerWeightsPanelProps {
  admin: CatalogAdmin;
}

function PowerWeightsPanel({ admin }: PowerWeightsPanelProps) {
  const cards = admin.draft?.cards ?? [];
  const weights = admin.draft?.powerWeights;

  const usage = useMemo(() => {
    const keywords = new Map<Keyword, Usage>(KEYWORDS.map((keyword) => [keyword, emptyUsage()]));
    const abilities = new Map<AbilityEffectType, Usage>(
      ABILITY_EFFECT_TYPES.map((effect) => [effect, emptyUsage()]),
    );
    let auras = 0;

    for (const card of cards) {
      if (isMonster(card)) {
        if (card.aura) auras += 1;
        // Une habileté ne peut pas être répétée sur une carte (`catalogSchema`) : une
        // occurrence = une carte.
        for (const keyword of card.keywords ?? []) {
          const entry = keywords.get(keyword);
          if (entry) {
            entry.cards += 1;
            entry.occurrences += 1;
          }
        }
      }
      // Une carte peut porter plusieurs capacités du même effet (deux déclencheurs
      // différents) : on compte les deux, et la carte une seule fois.
      const seen = new Set<AbilityEffectType>();
      for (const ability of card.abilities ?? []) {
        const entry = abilities.get(ability.effect.type);
        if (!entry) continue;
        entry.occurrences += 1;
        if (!seen.has(ability.effect.type)) {
          seen.add(ability.effect.type);
          entry.cards += 1;
        }
      }
    }

    return { keywords, abilities, auras };
  }, [cards]);

  if (!admin.draft) return null;

  // Écrit une valeur du barème. `null` retire la clé : la ligne repasse à la valeur par défaut
  // au lieu de figer dans le catalogue un chiffre que personne n'a choisi.
  function setWeight(group: 'keywords' | 'abilities', key: string, value: number | null) {
    const next: PowerWeights = {
      keywords: { ...(weights?.keywords ?? {}) },
      abilities: { ...(weights?.abilities ?? {}) },
    };
    const target = next[group] as Record<string, number>;
    if (value === null) delete target[key];
    else target[key] = value;
    admin.setPowerWeights(next);
  }

  // Une saisie vide (ou illisible) veut dire « par défaut », pas 0 : 0 se tape explicitement.
  function readInput(raw: string): number | null {
    if (raw.trim() === '') return null;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0 || value > MAX_POWER_WEIGHT) return null;
    return value;
  }

  const custom =
    Object.keys(weights?.keywords ?? {}).length + Object.keys(weights?.abilities ?? {}).length;

  return (
    <div className="admin-panel">
      <AdminHeader
        title="Puissances"
        summary={
          custom === 0
            ? 'Aucune valeur personnalisée : la puissance se calcule avec le barème par défaut.'
            : `${custom} valeur${custom > 1 ? 's' : ''} personnalisée${custom > 1 ? 's' : ''}`
        }
        admin={admin}
      >
        <button
          type="button"
          disabled={custom === 0}
          onClick={() => admin.setPowerWeights({ keywords: {}, abilities: {} })}
        >
          Rétablir le barème par défaut
        </button>
      </AdminHeader>

      <p className="admin-summary">
        La puissance d’une carte vaut son attaque plus sa défense, plus la valeur de chacune de ses
        habiletés et de chacune de ses capacités, plus {POWER_PER_AURA} si elle porte une aura
        {usage.auras > 0 ? ` (${usage.auras} carte${usage.auras > 1 ? 's' : ''} concernée${usage.auras > 1 ? 's' : ''})` : ''}.
        Laisse une case vide pour garder la valeur par défaut. C’est un repère d’équilibrage :
        aucune règle du jeu ne s’en sert.
      </p>

      <div className="admin-table-scroll">
        <section>
          <h2>Habiletés</h2>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Habileté</th>
                <th>Effet en jeu</th>
                <th className="is-numeric">Cartes</th>
                <th className="is-numeric">Puissance</th>
              </tr>
            </thead>
            <tbody>
              {KEYWORDS.map((keyword) => {
                const entry = usage.keywords.get(keyword) ?? emptyUsage();
                const value = weights?.keywords?.[keyword];
                return (
                  <tr key={keyword}>
                    <td>{KEYWORD_LABELS[keyword]}</td>
                    <td className="admin-table-note">{describeKeywordEffect(keyword)}</td>
                    <td className="is-numeric">{entry.cards}</td>
                    <td className="is-numeric">
                      <input
                        type="number"
                        min={0}
                        max={MAX_POWER_WEIGHT}
                        step={1}
                        className="admin-weight-input"
                        value={value ?? ''}
                        placeholder={String(POWER_PER_KEYWORD)}
                        onChange={(e) => setWeight('keywords', keyword, readInput(e.target.value))}
                      />
                      <span className="admin-table-note">
                        {' '}
                        ×{entry.occurrences} ={' '}
                        {keywordWeight(keyword, admin.draft?.powerWeights) * entry.occurrences} pts
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section>
          <h2>Effets de capacité</h2>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Effet</th>
                <th className="is-numeric">Cartes</th>
                <th className="is-numeric">Capacités</th>
                <th className="is-numeric">Puissance</th>
              </tr>
            </thead>
            <tbody>
              {ABILITY_EFFECT_TYPES.map((effect) => {
                const entry = usage.abilities.get(effect) ?? emptyUsage();
                const value = weights?.abilities?.[effect];
                return (
                  <tr key={effect}>
                    <td>{ABILITY_EFFECT_LABELS[effect]}</td>
                    <td className="is-numeric">{entry.cards}</td>
                    <td className="is-numeric">{entry.occurrences}</td>
                    <td className="is-numeric">
                      <input
                        type="number"
                        min={0}
                        max={MAX_POWER_WEIGHT}
                        step={1}
                        className="admin-weight-input"
                        value={value ?? ''}
                        placeholder={String(POWER_PER_ABILITY)}
                        onChange={(e) => setWeight('abilities', effect, readInput(e.target.value))}
                      />
                      <span className="admin-table-note">
                        {' '}
                        ×{entry.occurrences} ={' '}
                        {abilityWeight(effect, admin.draft?.powerWeights) * entry.occurrences} pts
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

export default PowerWeightsPanel;
