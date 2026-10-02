import { JoinForm, MenuFooter, PseudoField, ResumeButton, TitleMast, useRoomEntry, useZoneSize, ZoneSizePicker } from './menuParts';

// Menu de la V1 : les deux joueurs jouent le deck de départ du catalogue, la partie démarre dès
// que l'adversaire rejoint.
function MenuV1({ onRoomReady }: { onRoomReady: (code: string) => void }) {
  const entry = useRoomEntry(onRoomReady);
  const [zoneSize, setZoneSize] = useZoneSize();

  return (
    <main className="title">
      <TitleMast kicker="Prototype · duel à deux joueurs" />
      <ResumeButton entry={entry} />
      <PseudoField />

      {/* Les réglages ne valent que pour la partie créée : « Rejoindre » suit la room. D'où leur
          regroupement avec le bouton de création. */}
      <section className="title-block" aria-labelledby="title-new">
        <h2 id="title-new" className="title-block-heading">
          Nouvelle partie
        </h2>
        <ZoneSizePicker value={zoneSize} onChange={setZoneSize} disabled={entry.busy} />
        <button className="title-primary" onClick={() => void entry.create(zoneSize, 'v1')} disabled={entry.busy}>
          Créer une partie
        </button>
      </section>

      <JoinForm entry={entry} />
      <MenuFooter entry={entry} />
    </main>
  );
}

export default MenuV1;
