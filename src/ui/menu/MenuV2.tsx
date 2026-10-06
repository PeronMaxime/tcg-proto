import { DECK_CHOICE_MS } from '../../game/decks';
import { JoinForm, MenuFooter, PseudoField, ResumeButton, TitleMast, useRoomEntry } from './menuParts';

// Menu de la V2 : chaque joueur choisit son deck une fois l'adversaire arrivé (`DeckChoice`),
// parmi ceux composés dans l'admin.
function MenuV2({ onRoomReady }: { onRoomReady: (code: string) => void }) {
  const entry = useRoomEntry(onRoomReady);

  return (
    <main className="title">
      <TitleMast kicker="Prototype V2 · duel à deux joueurs" />
      <ResumeButton entry={entry} />
      <PseudoField />

      <section className="title-block" aria-labelledby="title-new">
        <h2 id="title-new" className="title-block-heading">
          Nouvelle partie
        </h2>
        <p className="title-note">
          Une fois ton adversaire arrivé, chacun aura {DECK_CHOICE_MS / 1000} secondes pour choisir son
          deck.
        </p>
        <button className="title-primary" onClick={() => void entry.create('v2')} disabled={entry.busy}>
          Créer une partie
        </button>
      </section>

      <JoinForm entry={entry} />
      <MenuFooter entry={entry} />
    </main>
  );
}

export default MenuV2;
