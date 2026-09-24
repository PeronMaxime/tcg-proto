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

Le `vercel.json` du dépôt ne contient qu'une réécriture de `/admin` vers `index.html` (§4) :
il n'y a pas de routeur, le code de room vit en `sessionStorage`.

## 4. Créer et modifier les cartes (panneau `/admin`)

Les cartes ne sont plus codées en dur : elles vivent dans un **catalogue** éditable depuis
`/admin`, sans recompiler ni redéployer.

### Comment ça s'articule

- Le catalogue (`Catalog` dans `types.ts` : les cartes + le nombre d'exemplaires de chacune
  dans le deck de départ) est enregistré dans le document Firestore `catalog/current`
  (`src/net/catalogStore.ts`). Sans configuration Firebase, il vit dans le `localStorage` de la
  machine, exactement comme les rooms (§1).
- À la **création d'une partie**, le catalogue courant est **recopié dans la room**
  (`Room.catalog`). Les deux joueurs jouent donc forcément avec les mêmes cartes, et une carte
  modifiée dans l'admin **pendant** une partie ne change rien à celle-ci : elle entre en jeu à
  la partie suivante (revanche comprise).
- `src/game/defaultCatalog.ts` contient les cartes **livrées avec le code**. Elles servent de
  point de départ à l'import initial, et de repli tant qu'aucun catalogue n'a été enregistré.
  C'est aussi sur elles que portent les tests.
- Tout ce qui est lu depuis le stockage passe par `src/game/catalogSchema.ts`, qui refuse une
  carte malformée avant qu'elle n'atteigne le plateau.

### Les quatre onglets

Le panneau partage **un seul brouillon** entre ses onglets : changer d'onglet ne perd rien, et
le bouton « Enregistrer » écrit le catalogue entier d'où qu'on clique.

- **Cartes** — l'éditeur : la liste à gauche (filtrable par type, élément et rareté), le
  formulaire de la carte sélectionnée à droite, avec son aperçu en direct.
- **Récapitulatif** — tout le catalogue en un tableau (nom, coût, type, élément, attaque,
  défense, rareté, habiletés, auras, capacités, puissance). Filtres en haut, tri en cliquant
  sur un en-tête. Lecture seule.
- **Chiffres** — le nombre de cartes par élément, puis le croisement élément × rareté.
- **Puissances** — le **barème de puissance** (voir ci-dessous).

### Le barème de puissance

La puissance d'une carte est un repère d'équilibrage affiché dans l'admin : **aucune règle du
jeu ne la lit**. Elle vaut l'attaque plus la défense, plus la valeur de chaque habileté et de
chaque capacité, plus un point si la carte porte une aura.

Par défaut, toutes les habiletés valent 2 points et toutes les capacités 1. L'onglet
**Puissances** permet de peser chacune séparément — Provocation ne vaut pas Toxic, un soin ne
vaut pas une pioche. Les valeurs choisies sont enregistrées avec le catalogue
(`Catalog.powerWeights`) et remplacent le barème fixe partout où la puissance s'affiche. Une
case laissée vide garde la valeur par défaut, et un catalogue sans barème calcule exactement
comme avant cet onglet.

### Mise en place

1. Dans la console Firebase, onglet **Authentication** → *Sign-in method*, activer
   **E-mail/Mot de passe**, puis créer ton compte dans *Utilisateurs* (il n'y a pas
   d'inscription dans l'application).
2. Copier l'**UID** de ce compte.
3. Le coller dans la liste de `firestore.rules` (bloc `match /catalog/{doc}`) et **publier les
   règles**. C'est la seule vraie protection : l'écran de connexion ne fait que masquer
   l'interface.
4. Ajouter le même UID à `VITE_ADMIN_UIDS` (`.env.local`, et les variables d'environnement
   Vercel) pour que le panneau s'affiche.
5. Ouvrir `/admin`, se connecter, puis **« Importer les cartes livrées avec le jeu »** : c'est
   la migration initiale, elle écrit les cartes de `defaultCatalog.ts` dans le catalogue
   partagé. Rien n'est écrit automatiquement.

