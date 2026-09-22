import { useMemo } from 'react';
import {
  KEYWORD_LABELS,
  POWER_PER_ABILITY,
  POWER_PER_AURA,
  POWER_PER_KEYWORD,
  describeKeywordEffect,
  isMonster,
} from '../../game/cards';
import { ABILITY_EFFECT_TYPES, KEYWORDS, MAX_POWER_WEIGHT } from '../../game/catalogSchema';
import type { PowerWeights } from '../../game/types';
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

interface PowerWeightsPanelProps {
  admin: CatalogAdmin;
}

function PowerWeightsPanel({ admin }: PowerWeightsPanelProps) {
  const cards = admin.draft?.cards ?? [];
  const weights = admin.draft?.powerWeights;

  // Seul chiffre du catalogue encore utile ici : combien de cartes portent une aura, pour
  // situer le forfait d'aura rappelé sous le titre. Les colonnes d'usage ont été retirées des
  // tableaux (demande utilisateur) : on ne compte donc plus habileté par habileté.
  const auras = useMemo(
    () => cards.filter((card) => isMonster(card) && card.aura).length,
    [cards],
  );

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
        {auras > 0 ? ` (${auras} carte${auras > 1 ? 's' : ''} concernée${auras > 1 ? 's' : ''})` : ''}.
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
                <th className="is-numeric">Puissance</th>
              </tr>
            </thead>
            <tbody>
              {KEYWORDS.map((keyword) => {
                const value = weights?.keywords?.[keyword];
                return (
                  <tr key={keyword}>
                    <td>{KEYWORD_LABELS[keyword]}</td>
                    <td className="admin-table-note">{describeKeywordEffect(keyword)}</td>
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
                <th className="is-numeric">Puissance</th>
              </tr>
            </thead>
            <tbody>
              {ABILITY_EFFECT_TYPES.map((effect) => {
                const value = weights?.abilities?.[effect];
                return (
                  <tr key={effect}>
                    <td>{ABILITY_EFFECT_LABELS[effect]}</td>
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
