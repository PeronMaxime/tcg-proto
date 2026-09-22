import { useMemo, useState } from 'react';
import {
  ELEMENT_LABELS,
  KEYWORD_LABELS,
  RARITY_LABELS,
  cardPower,
  cardRarity,
  describeAbility,
  describeAura,
  describeEffect,
  isMonster,
} from '../../game/cards';
import { CARD_ELEMENTS, CARD_RARITIES } from '../../game/catalogSchema';
import type { CardDef, CardElement, CardRarity } from '../../game/types';
import AdminHeader from './AdminHeader';
import type { CatalogAdmin } from './useCatalogAdmin';

// Récapitulatif de tout le catalogue en un tableau : une ligne par carte, une colonne par
// caractéristique. Onglet de LECTURE — on ne modifie rien ici, c'est la vue d'ensemble qui
// manque à l'onglet « Cartes », où l'on ne voit qu'une carte à la fois. Filtres en haut, tri
// en cliquant sur un en-tête.

type KindFilter = 'all' | CardDef['kind'];
type ElementFilter = 'all' | CardElement;
type RarityFilter = 'all' | CardRarity;

// Colonnes triables. Chaque clé donne la valeur de tri d'une carte (`sortValue`) : un nombre
// pour les colonnes chiffrées, une chaîne pour les autres. Les enchantements n'ont ni attaque
// ni défense : ils valent -1, donc ils se rangent avant le plus faible des monstres.
type SortKey =
  | 'name'
  | 'cost'
  | 'kind'
  | 'element'
  | 'attack'
  | 'defense'
  | 'rarity'
  | 'keywords'
  | 'aura'
  | 'abilities'
  | 'power';

const COLUMNS: { key: SortKey; label: string; numeric?: true }[] = [
  { key: 'name', label: 'Nom' },
  { key: 'cost', label: 'Coût', numeric: true },
  { key: 'kind', label: 'Type' },
  { key: 'element', label: 'Élément' },
  { key: 'attack', label: 'Attaque', numeric: true },
  { key: 'defense', label: 'Défense', numeric: true },
  { key: 'rarity', label: 'Rareté' },
  { key: 'keywords', label: 'Habiletés' },
  { key: 'aura', label: 'Auras' },
  { key: 'abilities', label: 'Capacités' },
  { key: 'power', label: 'Puissance', numeric: true },
];

function sortValue(card: CardDef, key: SortKey): string | number {
  switch (key) {
    case 'name':
      return card.name.toLowerCase();
    case 'cost':
      return card.cost;
    case 'kind':
      return card.kind;
    case 'element':
      return ELEMENT_LABELS[card.element];
    case 'attack':
      return isMonster(card) ? card.attack : -1;
    case 'defense':
      return isMonster(card) ? card.defense : -1;
    // Par ordre de rareté croissante, pas par ordre alphabétique du libellé.
    case 'rarity':
      return CARD_RARITIES.indexOf(cardRarity(card));
    case 'keywords':
      return isMonster(card) ? (card.keywords?.length ?? 0) : 0;
    case 'aura':
      return isMonster(card) && card.aura ? card.aura.attack + card.aura.defense : 0;
    case 'abilities':
      return card.abilities?.length ?? 0;
    case 'power':
      return cardPower(card).total;
  }
}

// Effets d'une carte, ligne par ligne : capacités déclenchées pour un monstre, plus l'effet
// permanent d'un enchantement, qui n'est pas une `CardAbility` mais se lit dans la même colonne.
function abilityLines(card: CardDef): string[] {
  const lines = (card.abilities ?? []).map(describeAbility);
  if (!isMonster(card)) lines.unshift(describeEffect(card.effect));
  return lines;
}

interface CardsTableProps {
  admin: CatalogAdmin;
}

