import { useEffect, useMemo, useState } from 'react';
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
// en cliquant sur un en-tête, et colonnes réordonnables en les faisant glisser.
//
// L'ordre des colonnes est une préférence d'affichage, pas une donnée du catalogue : il vit
// dans le `localStorage` du navigateur (`COLUMN_ORDER_KEY`) et non dans le catalogue partagé,
// pour que chacun garde sa disposition sans la pousser aux autres au prochain enregistrement.

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

interface Column {
  key: SortKey;
  label: string;
  numeric?: true;
}

// Ordre par défaut, et seule source des colonnes qui existent : une disposition relue du
// stockage est filtrée contre ces clés, donc renommer ou retirer une colonne ici suffit — les
// dispositions enregistrées s'y recalent d'elles-mêmes.
const COLUMNS: Column[] = [
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

const DEFAULT_ORDER: SortKey[] = COLUMNS.map((column) => column.key);
const COLUMN_ORDER_KEY = 'tcg-admin:cards-table-columns';

// Une disposition relue doit rester utilisable telle quelle : on ne garde que des clés
// connues, sans doublon, puis on ajoute à la fin les colonnes apparues depuis. Une valeur
// illisible (ou un `localStorage` indisponible) retombe donc sur l'ordre par défaut complet.
function normalizeOrder(raw: unknown): SortKey[] {
  const known = new Set<string>(DEFAULT_ORDER);
  const seen = new Set<SortKey>();
  const order: SortKey[] = [];
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry !== 'string' || !known.has(entry)) continue;
      const key = entry as SortKey;
      if (seen.has(key)) continue;
      seen.add(key);
      order.push(key);
    }
  }
  for (const key of DEFAULT_ORDER) if (!seen.has(key)) order.push(key);
  return order;
}

function readStoredOrder(): SortKey[] {
  try {
    const raw = localStorage.getItem(COLUMN_ORDER_KEY);
    return normalizeOrder(raw === null ? null : JSON.parse(raw));
  } catch {
    return [...DEFAULT_ORDER];
  }
}

// Déplace la colonne `from` à la place de celle sur laquelle on l'a lâchée (`to`), en gardant
// tout le reste dans l'ordre. Le côté dépend du sens du geste : glisser vers la droite dépose
// APRÈS la colonne visée, vers la gauche AVANT. Sans ça, tirer une colonne jusqu'au bout du
// tableau la laisserait en avant-dernière position, ce qui rend le déplacement impossible à
// terminer. Lâcher une colonne sur elle-même ne change rien.
function moveColumn(order: SortKey[], from: SortKey, to: SortKey): SortKey[] {
  if (from === to) return order;
  const rightwards = order.indexOf(from) < order.indexOf(to);
  const next = order.filter((key) => key !== from);
  const at = next.indexOf(to);
  if (at === -1) return order;
  next.splice(rightwards ? at + 1 : at, 0, from);
  return next;
}

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

