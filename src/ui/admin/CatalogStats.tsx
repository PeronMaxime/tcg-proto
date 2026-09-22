import { useMemo } from 'react';
import { ELEMENT_LABELS, RARITY_LABELS, cardRarity } from '../../game/cards';
import { CARD_ELEMENTS, CARD_RARITIES } from '../../game/catalogSchema';
import type { CardElement, CardRarity } from '../../game/types';
import AdminHeader from './AdminHeader';
import type { CatalogAdmin } from './useCatalogAdmin';

// Les chiffres du catalogue : combien de cartes par élément, et pour chaque élément combien
// par rareté. Onglet de LECTURE, recalculé depuis le brouillon à chaque changement — il
// répond à « le feu est-il aussi fourni que l'eau ? », « ai-je trop de légendaires ici ? »
// sans avoir à compter les lignes du récapitulatif.

interface Counts {
  // [élément][rareté] = nombre de cartes ; tous les croisements existent, même à zéro, pour
  // que le tableau garde la même forme quel que soit le catalogue.
  grid: Record<CardElement, Record<CardRarity, number>>;
  byElement: Record<CardElement, number>;
  byRarity: Record<CardRarity, number>;
  total: number;
}

function emptyCounts(): Counts {
  const grid = {} as Record<CardElement, Record<CardRarity, number>>;
  const byElement = {} as Record<CardElement, number>;
  const byRarity = {} as Record<CardRarity, number>;
  for (const element of CARD_ELEMENTS) {
    byElement[element] = 0;
    grid[element] = {} as Record<CardRarity, number>;
    for (const rarity of CARD_RARITIES) grid[element][rarity] = 0;
  }
  for (const rarity of CARD_RARITIES) byRarity[rarity] = 0;
  return { grid, byElement, byRarity, total: 0 };
}

interface CatalogStatsProps {
  admin: CatalogAdmin;
}

function CatalogStats({ admin }: CatalogStatsProps) {
  const cards = admin.draft?.cards ?? [];

  const counts = useMemo(() => {
    const result = emptyCounts();
    for (const card of cards) {
      const rarity = cardRarity(card);
      result.grid[card.element][rarity] += 1;
      result.byElement[card.element] += 1;
      result.byRarity[rarity] += 1;
      result.total += 1;
    }
    return result;
  }, [cards]);

  if (!admin.draft) return null;

  return (
    <div className="admin-panel">
      <AdminHeader title="Chiffres" summary={`${counts.total} cartes dans le catalogue`} admin={admin} />

      <div className="admin-stats">
        <section>
          <h2>Cartes par élément</h2>
          <div className="admin-stat-cards">
            {CARD_ELEMENTS.map((element) => (
              <div key={element} className="admin-stat-card">
                <span className="admin-stat-label">{ELEMENT_LABELS[element]}</span>
                <span className="admin-stat-value">{counts.byElement[element]}</span>
                <span className="admin-stat-detail">
                  {counts.total === 0
                    ? '—'
                    : `${Math.round((counts.byElement[element] / counts.total) * 100)} % du catalogue`}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2>Raretés, élément par élément</h2>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Élément</th>
                {CARD_RARITIES.map((rarity) => (
                  <th key={rarity} className="is-numeric">
                    {RARITY_LABELS[rarity]}
                  </th>
                ))}
                <th className="is-numeric">Total</th>
              </tr>
            </thead>
            <tbody>
              {CARD_ELEMENTS.map((element) => (
                <tr key={element}>
                  <td>{ELEMENT_LABELS[element]}</td>
                  {CARD_RARITIES.map((rarity) => (
                    <td key={rarity} className="is-numeric">
                      {counts.grid[element][rarity] === 0 ? (
                        <span className="admin-table-empty">0</span>
                      ) : (
                        counts.grid[element][rarity]
                      )}
                    </td>
                  ))}
                  <td className="is-numeric">{counts.byElement[element]}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Toutes</td>
                {CARD_RARITIES.map((rarity) => (
                  <td key={rarity} className="is-numeric">
                    {counts.byRarity[rarity]}
                  </td>
                ))}
                <td className="is-numeric">{counts.total}</td>
              </tr>
            </tfoot>
          </table>
        </section>
      </div>
    </div>
  );
}

export default CatalogStats;
