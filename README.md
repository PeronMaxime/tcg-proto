# TCG Proto

Prototype jouable dans le navigateur d'un jeu de cartes 1 contre 1. Les règles ne sont pas
définitives : le but est de tester rapidement des idées de gameplay avant une éventuelle
version physique.

## 1. Lancer en local

```
npm install
npm run dev
```

Ouvre l'URL affichée (`http://localhost:5173` par défaut) dans **deux onglets séparés** — pas
« Dupliquer l'onglet » — pour jouer les deux joueurs sur la même machine :
- onglet 1 : « Créer une partie », note ou copie le code ;
- onglet 2 : colle le code dans « Rejoindre ».

Sans configuration Firebase (voir §2), l'app tourne en **mode local** : la synchro passe par
`localStorage`, ce qui suffit pour tester à deux onglets. Un badge « Mode local » l'indique
dans le menu.

> « Dupliquer l'onglet » copie le `sessionStorage`, donc l'identité du joueur : les deux
> onglets seraient vus comme le même joueur. Ouvre toujours un **nouvel** onglet et colle
> l'URL à la main.

## 2. Configurer Firebase (optionnel)

Sans cette étape, l'app fonctionne déjà en mode local (§1). Pour jouer entre deux navigateurs
différents (donc deux machines), il faut Firestore :