function CardsTable({ admin }: CardsTableProps) {
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [elementFilter, setElementFilter] = useState<ElementFilter>('all');
  const [rarityFilter, setRarityFilter] = useState<RarityFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [ascending, setAscending] = useState(true);

  const cards = admin.draft?.cards ?? [];

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = cards.filter(
      (card) =>
        (kindFilter === 'all' || card.kind === kindFilter) &&
        (elementFilter === 'all' || card.element === elementFilter) &&
        (rarityFilter === 'all' || cardRarity(card) === rarityFilter) &&
        (needle === '' || card.name.toLowerCase().includes(needle) || card.id.toLowerCase().includes(needle)),
    );
    // Copie avant tri : `cards` est le brouillon, on ne réordonne pas le catalogue en triant.
    return [...filtered].sort((a, b) => {
      const left = sortValue(a, sortKey);
      const right = sortValue(b, sortKey);
      if (left === right) return a.name.localeCompare(b.name);
      const order =
        typeof left === 'number' && typeof right === 'number'
          ? left - right
          : String(left).localeCompare(String(right));
      return ascending ? order : -order;
    });
  }, [cards, search, kindFilter, elementFilter, rarityFilter, sortKey, ascending]);

  // Cliquer la colonne déjà triée inverse le sens, sinon on trie dessus en ordre croissant.
  function toggleSort(key: SortKey) {
    if (key === sortKey) setAscending((current) => !current);
    else {
      setSortKey(key);
      setAscending(true);
    }
  }

  if (!admin.draft) return null;

  return (
    <div className="admin-panel">
      <AdminHeader
        title="Récapitulatif"
        summary={`${rows.length} carte${rows.length > 1 ? 's' : ''} affichée${rows.length > 1 ? 's' : ''} sur ${cards.length} · clique un en-tête pour trier`}
        admin={admin}
      />

      <div className="admin-filters admin-filters-bar">
        <input
          type="search"
          value={search}
          placeholder="Chercher un nom…"
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as KindFilter)}>
          <option value="all">Tous les types</option>
          <option value="monster">Monstres</option>
          <option value="enchantment">Enchantements</option>
        </select>
        <select value={elementFilter} onChange={(e) => setElementFilter(e.target.value as ElementFilter)}>
          <option value="all">Tous les éléments</option>
          {CARD_ELEMENTS.map((element) => (
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

      <div className="admin-table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              {COLUMNS.map((column) => (
                <th
                  key={column.key}
                  className={column.numeric ? 'is-numeric' : undefined}
                  aria-sort={sortKey === column.key ? (ascending ? 'ascending' : 'descending') : 'none'}
                >
                  <button type="button" className="admin-table-sort" onClick={() => toggleSort(column.key)}>
                    {column.label}
                    {sortKey === column.key && <span aria-hidden="true">{ascending ? ' ▲' : ' ▼'}</span>}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((card) => {
              const keywords = isMonster(card) ? (card.keywords ?? []) : [];
              const abilities = abilityLines(card);
              return (
                <tr key={card.id}>
                  <td>{card.name || '(sans nom)'}</td>
                  <td className="is-numeric">{card.cost}</td>
                  <td>{isMonster(card) ? 'Monstre' : 'Enchantement'}</td>
                  <td>{ELEMENT_LABELS[card.element]}</td>
                  <td className="is-numeric">{isMonster(card) ? card.attack : '—'}</td>
                  <td className="is-numeric">{isMonster(card) ? card.defense : '—'}</td>
                  <td>{RARITY_LABELS[cardRarity(card)]}</td>
                  <td>
                    {keywords.length === 0 ? (
                      <span className="admin-table-empty">—</span>
                    ) : (
                      <ul className="admin-table-list">
                        {keywords.map((keyword) => (
                          <li key={keyword}>{KEYWORD_LABELS[keyword]}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td>
                    {isMonster(card) && card.aura ? (
                      describeAura(card.aura)
                    ) : (
                      <span className="admin-table-empty">—</span>
                    )}
                  </td>
                  <td>
                    {abilities.length === 0 ? (
                      <span className="admin-table-empty">—</span>
                    ) : (
                      <ul className="admin-table-list">
                        {abilities.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="is-numeric">{cardPower(card).total}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="admin-table-empty">
                  Aucune carte pour ce filtre.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default CardsTable;