En mode local (sans Firebase), il n'y a personne à authentifier : `/admin` s'ouvre directement
et le catalogue reste dans ce navigateur.

### Illustrations

Les silhouettes des cartes sont dessinées en code (`src/scene/cardArt.ts`), indexées par
**identifiant de carte**. Une carte créée depuis l'admin n'en a donc pas : elle s'affiche avec
le seul décor de son élément, et le panneau la marque « sans illustration ».

Pour lui en donner une, demande-la-moi en citant son identifiant : j'ajoute une fonction de
dessin sous cette clé et l'illustration apparaît, sans autre changement. Tant que l'identifiant
ne change pas, l'illustration suit la carte quelles que soient ses statistiques.

## 5. Modifier les règles et les cartes

Règles v1 (marché, zones fixes, combat automatique) — voir `PLAN-tcg-proto-regles-v1.md` pour
le détail des décisions. Résumé :

- Chaque joueur a un deck de 60 cartes (48 monstres + 12 enchantements). Le plateau a 3 zones par
  joueur : **attaque** (5 cartes au plus), **défense** (5), **enchantements** (3). Chaque zone
  est une **rangée compacte** : les cartes y sont toujours serrées et centrées, sans trou, et
  une nouvelle carte s'**insère** entre deux cartes (ou à un bout), les autres s'écartant
  pour lui faire place ; une vente ou une fusion resserre la rangée (`zoneCards` dans
  `rules.ts`). Une carte posée peut être **déplacée** (action `move`) ailleurs dans la rangée de
  **sa** zone — pas d'une zone à l'autre — mais **une seule fois par zone et par tour** : au
  plus un déplacement en attaque et un en défense (`PlayerState.movesUsed`, remis à zéro par
  `beginTurn`). Les cartes décalées par un déplacement ne consomment rien.
- **Début de partie** : un **lancer de pièce** désigne le joueur qui commence (`state.starter`,
  tiré dans `createInitialState`, animé par la surcouche `.coin-flip-overlay` de `GameScreen`
  avant le premier `beginTurn`). Chaque joueur commence avec **2 pièces** en stock
  (`STARTING_COINS`), celui qui **ne commence pas** avec **2 pièces de plus**
  (`SECOND_PLAYER_BONUS_COINS`).
- **Tour** : le joueur gagne `N` pièces (`N` = le n-ième tour **de ce joueur**, les pièces se
  cumulent) → **marché** : 3 cartes du dessus du deck, achetables, à la main ; les invendus
  retournent au fond du deck (sauf les cartes **verrouillées**, voir ci-dessous) → **phase
  principale** : poser gratuitement autant de cartes que voulu → **combat automatique**. Exception : le joueur qui commence ne combat pas à son premier
  tour (`isFirstTurnOfGame` dans `rules.ts`), pour compenser l'avantage de jouer en premier.
