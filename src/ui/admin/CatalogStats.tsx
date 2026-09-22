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
          {/* Une carte par élément plutôt qu'un tableau croisé (demande utilisateur) : chaque
              élément porte son propre décompte de raretés, ce qui se lit d'un bloc au lieu de
              suivre une ligne du regard. La dernière carte totalise tout le catalogue. */}
          <div className="admin-stat-cards">
            {CARD_ELEMENTS.map((element) => (
              <div key={element} className="admin-rarity-card">
                <div className="admin-rarity-card-head">
                  <span className="admin-stat-label">{ELEMENT_LABELS[element]}</span>
                  <span className="admin-rarity-card-total">{counts.byElement[element]}</span>
                </div>
                <dl className="admin-rarity-list">
                  {CARD_RARITIES.map((rarity) => (
                    <div key={rarity} className={`admin-rarity-row is-${rarity}`}>
                      <dt>{RARITY_LABELS[rarity]}</dt>
                      <dd className={counts.grid[element][rarity] === 0 ? 'admin-table-empty' : undefined}>
                        {counts.grid[element][rarity]}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}

            <div className="admin-rarity-card is-total">
              <div className="admin-rarity-card-head">
                <span className="admin-stat-label">Tous éléments</span>
                <span className="admin-rarity-card-total">{counts.total}</span>
              </div>
              <dl className="admin-rarity-list">
                {CARD_RARITIES.map((rarity) => (
                  <div key={rarity} className={`admin-rarity-row is-${rarity}`}>
                    <dt>{RARITY_LABELS[rarity]}</dt>
                    <dd className={counts.byRarity[rarity] === 0 ? 'admin-table-empty' : undefined}>
                      {counts.byRarity[rarity]}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default CatalogStats;
