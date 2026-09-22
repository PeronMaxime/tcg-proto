// Règles du jeu pour les débutants (demande utilisateur) : une popin volontairement courte,
// qui explique le déroulé d'un tour et les quelques notions à connaître, sans reprendre le
// détail de `rules.ts` (README §4 pour la version complète). Même comportement que les autres
// popins du jeu (fond cliquable, croix, Échap géré par le HUD).

interface RulesModalProps {
  onClose: () => void;
}

interface RulesSection {
  title: string;
  lines: string[];
}

const SECTIONS: RulesSection[] = [
  {
    title: 'Le but',
    lines: [
      "Chaque joueur commence avec 10 points de vie. Le premier qui fait tomber le héros adverse à 0 gagne.",
      "Un lancer de pièce désigne qui joue en premier ; l'autre reçoit 2 pièces de départ en compensation.",
    ],
  },
  {
    title: 'Un tour, étape par étape',
    lines: [
      "1. Tu gagnes des pièces : 1 à ton 1er tour, 2 au 2e, 3 au 3e… elles se cumulent.",
      "2. Le marché te propose 3 cartes de ton deck : achète celles que tu peux payer, elles partent dans ta main.",
      "Le marché ne te plaît pas ? « Relancer » remplace les cartes pour 1 pièce, autant de fois que tu peux payer.",
      "Le cadenas en haut à gauche d'une carte du marché la garde pour ton prochain marché, pour 1 pièce : elle échappe aux relances et ne retourne pas dans le deck en fin de tour (le déverrouiller est gratuit, mais ne rembourse pas).",
      "3. Pose autant de cartes que tu veux depuis ta main : poser ne coûte rien.",
      "4. Clique sur « Combat ! » : les monstres s'affrontent tout seuls, puis c'est au tour de l'adversaire.",
    ],
  },
  {
    title: 'Le plateau',
    lines: [
      "Zone d'attaque (5 emplacements) : ces monstres frappent pendant le combat.",
      "Zone de défense (5 emplacements) : ces monstres encaissent les coups adverses.",
      "Zone d'enchantements (3 emplacements) : ces cartes renforcent tous tes monstres tant qu'elles restent en jeu.",
      "Glisse une carte de ta main vers un emplacement libre pour la poser ; glisse une carte posée vers un autre emplacement de la même zone pour la déplacer.",
      "Un seul déplacement par zone et par tour : un en attaque et un en défense, alors choisis bien (un échange de deux cartes compte pour le déplacement de sa zone).",
    ],
  },
  {
    title: 'Le combat',
    lines: [
      "Tes attaquants frappent, de gauche à droite, le défenseur adverse le plus à gauche ; celui-ci riposte aussitôt.",
      "Un monstre dont la défense tombe à 0 est KO jusqu'à la fin du combat, puis il revient intact au combat suivant.",
      "Quand il ne reste plus aucun défenseur adverse, c'est la percée : le héros adverse perd 1 point de vie par attaquant encore debout.",
    ],
  },
  {
    title: 'Les éléments',
    lines: [
      "Chaque carte a un élément. Eau bat Feu, Feu bat Air, Air bat Terre, Terre bat Eau.",
      "Un monstre qui frappe un élément qu'il domine inflige 1 dégât de plus (« Efficace ! »).",
    ],
  },
  {
    title: 'Deux astuces',
    lines: [
      "Fusion dorée : si 2 exemplaires identiques d'un monstre sont déjà posés, glisser un 3e exemplaire dans la zone de fusion qui apparaît le transforme en monstre doré, aux statistiques doublées.",
      "Vendre : clique sur une carte posée pour l'agrandir, puis « Vendre » pour la troquer contre des pièces (elle quitte la partie définitivement).",
    ],
  },
];

function RulesModal({ onClose }: RulesModalProps) {
  return (
    <div className="rules-backdrop" onClick={onClose}>
      <div
        className="rules-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rules-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="rules-close" onClick={onClose} aria-label="Fermer">
          ×
        </button>
        <h2 className="rules-title" id="rules-title">
          Règles du jeu
        </h2>
        <div className="rules-body">
          {SECTIONS.map((section) => (
            <section className="rules-section" key={section.title}>
              <h3 className="rules-section-title">{section.title}</h3>
              <ul className="rules-list">
                {section.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

export default RulesModal;
