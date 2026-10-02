import { useMemo } from 'react';
import {
  DEFAULT_POWER_TARGETS,
  KEYWORD_LABELS,
  POWER_TARGET_COSTS,
  RARITY_LABELS,
  POWER_PER_ABILITY,
  POWER_PER_AURA,
  POWER_PER_ENCHANTMENT,
  POWER_PER_KEYWORD,
  describeKeywordEffect,
  isMonster,
} from '../../game/cards';
import {
  CARD_RARITIES,
  MAX_COPIES,
  MAX_POWER_WEIGHT,
  abilityEffectTypesFor,
  enchantmentEffectTypesFor,
  keywordsFor,
} from '../../game/catalogSchema';
import type { CardRarity, PowerWeights } from '../../game/types';
import AdminHeader from './AdminHeader';
import { ABILITY_EFFECT_LABELS, ENCHANTMENT_EFFECT_LABELS } from './CardEditor';
import type { CatalogAdmin } from './useCatalogAdmin';

// Onglet « Paramètres » de l'admin : la limite d'exemplaires par rareté, puis le barème de
// puissance.
//
// Barème de puissance (demande utilisateur) : la liste des habiletés et des effets de
// capacité, avec la valeur que chacun pèse dans la puissance d'une carte. Tant qu'une case est
// laissée à vide, elle garde la valeur fixe historique (`POWER_PER_KEYWORD` /
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
  const v2 = admin.version === 'v2';

  // Écrit une valeur du barème. `null` retire la clé : la ligne repasse à la valeur par défaut
  // au lieu de figer dans le catalogue un chiffre que personne n'a choisi.
  // Les deux groupes des enchantements n'existent qu'en V2 (refusés dans un catalogue V1).
  function setWeight(
    group: 'keywords' | 'abilities' | 'enchantments',
    key: string,
    value: number | null,
  ) {
    const next = copyWeights();
    const target = next[group] as Record<string, number>;
    if (value === null) delete target[key];
    else target[key] = value;
    admin.setPowerWeights(next);
  }

  // Copie modifiable du barème, toutes les cases déjà réglées comprises.
  function copyWeights(): PowerWeights {
    return {
      keywords: { ...(weights?.keywords ?? {}) },
      abilities: { ...(weights?.abilities ?? {}) },
      ...(v2 ? { enchantments: { ...(weights?.enchantments ?? {}) } } : {}),
      targets: Object.fromEntries(
        Object.entries(weights?.targets ?? {}).map(([rarity, row]) => [rarity, { ...row }]),
      ),
    };
  }

  // Écrit une case de la grille des puissances visées (même convention : `null` = par défaut).
  function setTarget(rarity: CardRarity, cost: number, value: number | null) {
    const next = copyWeights();
    const targets = next.targets ?? {};
    const row = { ...(targets[rarity] ?? {}) };
    if (value === null) delete row[String(cost)];
    else row[String(cost)] = value;
    if (Object.keys(row).length > 0) targets[rarity] = row;
    else delete targets[rarity];
    next.targets = targets;
    admin.setPowerWeights(next);
  }

  // Limite d'exemplaires : vide = sans limite.
  function readMaxCopies(raw: string): number | null {
    if (raw.trim() === '') return null;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0 || value > MAX_COPIES) return null;
    return value;
  }

  // Une saisie vide (ou illisible) veut dire « par défaut », pas 0 : 0 se tape explicitement.
  function readInput(raw: string): number | null {
    if (raw.trim() === '') return null;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0 || value > MAX_POWER_WEIGHT) return null;
    return value;
  }

  const custom =
    Object.keys(weights?.keywords ?? {}).length +
    Object.keys(weights?.abilities ?? {}).length +
    Object.keys(weights?.enchantments ?? {}).length +
    Object.values(weights?.targets ?? {}).reduce((sum, row) => sum + Object.keys(row ?? {}).length, 0);

  return (
    <div className="admin-panel">
      <AdminHeader
        title="Paramètres"
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
          onClick={() =>
            admin.setPowerWeights(
              v2
                ? { keywords: {}, abilities: {}, enchantments: {}, targets: {} }
                : { keywords: {}, abilities: {}, targets: {} },
            )
          }
        >
          Rétablir le barème par défaut
        </button>
      </AdminHeader>

      {/* Une seule page qui défile (demande utilisateur) : pas de sous-fenêtres qui se
          partagent la hauteur et écrasent les tableaux. */}
      <div className="admin-settings">
        {/* Limite d'exemplaires d'une même carte par deck, selon la rareté (demande utilisateur). */}
        <section>
          <h2>Exemplaires par deck</h2>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Rareté</th>
                <th className="is-numeric">Nombre max d’exemplaires par deck</th>
              </tr>
            </thead>
            <tbody>
              {CARD_RARITIES.map((rarity) => (
                <tr key={rarity}>
                  <td>{RARITY_LABELS[rarity]}</td>
                  <td className="is-numeric">
                    <input
                      type="number"
                      min={0}
                      max={MAX_COPIES}
                      step={1}
                      className="admin-weight-input"
                      aria-label={`Exemplaires au plus, rareté ${RARITY_LABELS[rarity]}`}
                      value={admin.draft?.maxCopiesByRarity?.[rarity] ?? ''}
                      placeholder="∞"
                      onChange={(e) => admin.setMaxCopies(rarity, readMaxCopies(e.target.value))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="admin-table-note">
            Case vide : pas de limite.{v2 ? ' Un deck qui dépasse la limite n’est pas proposé aux joueurs.' : ''}
          </p>
        </section>

        <section>
          <h2>Puissance</h2>
          <p className="admin-summary">
            La puissance d’une carte vaut son attaque plus sa défense, plus la valeur de chacune de ses
            habiletés et de chacune de ses capacités
            {v2 ? (
              <>, plus, pour un enchantement, la valeur de son effet</>
            ) : (
              <>
                , plus {POWER_PER_AURA} si elle porte une aura
                {auras > 0 ? ` (${auras} carte${auras > 1 ? 's' : ''} concernée${auras > 1 ? 's' : ''})` : ''}
              </>
            )}
            .
            La valeur d’un effet compte pour une seule unité : chaque unité en plus ajoute 1 point
            (des dégâts à 3 valent 2 de plus), et pour un effet +X/+Y, chaque paire au-delà de
            +1/+1 ajoute 1 point. Laisse une case vide pour garder la valeur par défaut. C’est un repère d’équilibrage : aucune
            règle du jeu ne s’en sert.
          </p>
        </section>

        {/* Puissance visée selon la rareté et le coût (demande utilisateur). */}
        <section>
          <h2>Puissance visée par rareté et coût</h2>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Pièces</th>
                {POWER_TARGET_COSTS.map((cost) => (
                  <th key={cost} className="is-numeric">
                    {cost}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CARD_RARITIES.map((rarity) => (
                <tr key={rarity}>
                  <td>{RARITY_LABELS[rarity]}s</td>
                  {POWER_TARGET_COSTS.map((cost) => (
                    <td key={cost} className="is-numeric">
                      <input
                        type="number"
                        min={0}
                        max={MAX_POWER_WEIGHT}
                        step={1}
                        className="admin-weight-input"
                        aria-label={`${RARITY_LABELS[rarity]}, ${cost} pièce${cost > 1 ? 's' : ''}`}
                        value={weights?.targets?.[rarity]?.[String(cost)] ?? ''}
                        placeholder={String(DEFAULT_POWER_TARGETS[rarity][cost - 1])}
                        onChange={(e) => setTarget(rarity, cost, readInput(e.target.value))}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>

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
              {keywordsFor(admin.version).map((keyword) => {
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
              {abilityEffectTypesFor(admin.version).map((effect) => {
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

        {/* Effets d'enchantement (demande utilisateur), en V2 : même réglage qu'une capacité. */}
        {v2 && (
          <section>
            <h2>Effets d’enchantement</h2>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Effet</th>
                  <th className="is-numeric">Puissance</th>
                </tr>
              </thead>
              <tbody>
                {enchantmentEffectTypesFor(admin.version).map((effect) => {
                  const value = weights?.enchantments?.[effect];
                  return (
                    <tr key={effect}>
                      <td>{ENCHANTMENT_EFFECT_LABELS[effect]}</td>
                      <td className="is-numeric">
                        <input
                          type="number"
                          min={0}
                          max={MAX_POWER_WEIGHT}
                          step={1}
                          className="admin-weight-input"
                          value={value ?? ''}
                          placeholder={String(POWER_PER_ENCHANTMENT)}
                          onChange={(e) => setWeight('enchantments', effect, readInput(e.target.value))}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </div>
  );
}

export default PowerWeightsPanel;
