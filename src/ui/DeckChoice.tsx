import { useEffect, useMemo, useRef, useState } from 'react';
import { ELEMENT_LABELS, isMonster } from '../game/cards';
import { deckSize, playableDecks } from '../game/decks';
import type { CardDef, CardElement, DeckDef, Room, Seat } from '../game/types';
import { chooseDeck, expireDeckChoice, leaveMatch, rememberLeftRoom } from '../net/rooms';

// Écran de choix du deck (V2, demande utilisateur) : les deux joueurs sont assis, chacun choisit
// le deck qu'il va jouer parmi ceux composés dans l'admin. `DECK_CHOICE_MS` pour se décider :
// passé ce délai, le premier deck de la liste est attribué à qui n'a pas validé. Le choix
// adverse n'est pas montré, seulement le fait qu'il a validé.

const ELEMENTS = Object.keys(ELEMENT_LABELS) as CardElement[];

interface DeckChoiceProps {
  room: Room;
  seat: Seat;
  onLeave: () => void;
}

function deckEntries(deck: DeckDef, cardsById: Map<string, CardDef>): { def: CardDef; count: number }[] {
  return Object.entries(deck.counts)
    .flatMap(([id, count]) => {
      const def = cardsById.get(id);
      return def ? [{ def, count }] : [];
    })
    .sort((a, b) => a.def.cost - b.def.cost || a.def.name.localeCompare(b.def.name));
}

function elementCounts(deck: DeckDef, cardsById: Map<string, CardDef>): Record<CardElement, number> {
  const counts = { fire: 0, water: 0, air: 0, earth: 0 };
  for (const { def, count } of deckEntries(deck, cardsById)) counts[def.element] += count;
  return counts;
}

function DeckChoice({ room, seat, onLeave }: DeckChoiceProps) {
  const catalog = room.catalog;
  const decks = useMemo(() => (catalog ? playableDecks(catalog) : []), [catalog]);
  const cardsById = useMemo(() => new Map((catalog?.cards ?? []).map((card) => [card.id, card])), [catalog]);

  const opponentSeat: Seat = seat === 'p1' ? 'p2' : 'p1';
  const opponentName = room.players[opponentSeat]?.name || (opponentSeat === 'p1' ? 'Joueur 1' : 'Joueur 2');
  const myChoice = room.deckChoice?.[seat] ?? null;
  const opponentReady = Boolean(room.deckChoice?.[opponentSeat]);
  const opponentLeft = Boolean(room.leftAt?.[opponentSeat]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const selected = decks.find((deck) => deck.id === (myChoice ?? selectedId)) ?? decks[0] ?? null;
  const deadline = room.deckDeadline ?? 0;
  const remaining = Math.max(0, Math.ceil((deadline - now) / 1000));

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, []);

  // Délai écoulé : on démarre la partie avec le deck par défaut pour qui n'a pas validé. Les deux
  // clients le tentent, la transaction n'en laisse passer qu'un. Nouvel essai toutes les deux
  // secondes si l'écriture échoue (réseau) tant que la room n'a pas basculé.
  const lastExpireAttempt = useRef(0);
  useEffect(() => {
    if (remaining > 0 || now - lastExpireAttempt.current < 2000) return;
    lastExpireAttempt.current = now;
    expireDeckChoice(room).catch(() => {});
  }, [remaining, now, room]);

  async function validate() {
    if (!selected || myChoice) return;
    setError(null);
    setBusy(true);
    try {
      await chooseDeck(room, seat, selected.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue.');
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    let resumable = true;
    try {
      resumable = await leaveMatch(room, seat);
    } catch {
      // Le retour au menu doit fonctionner même si l'écriture échoue (hors-ligne, etc.).
    }
    if (resumable) rememberLeftRoom(room.code);
    onLeave();
  }

  return (
    <main className="title deck-choice">
      <header className="deck-choice-head">
        <div>
          <p className="title-kicker">Avant la partie</p>
          <h1 className="lobby-heading">Choisis ton deck</h1>
        </div>
        <p
          className={remaining <= 5 ? 'deck-choice-timer is-urgent' : 'deck-choice-timer'}
          role="timer"
          aria-label={`${remaining} secondes restantes`}
        >
          {remaining}
        </p>
      </header>

      <div className="deck-choice-body">
        <ul className="deck-choice-list" role="radiogroup" aria-label="Decks">
          {decks.map((deck, i) => {
            const counts = elementCounts(deck, cardsById);
            const checked = deck.id === selected?.id;
            return (
              <li key={deck.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  className="deck-choice-item"
                  onClick={() => setSelectedId(deck.id)}
                  disabled={Boolean(myChoice)}
                >
                  <span className="deck-choice-name">{deck.name}</span>
                  {i === 0 && <span className="deck-choice-default">par défaut</span>}
                  <span className="deck-choice-elements" aria-label="Répartition par élément">
                    {ELEMENTS.filter((element) => counts[element] > 0).map((element) => (
                      <span key={element} className={`is-${element}`} title={ELEMENT_LABELS[element]}>
                        {counts[element]}
                      </span>
                    ))}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {selected && (
          <section className="deck-choice-detail" aria-label={`Contenu du deck ${selected.name}`}>
            <h2>
              {selected.name} <span>· {deckSize(selected)} cartes</span>
            </h2>
            <ul>
              {deckEntries(selected, cardsById).map(({ def, count }) => (
                <li key={def.id} className={`is-${def.element}`}>
                  <span className="deck-choice-count">×{count}</span>
                  <span className="deck-choice-card">{def.name}</span>
                  <span className="deck-choice-meta">
                    {def.cost} ¤{isMonster(def) ? ` · ${def.attack}/${def.defense}` : ' · ench.'}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <div className="deck-choice-footer">
        <p className="deck-choice-status" role="status">
          {opponentLeft
            ? `${opponentName} a quitté la partie.`
            : opponentReady
              ? `${opponentName} a choisi son deck.`
              : `${opponentName} choisit son deck…`}
        </p>
        <button className="title-primary" onClick={validate} disabled={busy || !selected || Boolean(myChoice)}>
          {myChoice ? 'Deck validé — en attente…' : 'Valider ce deck'}
        </button>
        {error && (
          <p className="title-error" role="alert">
            {error}
          </p>
        )}
        <button className="lobby-cancel" onClick={leave}>
          Quitter la partie
        </button>
      </div>
    </main>
  );
}

export default DeckChoice;
