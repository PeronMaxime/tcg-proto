import { useMemo, useState } from 'react';
import { ELEMENT_LABELS, RARITY_LABELS, cardPower, cardRarity, isMonster, powerBalance } from '../../game/cards';
import { CARD_RARITIES } from '../../game/catalogSchema';
import type { CardDef, CardElement, CardRarity } from '../../game/types';
import { elementsFor } from '../../game/vocabulary';
import { hasCardArt } from '../../scene/cardArt';
import AdminHeader from './AdminHeader';
import CardEditor, { freshCard } from './CardEditor';
import type { CatalogAdmin } from './useCatalogAdmin';

// Liste des cartes du brouillon, avec l'éditeur de la carte sélectionnée à droite.

type KindFilter = 'all' | CardDef['kind'];
type ElementFilter = 'all' | CardElement;
type RarityFilter = 'all' | CardRarity;

// Identifiant libre pour une carte neuve : `carte1`, `carte2`… Le format est contraint
// (`CARD_ID_PATTERN`) parce que l'id sert aussi de clé dans le registre d'illustrations.
function nextFreeId(cards: CardDef[]): string {
  const taken = new Set(cards.map((card) => card.id));
  for (let i = 1; ; i++) {
    const id = `carte${i}`;
    if (!taken.has(id)) return id;
  }
}

// Repère d'équilibrage dans la liste : rien quand la carte est pile à la puissance visée pour
// sa rareté et son coût, sinon l'écart (grille de l'onglet « Paramètres »).
function BalanceBadge({ card }: { card: CardDef }) {
  const balance = powerBalance(card);
  if (!balance || balance.gap === 0) return null;
  const strong = balance.gap > 0;
  return (
    <span
      className={`admin-list-balance ${strong ? 'is-strong' : 'is-weak'}`}
      title={`Puissance ${balance.power}, visée ${balance.target}`}
    >
      {strong ? `trop forte +${balance.gap}` : `trop faible ${balance.gap}`}
    </span>
  );
}

interface CatalogPanelProps {
  admin: CatalogAdmin;
}

function CatalogPanel({ admin }: CatalogPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [elementFilter, setElementFilter] = useState<ElementFilter>('all');
  const [rarityFilter, setRarityFilter] = useState<RarityFilter>('all');

  const catalog = admin.draft;
  const cards = catalog?.cards ?? [];

  const visible = useMemo(
    () =>
      cards.filter(
        (card) =>
          (kindFilter === 'all' || card.kind === kindFilter) &&
          (elementFilter === 'all' || card.element === elementFilter) &&
          (rarityFilter === 'all' || cardRarity(card) === rarityFilter),
      ),
    [cards, kindFilter, elementFilter, rarityFilter],
  );

  // La carte sélectionnée peut avoir été supprimée ou renommée : on retombe sur la première
  // visible plutôt que d'afficher un éditeur vide.
  const selected = cards.find((card) => card.id === selectedId) ?? visible[0] ?? null;

  if (!catalog) return null;

  // V2 : pas de deck de départ commun, les exemplaires se règlent deck par deck (onglet « Decks »).
  const hasStarterDeck = admin.version === 'v1';
  const totalCopies = Object.values(catalog.starterCounts).reduce((a, b) => a + b, 0);
  const missingArt = cards.filter((card) => !hasCardArt(card.id)).length;

  function addCard(kind: CardDef['kind']) {
    const id = nextFreeId(cards);
    admin.addCard(freshCard(kind, id));
    setSelectedId(id);
  }

  return (
    <div className="admin-panel">
      <AdminHeader
        title="Cartes"
        summary={
          <>
            {cards.length} cartes
            {hasStarterDeck
              ? ` · ${totalCopies} exemplaires dans le deck de départ`
              : ` · ${catalog.decks?.length ?? 0} decks`}{' '}
            · version{' '}
            {catalog.version}
            {missingArt > 0 && ` · ${missingArt} sans illustration`}
          </>
        }
        admin={admin}
      >
        <button type="button" onClick={() => addCard('monster')}>
          + Monstre
        </button>
        <button type="button" onClick={() => addCard('enchantment')}>
          + Enchantement
        </button>
      </AdminHeader>

      <div className="admin-body">
        <aside className="admin-list">
          <div className="admin-filters">
            <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as KindFilter)}>
              <option value="all">Tous les types</option>
              <option value="monster">Monstres</option>
              <option value="enchantment">Enchantements</option>
            </select>
            <select value={elementFilter} onChange={(e) => setElementFilter(e.target.value as ElementFilter)}>
              <option value="all">Tous les éléments</option>
              {elementsFor(admin.version).map((element) => (
                <option key={element} value={element}>
                  {ELEMENT_LABELS[element]}
                </option>
              ))}
            </select>
            <select value={rarityFilter} onChange={(e) => setRarityFilter(e.target.value as RarityFilter)}>
              <option value="all">Toutes les raretés</option>
              {CARD_RARITIES.map((rarity) => (
                <option key={rarity} value={rarity}>
                  {RARITY_LABELS[rarity]}
                </option>
              ))}
            </select>
          </div>

          <ul>
            {visible.map((card) => (
              <li key={card.id}>
                <button
                  type="button"
                  className={card.id === selected?.id ? 'admin-list-item is-selected' : 'admin-list-item'}
                  onClick={() => setSelectedId(card.id)}
                >
                  <span className="admin-list-name">{card.name || '(sans nom)'}</span>
                  <span className="admin-list-meta">
                    {ELEMENT_LABELS[card.element]} · {RARITY_LABELS[cardRarity(card)]} · {card.cost} ¤
                    {isMonster(card) ? ` · ${card.attack}/${card.defense}` : ' · ench.'}
                    {hasStarterDeck && ` · ×${catalog.starterCounts[card.id] ?? 0}`}
                    {` · P${cardPower(card).total}`}
                  </span>
                  <BalanceBadge card={card} />
                  {!hasCardArt(card.id) && <span className="admin-list-badge">sans illustration</span>}
                </button>
              </li>
            ))}
            {visible.length === 0 && <li className="admin-list-empty">Aucune carte pour ce filtre.</li>}
          </ul>
        </aside>

        <section className="admin-detail">
          {selected ? (
            // Pas de `key` volontairement : `CardEditor` est entièrement contrôlé (aucun état
            // interne), et le remonter à chaque frappe ferait perdre le focus quand on modifie
            // l'identifiant de la carte.
            <CardEditor
              version={admin.version}
              def={selected}
              copies={hasStarterDeck ? (catalog.starterCounts[selected.id] ?? 0) : undefined}
              onChange={(next) => {
                admin.updateCard(selected.id, next);
                setSelectedId(next.id);
              }}
              onCopiesChange={hasStarterDeck ? (count) => admin.setCount(selected.id, count) : undefined}
              onRemove={() => {
                admin.removeCard(selected.id);
                setSelectedId(null);
              }}
            />
          ) : (
            <p>Ajoute une carte pour commencer.</p>
          )}
        </section>
      </div>
    </div>
  );
}

export default CatalogPanel;
