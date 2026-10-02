import { useMemo, useState } from 'react';
import { ELEMENT_LABELS, RARITY_LABELS, cardRarity, isMonster } from '../../game/cards';
import { MAX_COPIES, MAX_DECK_NAME_LENGTH } from '../../game/catalogSchema';
import { DECK_SIZE, deckProblems, deckSize, maxCopiesFor } from '../../game/decks';
import type { CardDef, CardElement } from '../../game/types';
import AdminHeader from './AdminHeader';
import type { CatalogAdmin } from './useCatalogAdmin';

// Onglet « Decks » (V2) : les decks proposés aux joueurs sur l'écran de choix, avant chaque
// partie. Un deck n'est proposé qu'à `DECK_SIZE` cartes pile ; un deck incomplet s'enregistre
// quand même, pour pouvoir le composer en plusieurs fois. Le premier deck JOUABLE de la liste
// est attribué d'office au joueur qui n'a pas choisi à temps.

type KindFilter = 'all' | 'inDeck' | CardDef['kind'];
type ElementFilter = 'all' | CardElement;

interface DecksPanelProps {
  admin: CatalogAdmin;
}

function DecksPanel({ admin }: DecksPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [elementFilter, setElementFilter] = useState<ElementFilter>('all');

  const catalog = admin.draft;
  const decks = catalog?.decks ?? [];
  const selected = decks.find((deck) => deck.id === selectedId) ?? decks[0] ?? null;

  const cards = useMemo(
    () =>
      [...(catalog?.cards ?? [])]
        .filter(
          (card) =>
            (kindFilter === 'all' ||
              (kindFilter === 'inDeck' ? (selected?.counts[card.id] ?? 0) > 0 : card.kind === kindFilter)) &&
            (elementFilter === 'all' || card.element === elementFilter),
        )
        .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name)),
    [catalog, kindFilter, elementFilter, selected],
  );

  if (!catalog) return null;

  // Premier deck jouable : celui attribué d'office (voir `defaultDeck`).
  const defaultId = decks.find((deck) => deckProblems(deck, catalog).length === 0)?.id ?? null;
  const playableCount = decks.filter((deck) => deckProblems(deck, catalog).length === 0).length;

  function addDeck(duplicate: boolean) {
    setSelectedId(admin.addDeck(duplicate && selected ? selected : undefined));
  }

  function removeSelected() {
    if (!selected) return;
    if (!window.confirm(`Supprimer le deck « ${selected.name} » ?`)) return;
    admin.removeDeck(selected.id);
    setSelectedId(null);
  }

  const size = selected ? deckSize(selected) : 0;
  const elementCounts = { fire: 0, water: 0, air: 0, earth: 0, neutral: 0 };
  if (selected) {
    for (const card of catalog.cards) elementCounts[card.element] += selected.counts[card.id] ?? 0;
  }

  return (
    <div className="admin-panel">
      <AdminHeader
        title="Decks"
        summary={
          <>
            {decks.length} decks · {playableCount} jouables ({DECK_SIZE} cartes pile)
            {playableCount === 0 && ' · aucune partie V2 ne peut être créée'}
          </>
        }
        admin={admin}
      >
        <button type="button" onClick={() => addDeck(false)}>
          + Deck
        </button>
        <button type="button" onClick={() => addDeck(true)} disabled={!selected}>
          Dupliquer
        </button>
      </AdminHeader>

      <div className="admin-body">
        <aside className="admin-list">
          <ul>
            {decks.map((deck, i) => {
              const problems = deckProblems(deck, catalog);
              return (
                <li key={deck.id} className="admin-deck-row">
                  <button
                    type="button"
                    className={deck.id === selected?.id ? 'admin-list-item is-selected' : 'admin-list-item'}
                    onClick={() => setSelectedId(deck.id)}
                  >
                    <span className="admin-list-name">{deck.name || '(sans nom)'}</span>
                    <span className="admin-list-meta">
                      {deckSize(deck)} / {DECK_SIZE} cartes
                    </span>
                    {deck.id === defaultId && <span className="admin-list-badge">par défaut</span>}
                    {problems.length > 0 && (
                      <span className="admin-list-balance is-weak">non jouable : {problems.join(' · ')}</span>
                    )}
                  </button>
                  <div className="admin-deck-order">
                    <button
                      type="button"
                      aria-label={`Monter ${deck.name}`}
                      onClick={() => admin.moveDeck(deck.id, -1)}
                      disabled={i === 0}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Descendre ${deck.name}`}
                      onClick={() => admin.moveDeck(deck.id, 1)}
                      disabled={i === decks.length - 1}
                    >
                      ↓
                    </button>
                  </div>
                </li>
              );
            })}
            {decks.length === 0 && <li className="admin-list-empty">Aucun deck. Crée-en un avec « + Deck ».</li>}
          </ul>
        </aside>

        <section className="admin-detail">
          {selected ? (
            <div className="admin-deck">
              <div className="admin-deck-head">
                <label className="admin-field">
                  <span>Nom</span>
                  <input
                    value={selected.name}
                    maxLength={MAX_DECK_NAME_LENGTH}
                    onChange={(e) => admin.renameDeck(selected.id, e.target.value)}
                  />
                </label>
                <p className={size === DECK_SIZE ? 'admin-deck-size is-complete' : 'admin-deck-size'}>
                  {size} / {DECK_SIZE}
                </p>
                <button type="button" className="admin-remove" onClick={removeSelected}>
                  Supprimer le deck
                </button>
              </div>

              <p className="admin-summary">
                {(Object.keys(ELEMENT_LABELS) as CardElement[])
                  .map((element) => `${ELEMENT_LABELS[element]} ${elementCounts[element]}`)
                  .join(' · ')}
              </p>

              <div className="admin-filters">
                <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as KindFilter)}>
                  <option value="all">Toutes les cartes</option>
                  <option value="inDeck">Dans le deck</option>
                  <option value="monster">Monstres</option>
                  <option value="enchantment">Enchantements</option>
                </select>
                <select value={elementFilter} onChange={(e) => setElementFilter(e.target.value as ElementFilter)}>
                  <option value="all">Tous les éléments</option>
                  {(Object.keys(ELEMENT_LABELS) as CardElement[]).map((element) => (
                    <option key={element} value={element}>
                      {ELEMENT_LABELS[element]}
                    </option>
                  ))}
                </select>
              </div>

              <table className="admin-deck-cards">
                <thead>
                  <tr>
                    <th>Carte</th>
                    <th>Élément</th>
                    <th>Rareté</th>
                    <th>Coût</th>
                    <th>Stats</th>
                    <th>Exemplaires</th>
                  </tr>
                </thead>
                <tbody>
                  {cards.map((card) => {
                    const count = selected.counts[card.id] ?? 0;
                    // Limite de la rareté (onglet « Paramètres »), sinon le plafond technique.
                    const max = maxCopiesFor(catalog, card) ?? MAX_COPIES;
                    const set = (next: number) =>
                      admin.setDeckCount(selected.id, card.id, Math.max(0, Math.min(max, next)));
                    return (
                      <tr key={card.id} className={count > 0 ? 'is-in-deck' : undefined}>
                        <td>{card.name || card.id}</td>
                        <td>{ELEMENT_LABELS[card.element]}</td>
                        <td>{RARITY_LABELS[cardRarity(card)]}</td>
                        <td>{card.cost} ¤</td>
                        <td>{isMonster(card) ? `${card.attack}/${card.defense}` : 'ench.'}</td>
                        <td>
                          <div className="admin-deck-stepper">
                            <button
                              type="button"
                              aria-label={`Retirer un ${card.name}`}
                              onClick={() => set(count - 1)}
                              disabled={count === 0}
                            >
                              −
                            </button>
                            <input
                              type="number"
                              min={0}
                              max={max}
                              value={count}
                              aria-label={`Exemplaires de ${card.name}`}
                              onChange={(e) => set(Number(e.target.value) || 0)}
                            />
                            <button
                              type="button"
                              aria-label={`Ajouter un ${card.name}`}
                              onClick={() => set(count + 1)}
                              disabled={count >= max}
                            >
                              +
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {cards.length === 0 && (
                    <tr>
                      <td colSpan={6}>Aucune carte pour ce filtre.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <p>Crée un deck pour commencer.</p>
          )}
        </section>
      </div>
    </div>
  );
}

export default DecksPanel;
