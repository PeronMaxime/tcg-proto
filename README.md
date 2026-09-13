# TCG Proto

Prototype jouable dans le navigateur d'un jeu de cartes 1 contre 1 façon Hearthstone. Les
règles ne sont pas définitives : le but est de tester rapidement des idées de gameplay avant
une éventuelle version physique.

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

- `src/game/rules.ts` : logique de jeu (`createInitialState`, `applyAction`). Module pur, sans
  dépendance réseau ni React — modifiable et testable indépendamment du reste.
- `src/game/cards.ts` : catalogue des cartes et composition du deck de départ.

Les tests correspondants sont dans `src/game/rules.test.ts` (`npm run test`).

## 5. Limites assumées

Ce prototype privilégie la vitesse de développement, pas la robustesse :
- les règles Firestore sont **ouvertes** (`allow read, write: if true`) : n'importe qui
  connaissant un code de room peut lire ou écrire son document ;
- la main de l'adversaire est **techniquement lisible** par quiconque inspecte le trafic
  réseau ou le `localStorage` (pas de dissimulation côté serveur) ;
- il n'y a **pas d'autorité serveur** : le client dont c'est le tour calcule et écrit l'état,
  donc pas de protection anti-triche ;
- les rooms créées **ne sont jamais supprimées** (ni sur Firestore, ni en local).

Hors scope pour ce prototype : comptes utilisateurs, matchmaking, deckbuilding, sons, version
mobile, IA adverse.
