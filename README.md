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
- **Combat** : les monstres de la zone d'attaque du joueur actif frappent, de gauche à droite,
  le monstre de la zone de défense adverse le plus à gauche encore debout (même « gauche »
  des deux côtés de l'écran, pas de miroir) ; sans défenseur, l'attaque touche directement les
  PV (20 PV de départ, 0 PV = défaite).
- Les enchantements posés appliquent un effet permanent à **tout le board de leur
  propriétaire** (`getMonsterStats` dans `rules.ts`) tant qu'ils restent en jeu.
- **Vendre une carte posée** (clic sur la carte → zoom → bouton « Vendre ») la retire
  définitivement du board vers une pile de défausse (jamais remélangée au deck) et rapporte
  1 pièce (action `sell` dans `rules.ts`).

Plusieurs points sont des **hypothèses par défaut**, marquées `// Hn` dans le code (H1 à H10 —
voir le plan) : entre autres, aucun dégât ne persiste sur un monstre d'un combat à l'autre
(défense pleinement régénérée), les dégâts excédentaires sont perdus, le défenseur ne riposte
jamais. Un risque connu : deux défenses assez solides peuvent bloquer la partie indéfiniment
(backlog, non traité).

- `src/game/rules.ts` : logique de jeu (`createInitialState`, `applyAction`, `resolveCombat`).
  Module pur, sans dépendance réseau ni React — modifiable et testable indépendamment du reste.
- `src/game/cards.ts` : catalogue des cartes (`CARD_CATALOG`) et composition du deck de départ
  (`STARTER_COUNTS`) — c'est le seul endroit à modifier pour changer une carte ou un deck.

Les tests correspondants sont dans `src/game/rules.test.ts` et
`src/scene/combatPlayback.test.ts` (`npm run test`).

## 5. Limites assumées

Ce prototype privilégie la vitesse de développement, pas la robustesse :
- les règles Firestore sont **ouvertes** (`allow read, write: if true`) : n'importe qui
  connaissant un code de room peut lire ou écrire son document ;
- le marché est volontairement visible des deux joueurs (H4) ; la main adverse et le marché
  restent de toute façon **techniquement lisibles** par quiconque inspecte le trafic réseau ou
  le `localStorage` (pas de dissimulation côté serveur) ;
- il n'y a **pas d'autorité serveur** : le client dont c'est le tour calcule et écrit l'état,
  donc pas de protection anti-triche ;
- les rooms créées **ne sont jamais supprimées** (ni sur Firestore, ni en local).

Hors scope pour ce prototype : comptes utilisateurs, matchmaking, deckbuilding, sons, version
mobile, IA adverse.