1. Créer un projet sur [console.firebase.google.com](https://console.firebase.google.com/).
2. Ajouter une application Web au projet, copier sa configuration.
3. Créer un fichier `.env.local` à partir de `.env.example` et y coller les 4 valeurs
   `VITE_FIREBASE_*`.
4. Activer Firestore (mode production ou test, peu importe : les règles ci-dessous sont de
   toute façon ouvertes).
5. Dans la console Firebase, onglet **Règles** de Firestore, coller le contenu de
   `firestore.rules` puis publier.

Le mode Firebase s'active automatiquement dès que `VITE_FIREBASE_PROJECT_ID` est renseignée.

## 3. Déployer sur Vercel

1. Importer le dépôt dans Vercel : le preset Vite est détecté automatiquement.
2. Dans *Settings → Environment Variables*, ajouter les 4 variables `VITE_FIREBASE_*` (si le
   mode Firebase est utilisé) puis redéployer.

Aucun `vercel.json` n'est nécessaire : il n'y a pas de routeur (une seule page, le code de
room vit en `sessionStorage`).

## 4. Modifier les règles et les cartes

Règles v1 (marché, zones fixes, combat automatique) — voir `PLAN-tcg-proto-regles-v1.md` pour
le détail des décisions. Résumé :

- Chaque joueur a un deck de 50 cartes (monstres + enchantements). Le plateau a 3 zones par
  joueur : **attaque** (5 emplacements), **défense** (5), **enchantements** (3). Une carte
  posée ne bouge plus.
- **Tour** : le joueur gagne `N` pièces (`N` = le n-ième tour **de ce joueur**, les pièces se
  cumulent) → **marché** : 3 cartes du dessus du deck, achetables, à la main ; les invendus
  retournent au fond du deck → **phase principale** : poser gratuitement autant de cartes que
  voulu → **combat automatique**.
- **Combat** (voir `PLAN-effets-triggers.md` §1bis pour le détail des décisions E13-E17) : les
  monstres de la zone d'attaque du joueur actif frappent, de gauche à droite, le monstre de la
  zone de défense adverse le plus à gauche encore debout (même « gauche » des deux côtés de
  l'écran, pas de miroir) — le défenseur ciblé **riposte** aussitôt sur l'attaquant, à hauteur
  de sa propre attaque effective ; les deux dégâts sont simultanés (un défenseur mis KO par le
  coup riposte quand même). Tant qu'il reste un attaquant **et** un défenseur debout, un
  nouveau **cycle** démarre : chaque attaquant encore debout refrappe le défenseur debout le
  plus à gauche. Un monstre mis KO par un coup ou une riposte reste sur le board (aucun dégât
  ne persiste d'un combat à l'autre, H1) mais n'attaque/n'est plus ciblé jusqu'à la fin du
  combat. Quand tous les défenseurs adverses sont tombés (ou qu'il n'y en avait aucun), chaque
  attaquant encore debout **perce** jusqu'au héros adverse, une fois chacun (y compris ceux qui
  avaient déjà frappé dans le cycle en cours) — 20 PV de départ, 0 PV = défaite immédiate, plus
  aucun effet ni coup n'est résolu ensuite. L'attaque effective d'un monstre vaut toujours au
  moins 1 ; un cycle qui n'inflige aucun dégât à personne (des deux côtés) termine le combat
  sur un **combat nul** (pas de percée, PV inchangés) — un filet de sécurité
  (`MAX_COMBAT_CYCLES`) fait de même si un combat s'éternisait.
- **Éléments** : chaque carte a un élément — feu, eau, air ou terre (`element` dans
  `CARD_CATALOG`) — qui fixe la couleur de sa face (`theme.elements`) et s'affiche en petit
  logo en haut à droite. Roue des forces : **eau > feu > air > terre > eau**. En mêlée, un
  monstre dont l'élément domine celui du monstre qu'il touche lui inflige **1 dégât de plus**
  (`ELEMENT_ADVANTAGE_BONUS`), sur son coup comme sur sa riposte ; le bonus s'ajoute avant le
  bouclier (qui peut donc l'absorber). Pas de bonus en percée (le héros n'a pas d'élément) ;
  l'élément d'un enchantement est purement visuel.
- Les enchantements posés appliquent un effet permanent à **tout le board de leur
  propriétaire** (`getMonsterStats` dans `rules.ts`) tant qu'ils restent en jeu.
- **Capacités** (voir `PLAN-effets-triggers.md` pour le détail des décisions E1-E12) : certaines
  cartes ont une ou plusieurs capacités = un déclencheur (`Trigger` dans `types.ts`) → un effet
  (`AbilityEffect`), résolu immédiatement et sans chaîne (aucun effet de la v1 ne pose, ne vend
  ni ne met KO une carte). Déclencheurs : `summon` (la carte rejoint le board, action `place`),
  `attack` (elle attaque, à chaque coup porté), `defend` (elle est ciblée par une attaque, à
  chaque coup reçu), `ko` (sa défense tombe à 0 pendant un combat, une seule fois par combat),
  `sold` (elle est vendue, action `sell`). Dans un même échange, l'ordre est : Attaque de
  l'attaquant → Défend du défenseur ciblé → dégâts simultanés → KO du défenseur puis KO de
  l'attaquant s'ils viennent de tomber. Effets disponibles : gain de pièces, dégâts ou soin
  (plafonné à 20 PV) sur un héros, pioche, buff permanent (sur soi ou sur les autres monstres du
  même propriétaire, cumulable, perdu si la carte quitte le board), bonus de dégâts (Attaque
  seulement) et bouclier (Défend seulement, peut absorber un coup entièrement). Pour ajouter une
  capacité à une carte, éditer son `abilities` dans `CARD_CATALOG` (`src/game/cards.ts`) ;
  `isAbilityAllowed` vérifie qu'elle respecte les règles (bonus/bouclier sur le bon
  déclencheur, pas de déclencheur de combat sur un enchantement, valeurs ≥ 1). Un joueur voit un
  petit toast pour chaque capacité déclenchée (les siennes et celles de l'adversaire).
- **Poser une carte** : glisser-déposer une carte de sa main sur un emplacement libre de la
  bonne zone (les emplacements légaux s'allument pendant le glisser).
- **Fusion dorée** : quand on fait glisser une carte monstre alors que 2 exemplaires
  normaux (non dorés) du même monstre sont posés sur son board (attaque + défense
  confondues), une zone de fusion apparaît au milieu de l'écran. Relâcher la carte dedans
  envoie les 2 exemplaires posés en défausse et transforme la carte en **monstre doré**, qui
  reste en main et se repose ensuite comme une autre carte — la fusion marche donc même
  avec un board plein. Tant que la fusion est possible, cette 3e carte ne peut **pas** être
  posée sur un emplacement : relâchée ailleurs que dans la zone de fusion, elle revient en
  main. Un monstre doré a son attaque et sa défense de base doublées (les
  bonus d'enchantement s'ajoutent ensuite, sans être doublés) et ne fusionne plus (action
  `fuse` dans `rules.ts`).
- **Marché** : seul le joueur actif voit ses cartes ; l'adversaire les voit face cachée.
- **Vendre une carte posée** (clic sur la carte → zoom → bouton « Vendre ») la retire
  définitivement du board vers une pile de défausse (jamais remélangée au deck) et rapporte
  1 pièce (action `sell` dans `rules.ts`).

Plusieurs points sont des **hypothèses par défaut**, marquées `// Hn` (H1 à H12,
`PLAN-tcg-proto-regles-v1.md`) puis `// En` (E1 à E17, `PLAN-effets-triggers.md`) dans le code :
entre autres, aucun dégât ne persiste sur un monstre d'un combat à l'autre (défense pleinement
régénérée), les dégâts excédentaires sont perdus. H8 (« le défenseur ne riposte jamais ») a été
remplacée par E13 (riposte systématique). Un risque connu : deux camps qui ne peuvent plus
s'infliger de dégâts (combat nul répété) peuvent bloquer la partie indéfiniment (backlog, non
traité).

- `src/game/rules.ts` : logique de jeu (`createInitialState`, `applyAction`, `resolveCombat`,
  moteur des capacités déclenchées `fireTrigger`). Module pur, sans dépendance réseau ni React —
  modifiable et testable indépendamment du reste.
- `src/game/cards.ts` : catalogue des cartes (`CARD_CATALOG`, avec leurs `abilities`) et
  composition du deck de départ (`STARTER_COUNTS`) — c'est le seul endroit à modifier pour
  changer une carte, sa capacité ou un deck.

Les tests correspondants sont dans `src/game/rules.test.ts` et
`src/scene/combatPlayback.test.ts` (`npm run test`).

## 5. Limites assumées

Ce prototype privilégie la vitesse de développement, pas la robustesse :
- les règles Firestore sont **ouvertes** (`allow read, write: if true`) : n'importe qui
  connaissant un code de room peut lire ou écrire son document ;
- le marché adverse et la main adverse sont affichés face cachée, mais restent
  **techniquement lisibles** par quiconque inspecte le trafic réseau ou
  le `localStorage` (pas de dissimulation côté serveur) ;
- il n'y a **pas d'autorité serveur** : le client dont c'est le tour calcule et écrit l'état,
  donc pas de protection anti-triche ;
- les rooms créées **ne sont jamais supprimées** (ni sur Firestore, ni en local).

Hors scope pour ce prototype : comptes utilisateurs, matchmaking, deckbuilding, sons, version
mobile, IA adverse.