// Contenu d'une cellule, par colonne. Séparé du rendu du tableau parce que l'ordre des
// colonnes n'est plus connu à l'écriture : chaque `<td>` demande ici quoi afficher au lieu
// d'être écrit en dur à sa place.
function renderCell(card: CardDef, key: SortKey) {
  const empty = <span className="admin-table-empty">—</span>;
  switch (key) {
    case 'name':
      return card.name || '(sans nom)';
    case 'cost':
      return card.cost;
    case 'kind':
      return isMonster(card) ? 'Monstre' : 'Enchantement';
    case 'element':
      return ELEMENT_LABELS[card.element];
    case 'attack':
      return isMonster(card) ? card.attack : '—';
    case 'defense':
      return isMonster(card) ? card.defense : '—';
    case 'rarity':
      return RARITY_LABELS[cardRarity(card)];
    case 'keywords': {
      const keywords = isMonster(card) ? (card.keywords ?? []) : [];
      if (keywords.length === 0) return empty;
      return (
        <ul className="admin-table-list">
          {keywords.map((keyword) => (
            <li key={keyword}>{KEYWORD_LABELS[keyword]}</li>
          ))}
        </ul>
      );
    }
    case 'aura':
      return isMonster(card) && card.aura ? describeAura(card.aura) : empty;
    case 'abilities': {
      const lines = abilityLines(card);
      if (lines.length === 0) return empty;
      return (
        <ul className="admin-table-list">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      );
    }
    case 'power':
      return cardPower(card).total;
  }
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
  const [order, setOrder] = useState<SortKey[]>(readStoredOrder);
  // Colonne en cours de déplacement, et celle survolée : elles ne servent qu'au retour visuel
  // pendant le glisser, l'ordre réel ne change qu'au lâcher.
  const [dragged, setDragged] = useState<SortKey | null>(null);
  const [dropTarget, setDropTarget] = useState<SortKey | null>(null);

  // L'ordre se réenregistre à chaque changement : rouvrir l'onglet (ou l'appli) retrouve la
  // disposition. Un stockage refusé (navigation privée) ne doit pas casser la vue.
  useEffect(() => {
    try {
      localStorage.setItem(COLUMN_ORDER_KEY, JSON.stringify(order));
    } catch {
      // Pas de stockage : la disposition ne vivra que le temps de la session.
    }
  }, [order]);

  const columns = useMemo(
    () => order.map((key) => COLUMNS.find((column) => column.key === key)!),
    [order],
  );
  const isDefaultOrder = order.every((key, at) => key === DEFAULT_ORDER[at]);

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
      const direction =
        typeof left === 'number' && typeof right === 'number'
          ? left - right
          : String(left).localeCompare(String(right));
      return ascending ? direction : -direction;
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

  // Glisser-déposer des en-têtes : l'ordre ne bouge qu'au lâcher, sur la colonne survolée.
  function dropOn(target: SortKey) {
    if (dragged) setOrder((current) => moveColumn(current, dragged, target));
    setDragged(null);
    setDropTarget(null);
  }

  if (!admin.draft) return null;

  return (
    <div className="admin-panel">
      <AdminHeader
        title="Récapitulatif"
        summary={`${rows.length} carte${rows.length > 1 ? 's' : ''} affichée${rows.length > 1 ? 's' : ''} sur ${cards.length} · clique un en-tête pour trier, glisse-le pour déplacer la colonne`}
        admin={admin}
      >
        <button
          type="button"
          disabled={isDefaultOrder}
          onClick={() => setOrder([...DEFAULT_ORDER])}
        >
          Rétablir l’ordre des colonnes
        </button>
      </AdminHeader>

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
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={[
                    column.numeric ? 'is-numeric' : '',
                    'is-draggable',
                    dragged === column.key ? 'is-dragging' : '',
                    dragged && dropTarget === column.key && dragged !== column.key
                      ? order.indexOf(dragged) < order.indexOf(column.key)
                        ? 'is-drop-after'
                        : 'is-drop-before'
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  aria-sort={sortKey === column.key ? (ascending ? 'ascending' : 'descending') : 'none'}
                  draggable
                  onDragStart={(e) => {
                    setDragged(column.key);
                    // Firefox n'émet pas de `dragstart` utilisable sans charge utile.
                    e.dataTransfer.setData('text/plain', column.key);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={(e) => {
                    if (!dragged) return;
                    e.preventDefault(); // sans ça le navigateur refuse le lâcher
                    e.dataTransfer.dropEffect = 'move';
                    setDropTarget(column.key);
                  }}
                  onDragLeave={() => setDropTarget((current) => (current === column.key ? null : current))}
                  onDrop={(e) => {
                    e.preventDefault();
                    dropOn(column.key);
                  }}
                  onDragEnd={() => {
                    setDragged(null);
                    setDropTarget(null);
                  }}
                >
                  <button
                    type="button"
                    className="admin-table-sort"
                    title={`${column.label} — clique pour trier, glisse pour déplacer la colonne`}
                    onClick={() => toggleSort(column.key)}
                  >
                    <span className="admin-table-grip" aria-hidden="true">
                      ⠿
                    </span>
                    {column.label}
                    {sortKey === column.key && <span aria-hidden="true">{ascending ? ' ▲' : ' ▼'}</span>}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((card) => (
              <tr key={card.id}>
                {columns.map((column) => (
                  <td key={column.key} className={column.numeric ? 'is-numeric' : undefined}>
                    {renderCell(card, column.key)}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="admin-table-empty">
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
