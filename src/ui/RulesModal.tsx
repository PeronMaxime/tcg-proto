// Règles du jeu pour les débutants (demande utilisateur) : une popin volontairement courte,
// qui explique le déroulé d'un tour et les quelques notions à connaître, sans reprendre le
// détail de `rules.ts` (README §4 pour la version complète). Même comportement que les autres
// popins du jeu (fond cliquable, croix, Échap géré par le HUD).

interface RulesModalProps {
  // Nombre maximal de cartes par zone de monstres dans la partie en cours (variante choisie
  // dans le menu).
  monsterZoneSize: number;
  // Partie en V2 (modifsV2.md) : les éléments n'ont plus d'avantage, et la V2 a ses propres
  // notions (armure, états, cibles à choisir, Vol).
  v2?: boolean;
  onClose: () => void;
}

interface RulesSection {
  title: string;
  lines: string[];
}

// Sections propres à la V2, à la place de celle des éléments de la V1.
const V2_SECTIONS: RulesSection[] = [
  {
    title: 'Les éléments (V2)',
    lines: [
      "Chaque élément a son style de jeu : le Feu inflige beaucoup de dégâts, l'Air contrôle le board en déplaçant les monstres, l'Eau soigne et protège, la Terre renforce et blinde ses monstres. Les cartes Neutres n'ont pas d'élément : leurs effets génériques servent tous les styles de jeu.",
      "Plus aucun élément n'en bat un autre : il n'y a plus de dégât bonus selon l'élément.",
    ],
  },
  {
    title: 'Armure et états (V2)',
    lines: [
      "Armure (écusson gris) : elle encaisse les dégâts avant la défense, et ce qu'elle a encaissé est perdu pour de bon. Percée l'ignore.",
      "Gelé : le monstre, couché, ne participe pas à son prochain combat, puis se relève à la fin de celui-ci.",
      "Brûlé (flamme) : à la fin de chaque combat qu'il dispute, le monstre perd pour de bon 1 défense par brûlure reçue (elles se cumulent) ; à 0, il retourne sous le deck. Une carte d'eau peut éteindre la brûlure (la défense perdue ne revient pas).",
      "Silence (bulle barrée) : les capacités du monstre ne se déclenchent plus jusqu'à la fin de son prochain combat ; ses habiletés restent actives.",
      "Enraciné (racines) : le monstre ne peut plus changer de zone ni de place, ni par un effet ni par son joueur, jusqu'au prochain tour de celui qui l'a enraciné.",
      "Certaines capacités te demandent de choisir une cible : clique sur un monstre allumé, ou « Renoncer ».",
      "Un monstre qui a Vol peut changer de zone pendant ta phase principale (il compte comme le déplacement de sa zone de départ).",
    ],
  },
];

function sections(monsterZoneSize: number, v2 = false): RulesSection[] {
  const all: RulesSection[] = [
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
      "Le marché ne te plaît pas ? « Relancer » te propose 3 nouvelles cartes pour 1 pièce (même si tu en as déjà acheté), autant de fois que tu peux payer.",
      "Le cadenas en haut à gauche d'une carte du marché la garde pour ton prochain marché, pour 1 pièce : elle échappe aux relances et ne retourne pas dans le deck en fin de tour (le déverrouiller est gratuit, mais ne rembourse pas).",
      "3. Pose autant de cartes que tu veux depuis ta main : poser ne coûte rien.",
      "4. Clique sur « Combat ! » : les monstres s'affrontent tout seuls, puis c'est au tour de l'adversaire.",
    ],
  },
  {
    title: 'Le plateau',
    lines: [
      `Zone d'attaque (${monsterZoneSize} cartes au plus) : ces monstres frappent pendant le combat.`,
      `Zone de défense (${monsterZoneSize} cartes au plus) : ces monstres encaissent les coups adverses.`,
      "Zone d'enchantements (3 cartes au plus) : ces cartes renforcent tous tes monstres tant qu'elles restent en jeu.",
      "Glisse une carte de ta main dans une zone pour la poser : les cartes s'écartent pour te montrer où elle s'insérera, entre deux cartes ou à un bout. Glisse une carte posée ailleurs dans sa zone pour la déplacer.",
      "Un seul déplacement par zone et par tour : un en attaque et un en défense, alors choisis bien (les cartes décalées par un déplacement ne comptent pas).",
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
      "Fusion dorée : avec 3 exemplaires identiques d'un monstre ou d'un enchantement (posés ou en main), glisse celui de ta main dans la zone de fusion qui apparaît sur le board adverse : il devient doré, aux valeurs doublées.",
      "Vendre : glisse une carte de ta main (ou une carte posée que tu déplaces) sur ton deck, ou ouvre-la en grand puis « Vendre », pour la troquer contre des pièces (elle retourne au fond du deck).",
    ],
  },
  ];
  if (!v2) return all;
  // V2 : la section des éléments de la V1 laisse place à celles de la V2.
  return [...all.filter((section) => section.title !== 'Les éléments'), ...V2_SECTIONS];
}

function RulesModal({ monsterZoneSize, v2 = false, onClose }: RulesModalProps) {
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
          {sections(monsterZoneSize, v2).map((section) => (
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