- **Combat** (voir `PLAN-effets-triggers.md` §1bis pour le détail des décisions E13-E17) : les
  monstres de la zone d'attaque du joueur actif frappent, de gauche à droite, le monstre de la
  zone de défense adverse le plus à gauche encore debout (même « gauche » des deux côtés de
  l'écran, pas de miroir) — le défenseur ciblé **riposte** aussitôt sur l'attaquant, à hauteur
  de sa propre attaque effective ; les deux dégâts sont simultanés (un défenseur mis KO par le
  coup riposte quand même). Tant qu'il reste un attaquant **et** un défenseur debout, un
  nouveau **cycle** démarre : chaque attaquant encore debout refrappe le défenseur debout le
  plus à gauche. Un monstre mis KO par un coup ou une riposte reste sur le board (aucun dégât
  ne persiste d'un combat à l'autre, H1) mais n'attaque/n'est plus ciblé jusqu'à la fin du
  combat. Quand tous les défenseurs adverses sont tombés (ou qu'il n'y en avait aucun), c'est
  la **percée** : le héros adverse perd **1 PV par attaquant encore debout**
  (`BREAKTHROUGH_DAMAGE`), quelle que soit leur attaque. Ce n'est pas une attaque : aucune
  capacité ne se déclenche — 10 PV de départ, 0 PV = défaite immédiate, plus
  aucun effet ni coup n'est résolu ensuite. L'attaque effective d'un monstre vaut toujours au
  moins 1 ; un cycle qui n'inflige aucun dégât à personne (des deux côtés) termine le combat
  sur un **combat nul** (pas de percée, PV inchangés) — un filet de sécurité
  (`MAX_COMBAT_CYCLES`) fait de même si un combat s'éternisait.
- **Éléments** : chaque carte a un élément — feu, eau, air ou terre (`element` d'un `CardDef`) — qui fixe la couleur de sa face (`theme.elements`) et s'affiche en petit
  logo en haut à droite. Roue des forces : **eau > feu > air > terre > eau**. En mêlée, un
  monstre dont l'élément domine celui du monstre qu'il touche lui inflige **1 dégât de plus**
  (`ELEMENT_ADVANTAGE_BONUS`), sur son coup comme sur sa riposte ; le bonus s'ajoute avant le
  bouclier (qui peut donc l'absorber). Pas de bonus en percée (le héros n'a pas d'élément) ;
  l'élément d'un enchantement est purement visuel. Pendant la lecture du combat, un texte
  « Efficace ! » aux couleurs de l'élément qui frappe jaillit au-dessus du monstre qui encaisse
  un dégât augmenté (`EffectiveBurst.tsx`).
- **Rareté** : chaque carte porte une rareté — commune, peu commune, rare ou légendaire
  (`rarity` d'un `CardDef`, `CardRarity` dans `types.ts`). Elle n'entre dans **aucune règle**
  (ni prix, ni tirage, ni combat) : c'est un repère de valeur, affiché sur la face par une
  **gemme** taillée, posée en bas au centre de la carte, et par le **cadre de l'illustration**,
  de plus en plus travaillé à mesure que la rareté monte — commune : le filet d'or d'origine ;
  peu commune : un liseré intérieur vert ; rare : un cadre métallique bleu clouté aux quatre
  coins ; légendaire : un cadre d'or épais qui rayonne, doublé de deux filets et serti de
  gemmes (`drawArtBorder` et `theme.rarities`). Le bandeau de type n'en porte pas le nom. Elle se
  choisit carte par carte dans le panneau `/admin` (§4), qui permet aussi de filtrer la liste
  par rareté. Une carte enregistrée avant cette fonctionnalité (catalogue figé dans une room
  plus ancienne) n'en a pas : tout l'affichage passe par `cardRarity()` (`game/cards.ts`),
  qui la range alors en commune.
- Les enchantements posés appliquent un effet permanent à **tout le board de leur
  propriétaire** (`getMonsterStats` dans `rules.ts`) tant qu'ils restent en jeu.
- **Capacités** (voir `PLAN-effets-triggers.md` pour le détail des décisions E1-E12) : certaines
  cartes ont une ou plusieurs capacités = un déclencheur (`Trigger` dans `types.ts`) → un effet
  (`AbilityEffect`), résolu immédiatement et sans chaîne (aucun effet de la v1 ne pose, ne vend
  ni ne met KO une carte). Déclencheurs : `summon` (la carte rejoint le board, action `place`),
  `combatStart` (« Début du combat » : une fois par combat, avant le premier coup, pour chaque
  monstre qui y participe — attaquants de gauche à droite puis défenseurs ; rien si l'attaquant
  n'a aucun monstre en attaque),
  `attack` (elle attaque, à chaque coup porté en mêlée — pas en percée), `defend` (elle est ciblée par une attaque, à
  chaque coup reçu), `ko` (sa défense tombe à 0 pendant un combat, une seule fois par combat),
  `sold` (elle est vendue, action `sell`). Dans un même échange, l'ordre est : Attaque de
  l'attaquant → Défend du défenseur ciblé → dégâts simultanés → KO du défenseur puis KO de
  l'attaquant s'ils viennent de tomber. Une capacité marquée `oncePerCombat` (affichée
  « (1×/combat) » sur la carte) ne se déclenche qu'au premier coup éligible de chaque combat :
  c'est le cas du buff Attaque du Chevalier et des dégâts Défend du Golem. Effets disponibles : gain de pièces, dégâts ou soin
  (plafonné à 10 PV) sur un héros, pioche, buff permanent (sur soi ou sur les autres monstres du
  même propriétaire, cumulable, perdu si la carte quitte le board), bonus de dégâts (Attaque
  seulement) et bouclier (Défend seulement, peut absorber un coup entièrement). Pour ajouter une
  capacité à une carte, l'ajouter dans le panneau `/admin` (§4) ;
  `isAbilityAllowed` vérifie qu'elle respecte les règles (bonus/bouclier sur le bon
  déclencheur, pas de déclencheur de combat — Début du combat compris — sur un enchantement, valeurs ≥ 1),
  aussi bien à l'enregistrement depuis `/admin` qu'à la lecture du catalogue. Un joueur voit un
  petit toast pour chaque capacité déclenchée (les siennes et celles de l'adversaire).
- **Habiletés** (mots-clés, `Keyword` dans `types.ts`) : contrairement à une capacité, une
  habileté n'a pas de déclencheur — c'est une règle permanente portée par certains monstres,
  affichée en tête de leur face (« Portée : … »). Les six habiletés actuelles :
  - **Portée** : chaque coup porté touche aussi les monstres **voisins** de la cible dans sa
    rangée, pour 1 dégât (+1 si le monstre est doré, +1 de plus si son élément domine celui
    du voisin touché). Ces dégâts collatéraux ne provoquent pas de riposte, mais cassent une
    Protection (Archère, Harponneuse).
  - **Provocation** : tant qu'il est debout, ce défenseur est visé **avant** tous les autres,
    même s'il n'est pas le plus à gauche (Garde du pont, Sentinelle d'acier). Un **bouclier**
    d'acier et d'or flotte sur le monstre tant qu'il tient debout (`tauntShield` dans
    `Card.tsx`).
  - **Protection** : les **premiers dégâts** reçus pendant un combat sont annulés — coup subi
    en défense, riposte subie en attaquant, mais aussi dégâts collatéraux de Portée ou de
    Furie, qui cassent la protection comme le reste. Elle se recharge au combat suivant
    (Golem de pierre, Sentinelle d'acier). Une **bulle** d'énergie cyan enveloppe le monstre
    tant que sa protection est intacte et éclate au coup exact qui la consomme
    (`protectionBubble` dans `Card.tsx`, alimenté par `protectionSpent` du curseur de
    lecture). Les deux marques se superposent sur un monstre qui a les deux habiletés.
  - **Négociant** : rapporte **1 pièce de plus** à la vente, soit 2 (4 si la carte est dorée)
    (Colporteur, Gardien des reliques).
  - **Furie** : quand son coup tue un défenseur, les dégâts **en excès** ne sont plus perdus
    (H2) mais reportés sur le défenseur suivant — une seule fois, et sans riposte (Drake,
    Berserker).
  - **Toxic** : quel que soit le nombre de dégâts infligés, il **tue** le monstre qu'il touche
    (coup comme riposte), sauf si une Protection a absorbé le coup (Araignée venimeuse, Guêpe
    tueuse).

  Pour donner une habileté à une carte, ajouter son mot-clé à `keywords` dans `CARD_CATALOG`
  (`src/game/cards.ts`) ; les valeurs chiffrées sont les constantes `KEYWORD_*` du même
  fichier, les règles vivent dans `resolveCombat` / `sellValue` (`src/game/rules.ts`).
- **Poser une carte** : glisser-déposer une carte de sa main dans la rangée de la bonne zone
  (les rangées légales s'allument pendant le glisser) ; les cartes posées s'écartent pour
  montrer où elle s'insérera — entre deux cartes, ou à un bout.
- **Déplacer une carte posée** : la glisser ailleurs dans la rangée de sa zone (attaque ou
  défense, jamais de changement de zone) ; elle s'insère entre deux cartes et les autres se
  décalent — on peut donc réorganiser une zone pleine.
- **Fusion dorée** : quand on fait glisser une carte monstre alors que 2 exemplaires
  normaux (non dorés) du même monstre sont posés sur son board (attaque + défense
  confondues), une zone de fusion apparaît au milieu de l'écran. Relâcher la carte dedans
  renvoie les 2 exemplaires posés au fond du deck et transforme la carte en **monstre doré**, qui
  reste en main et se repose ensuite comme une autre carte — la fusion marche donc même
  avec un board plein. Tant que la fusion est possible, cette 3e carte ne peut **pas** être
  posée : relâchée ailleurs que dans la zone de fusion, elle revient en
  main. Un monstre doré a son attaque et sa défense de base doublées (les
  bonus d'enchantement s'ajoutent ensuite, sans être doublés) et ne fusionne plus (action
  `fuse` dans `rules.ts`).
- **Marché** : seul le joueur actif voit ses cartes ; l'adversaire les voit face cachée. Deux
  options payantes pendant toute la phase principale (demande utilisateur) :
  - **Relancer** (bouton HUD « Relancer », action `rerollMarket`, `MARKET_REROLL_COST` = 1
    pièce) : les cartes **non verrouillées** retournent au fond du deck dans l'ordre du marché
    (H5) et le marché est complété depuis le dessus du deck jusqu'à `MARKET_SIZE` cartes
    (verrouillées comprises), **même après un achat** : les nouvelles prennent la place exacte
    des refusées, puis comblent les places libérées par les achats. Répétable tant que le
    joueur paie — c'est le prix, pas un quota, qui limite les relances. Refusée quand elle ne
    changerait rien (marché plein et entièrement verrouillé, deck vide) : on ne fait pas payer
    une relance sans effet.
  - **Verrouiller** (cadenas au coin haut gauche d'une carte de son marché, action
    `toggleMarketLock`, `MARKET_LOCK_COST` = 1 pièce) : la carte échappe aux relances **et** au
    retour au deck en fin de tour (`PlayerState.lockedUids`), donc elle **ouvre le marché du
    prochain tour**, complété ensuite depuis le deck jusqu'à `MARKET_SIZE`. `beginTurn` vide
    `lockedUids` : garder la même carte un tour de plus se repaie. Déverrouiller est gratuit
    mais **ne rembourse pas** (sinon on verrouillerait « pour voir ») ; acheter une carte
    verrouillée libère simplement son verrou.
- **Vendre une carte posée** (clic sur la carte → zoom → bouton « Vendre ») la retire
  du board et la renvoie au fond du deck (il n'y a plus de défausse ; une carte dorée y
  redevient normale) et rapporte
  1 pièce, 3 si la carte est dorée, +1 si elle est Négociante (`sellValue` dans `rules.ts`).

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
- `src/game/cards.ts` : accès au **catalogue actif** (`getCardDef`, `setActiveCatalog`) et
  textes des cartes. Les cartes elles-mêmes s'éditent depuis `/admin` (§4) ; `cards.ts` ne les
  contient plus.
- `src/game/defaultCatalog.ts` : les cartes livrées avec le code, base de l'import initial et
  repli quand aucun catalogue n'est enregistré. C'est ici qu'on modifie une carte « en dur »,
  par exemple pour changer ce que verront les nouveaux projets.
- `src/game/catalogSchema.ts` : ce qu'est un catalogue valide, partagé par l'admin et par la
  lecture du stockage.

Les tests correspondants sont dans `src/game/rules.test.ts` et
`src/scene/combatPlayback.test.ts` (`npm run test`).

## 6. Limites assumées

Ce prototype privilégie la vitesse de développement, pas la robustesse :
- les règles Firestore des **rooms** sont **ouvertes** (`allow read, write: if true`) :
  n'importe qui connaissant un code de room peut lire ou écrire son document. Seul le
  catalogue de cartes est protégé en écriture (§4) ;
- le marché adverse et la main adverse sont affichés face cachée, mais restent
  **techniquement lisibles** par quiconque inspecte le trafic réseau ou
  le `localStorage` (pas de dissimulation côté serveur) ;
- il n'y a **pas d'autorité serveur** : le client dont c'est le tour calcule et écrit l'état,
  donc pas de protection anti-triche ;
- les rooms créées **ne sont jamais supprimées** (ni sur Firestore, ni en local).

Hors scope pour ce prototype : comptes utilisateurs, matchmaking, deckbuilding, sons, version
mobile, IA adverse.
