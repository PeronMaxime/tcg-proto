# Plan — Effets de cartes, déclencheurs (triggers) et combat en cycles avec riposte

Plan destiné à un agent IA chargé de l'implémentation. Il est autoportant : lis-le en
entier avant de commencer, puis suis les étapes du §9 dans l'ordre (chaque étape laisse le
projet compilable et les tests verts).

**Toutes les décisions de règles (E1–E17) ont été validées par l'utilisateur** : ne pas
les remettre en question, les implémenter telles quelles.

## 0. Contexte et objectif

Prototype de jeu de cartes 1v1 (React + react-three-fiber, Vite, Vitest, sync Firestore ou
`localStorage`). Toute la logique de jeu est dans un module **pur** :

- `src/game/types.ts` — types de l'état, des actions et des évènements.
- `src/game/cards.ts` — catalogue `CARD_CATALOG`, deck de départ, textes générés
  (`describeEffect`).
- `src/game/rules.ts` — `isActionLegal`, `applyAction`, `resolveCombat`, `getMonsterStats`.
- `src/game/rules.test.ts` — tests des règles (`npm run test`).

Côté affichage :

- `src/scene/textures.ts` — dessin Canvas 2D des faces de cartes (aussi utilisé pour le zoom).
- `src/scene/cardFaceStats.ts` — stats affichées d'un monstre posé.
- `src/scene/combatPlayback.ts` (+ test) et `src/ui/useCombatPlayback.ts` — lecture animée
  du combat, identique sur les deux clients à partir de `state.lastEvent`.
- `src/scene/Board.tsx`, `src/scene/Card.tsx`, `src/scene/Hero.tsx`, `src/ui/GameScreen.tsx`.

Le travail comporte **deux volets** :

1. **Refonte du combat** (§1bis) : les attaquants reçoivent des dégâts en retour (riposte du
   défenseur ciblé) et le combat se joue en **cycles** jusqu'à ce qu'un camp n'ait plus de
   monstre debout. Remplace H8 (« le défenseur ne riposte jamais »).
2. **Capacités** : certaines cartes ont des capacités = (déclencheur → effet).

| Id code   | Libellé affiché | Quand                                                              |
|-----------|-----------------|--------------------------------------------------------------------|
| `summon`  | Invoqué         | la carte est posée sur le board (action `place`)                   |
| `combatStart` | Début du combat | ajout ultérieur : une fois au début de chaque combat où la carte combat, avant le premier coup (attaquants puis défenseurs, gauche à droite ; rien si aucun attaquant) |
| `attack`  | Attaque         | la carte (monstre en zone d'attaque) attaque pendant le combat — à **chaque** attaque |
| `defend`  | Défend          | la carte (monstre en zone de défense) est ciblée par une attaque — à **chaque** coup reçu |
| `ko`      | KO              | la défense de la carte tombe à 0 pendant un combat (attaquant **ou** défenseur) |
| `sold`    | Vendu           | la carte est vendue (action `sell`)                                |

Plus un **batch de cartes de test** (§5) couvrant chaque déclencheur et chaque effet.

### Conventions du dépôt à respecter

- Identifiants de code en anglais, **commentaires et textes UI en français**, même densité
  de commentaires que l'existant.
- `rules.ts` reste pur : pas de `Date.now()`, pas de `Math.random()`, pas de React.
- Les hypothèses de règles sont marquées `// Hn` dans le code. Les nouvelles hypothèses de ce
  plan sont numérotées **`E1`…`E17`** (§1, §1bis) et doivent apparaître en commentaire
  `// En` à l'endroit du code qui les implémente. Les commentaires qui citent **H8** doivent
  être mis à jour (« H8 remplacée par E13 »).
- **Jamais de `undefined` explicite dans l'état** (Firestore) : un champ optionnel est
  *absent*, comme `golden?: true` sur `CardInstance`.
- Le format de l'état change → incrémenter `RULES_VERSION` (4 → 5). `RoomScreen` refuse déjà
  les rooms d'une autre version (T7).

## 1. Décisions de règles — capacités (E1–E12)

- **E1 — Résolution immédiate, sans chaîne.** Un effet se résout dès que son déclencheur
  survient. Aucun effet de la v1 ne pose, vend ou met KO une carte, donc un effet ne peut
  jamais en déclencher un autre. Pas de pile, pas de réponse.
- **E2 — Ordre.** Si une carte a plusieurs capacités sur le même déclencheur, elles se
  résolvent dans l'ordre du tableau `abilities`.
- **E3 — Invoqué** se déclenche après que la carte a été écrite dans son emplacement (elle
  fait donc partie du board ; les effets « tes autres monstres » l'excluent explicitement).
  Il concerne monstres **et** enchantements. La fusion (`fuse`) ne déclenche rien : la carte
  dorée reste en main et déclenchera Invoqué quand elle sera posée.
- **E4 — Vendu** se déclenche après que la carte a quitté le board, que la pièce de vente a
  été versée et que la carte est en défausse. Concerne monstres et enchantements.
- **E5 — Déroulé d'un échange** (un attaquant frappe un défenseur, voir §1bis) :
  1. Attaque de l'attaquant ;
  2. Défend du défenseur ciblé ;
  3. dégâts **simultanés** : coup de l'attaquant sur le défenseur **et** riposte du
     défenseur sur l'attaquant (E13) ;
  4. KO du défenseur s'il vient de tomber, puis KO de l'attaquant s'il vient de tomber.
  Pour un coup de percée sur le héros (E15) : Attaque, puis dégâts au héros.
- **E6 — Attaquants et défenseurs peuvent être KO.** Le KO reste temporaire (H1) : la carte
  reste sur le board et se relève en fin de combat. Un monstre KO n'attaque plus et n'est
  plus ciblé jusqu'à la fin du combat, donc son KO ne se déclenche qu'une fois par combat.
- **E7 — Victoire hors combat et pendant le combat.** Tout dégât au héros (effet ou coup)
  passe par une seule fonction ; le premier héros à 0 PV perd **immédiatement** : on fixe
  `winner`, on arrête de résoudre quoi que ce soit (effets restants, coups restants). Cela
  vaut aussi pour `place`/`sell` (ex. Invoqué qui inflige des dégâts). Généralise H9. Si
  le vainqueur est connu avant l'étape 3 d'un échange, l'échange est quand même enregistré
  avec `damage: 0`, `retaliation: 0` et les défenses inchangées (pour que l'animation montre
  l'effet qui a tué).
- **E8 — Soins plafonnés** à `STARTING_HP` (20).
- **E9 — Buffs permanents** : stockés sur l'instance (`CardInstance.buff`), cumulables, ils
  s'ajoutent à la base (dorée ou non) comme les bonus d'enchantement. Ils disparaissent si la
  carte quitte le board (vente, fusion). Un buff de défense reçu pendant un combat augmente
  aussi la défense restante d'un monstre encore debout (on suit les **dégâts subis**, pas la
  défense restante — voir §3.5).
- **E10 — Monstres dorés** : les valeurs des effets **ne sont pas** doublées en v1 (seules
  les stats de base le sont). Centraliser dans une fonction pour pouvoir changer d'avis.
- **E11 — Pioche** : `drawCard` prend la carte du dessus du deck (fin du tableau) vers la
  main ; deck vide → rien (pas de pénalité). Pas de limite de main (comme aujourd'hui).
- **E12 — Modificateurs de coup.** `bonusDamage` n'existe que sur Attaque (s'ajoute aux
  dégâts du coup de l'attaquant, contre un monstre comme contre le héros ; pas à la
  riposte). `shield` n'existe que sur Défend (réduit les dégâts du coup reçu par le
  défenseur, minimum 0 : un coup peut être entièrement absorbé ; ne touche pas la riposte). Hors de ces
  déclencheurs ils sont interdits (vérifié par un test du catalogue, §7).

## 1bis. Décisions de règles — combat en cycles avec riposte (E13–E17)

Règle demandée : les attaquants reçoivent des dégâts en retour mais continuent d'attaquer
chacun leur tour ; quand tous les attaquants ont attaqué une fois, ceux encore debout
repartent pour un nouveau cycle, jusqu'à ce que tous les attaquants soient KO ou que tous
les défenseurs soient KO.

- **E13 — Riposte.** À chaque échange, le défenseur ciblé inflige à l'attaquant son
  **attaque effective** (`getMonsterStats(…, 'defense').attack` : base + buff + bonus
  d'enchantement applicables à la zone de défense). Les deux dégâts sont simultanés : un
  défenseur mis KO par le coup riposte quand même. Les dégâts s'imputent sur la **défense**
  de l'attaquant ; à 0, il est KO. Excédent perdu (comme H2). Pas de riposte en percée (le
  héros n'a pas d'attaque).
- **E14 — Mêlée en cycles.** Tant qu'il reste au moins un attaquant debout **et** au moins
  un défenseur debout : un cycle = chaque attaquant **debout**, de gauche à droite, frappe le
  défenseur debout le plus à gauche (R4). Un attaquant mis KO pendant un cycle n'attaque plus
  (ni dans ce cycle s'il n'était pas encore passé, ni dans les suivants). Si le dernier
  défenseur tombe en cours de cycle, la mêlée s'arrête **immédiatement** (les attaquants
  suivants du cycle ne frappent pas en mêlée). Les dégâts subis s'accumulent d'un cycle à
  l'autre et sont tous effacés en fin de combat (H1 inchangée).
- **E15 — Percée.** Quand la mêlée se termine parce que tous les défenseurs sont KO (ou si
  l'adversaire n'avait aucun défenseur au départ), **chaque attaquant encore debout frappe le
  héros adverse une fois**, de gauche à droite, à hauteur de son attaque effective, comme
  aujourd'hui (Attaque se déclenche pour ce coup). Cela inclut les attaquants qui avaient
  déjà frappé dans le cycle en cours (confirmé par l'utilisateur). Si tous les attaquants
  sont KO, le héros ne subit aucun dégât. Isoler la percée dans une fonction.
- **E16 — Attaque minimum 1 et combat nul (demandes utilisateur).**
  - L'**attaque effective** d'un monstre vaut **au moins 1** (plancher appliqué dans
    `getMonsterStats`, donc aussi à l'affichage). C'est la stat qui est plancher, **pas les
    dégâts** : un coup peut être réduit à 0 par un `shield` (dégâts absorbés, rien
    d'infligé).
  - **Combat nul** : si un cycle complet de mêlée n'inflige **aucun dégât à aucun monstre,
    des deux côtés** (somme des `damage` + `retaliation` du cycle = 0), le combat s'arrête
    sur un **match nul** : pas de percée, le défenseur ne perd aucun PV. L'évènement
    `combat` porte `stalemate: true`. Le tour passe normalement ensuite. (Les effets déjà
    résolus pendant ce cycle — pièces, PV via capacités — restent acquis.)
  - Filet de sécurité purement défensif : `MAX_COMBAT_CYCLES = 20` (constante exportée) ;
    s'il est atteint, même traitement qu'un combat nul.
  - À savoir : avec les règles actuelles, la riposte vaut toujours ≥ 1 (attaque minimum 1,
    et aucun effet ne réduit la riposte), donc le match nul **ne peut pas encore se
    produire** ; la vérification est là pour les futurs effets. Ne pas écrire de test
    artificiel qui contourne les règles pour l'atteindre ; un commentaire `// E16` suffit.
  - `isAbilityAllowed` exige `amount`/`count` ≥ 1.
- **E17 — Monstres sans défense.** Un attaquant ou un défenseur dont la défense effective
  est ≤ 0 au début du combat n'y participe pas (même filtre qu'aujourd'hui pour les
  défenseurs, étendu aux attaquants).

## 2. Modèle de données (`src/game/types.ts`)

```ts
export type Trigger = 'summon' | 'attack' | 'defend' | 'ko' | 'sold';

// Effets déclenchés par une capacité. `seat` = propriétaire de la carte source.
export type AbilityEffect =
  | { type: 'gainCoins'; amount: number }                 // pièces au propriétaire
  | { type: 'damageOpponent'; amount: number }            // dégâts au héros adverse
  | { type: 'healSelf'; amount: number }                  // PV au héros du propriétaire (E8)
  | { type: 'drawCard'; count: number }                   // E11
  | { type: 'buff'; target: 'self' | 'otherAllies'; attack: number; defense: number } // E9
  | { type: 'bonusDamage'; amount: number }               // Attaque uniquement (E12)
  | { type: 'shield'; amount: number };                   // Défend uniquement (E12)

export interface CardAbility {
  trigger: Trigger;
  effect: AbilityEffect;
}
```

- `CardDefBase` reçoit `abilities?: CardAbility[]` (absent = pas de capacité). Garder
  `EnchantmentEffect` (effet **permanent** des enchantements) tel quel : c'est une notion
  différente, ne pas fusionner les deux types.
- `CardInstance` reçoit `buff?: { attack: number; defense: number }` (absent tant qu'aucun
  buff ; jamais `{0,0}` écrit inutilement).
- Journal d'un effet résolu, pour que les deux clients affichent la même chose :

```ts
export type EffectLog = AbilityEffectLog | KeywordEffectLog;

export interface AbilityEffectLog {
  kind?: 'ability';   // omis : compatible avec les évènements écrits avant les habiletés
  seat: Seat;         // propriétaire de la carte source
  sourceUid: string;
  cardId: string;
  trigger: Trigger;
  effect: AbilityEffect;
}

// v12 : une habileté (mot-clé) qui modifie la résolution est journalisée elle aussi, sinon
// le combat dévie (attaque détournée, dégâts annulés, éclaboussure…) sans rien à lire.
export interface KeywordEffectLog {
  kind: 'keyword';
  seat: Seat;
  sourceUid: string;
  cardId: string;
  keyword: Keyword;
}
```

- `CombatStep` devient :

```ts
export interface CombatStep {
  cycle: number;             // 1, 2, … pour la mêlée ; cycle de la percée = dernier cycle + 1
  attackerUid: string;
  target: CombatTarget;
  damage: number;            // dégâts réellement infligés par l'attaquant (bonus/bouclier inclus)
  remaining: number;         // défense restante du monstre ciblé (0 = KO) ou PV restants du joueur
  retaliation: number;       // riposte reçue par l'attaquant (0 en percée)
  attackerRemaining: number; // défense restante de l'attaquant après l'échange (0 = KO)
  effects: EffectLog[];      // effets résolus pendant l'échange, dans l'ordre (E5)
  hp: Record<Seat, number>;  // PV des deux joueurs après l'échange, effets compris
}
```

- `GameEvent` :
  - `place` et `sell` reçoivent `effects: EffectLog[]` (tableau vide si aucun) ;
  - `combat` reçoit `hpBefore: Record<Seat, number>` (PV au début du combat) et
    `stalemate: boolean` (combat nul, E16).

## 3. Moteur de règles (`src/game/rules.ts`)

Garder le moteur dans `rules.ts` (dans une section commentée « Effets déclenchés ») plutôt
que dans un nouveau fichier : il a besoin de `opponentOf`, `STARTING_HP`, `getMonsterStats`,
et un module séparé créerait un import circulaire. `RULES_VERSION = 5`.

### 3.1 Stats

- `getMonsterStats(player, card: CardInstance, zone)` remplace la signature actuelle
  `(player, cardId, zone, golden)` : base (doublée si `card.golden`) + `card.buff` + bonus
  d'enchantement, puis `attack = Math.max(MIN_ATTACK, attack)` avec
  `export const MIN_ATTACK = 1` (E16). Mettre à jour les appelants : `resolveCombat`,
  `cardFaceStats.ts`, `rules.test.ts`. Supprimer le `Math.max(0, …)` actuel de
  `resolveCombat`, devenu inutile.
- `getBaseMonsterStats` ne change pas (il sert de référence pour la couleur « buffé » :
  un monstre avec `buff` s'affichera donc en vert, c'est voulu).

### 3.2 Helpers internes

```ts
// Seul point d'entrée des dégâts au héros (E7) : fixe le vainqueur au premier 0.
function damageHero(state: GameState, seat: Seat, amount: number): void
function healHero(state: GameState, seat: Seat, amount: number): void   // E8
function addBuff(card: CardInstance, attack: number, defense: number): void // E9, n'écrit rien si 0/0
function effectAmount(card: CardInstance, value: number): number // E10 : renvoie `value` tel quel
```

### 3.3 Déclenchement

```ts
interface HitModifiers { bonusDamage: number; damageReduction: number }

// Résout toutes les capacités `trigger` de `card` (propriétaire `seat`), dans l'ordre (E2),
// en mutant `state`. S'arrête dès que `state.winner` est fixé (E7). `hit` n'est fourni
// que pour Attaque / Défend ; `bonusDamage` / `shield` l'alimentent (E12).
function fireTrigger(
  state: GameState, seat: Seat, card: CardInstance, trigger: Trigger, hit?: HitModifiers,
): EffectLog[]
```

Application par type d'effet :

- `gainCoins` → `players[seat].coins += amount`.
- `damageOpponent` → `damageHero(state, opponentOf(seat), amount)`.
- `healSelf` → `healHero(state, seat, amount)`.
- `drawCard` → `count` fois : `deck.pop()` vers `hand` si le deck n'est pas vide.
- `buff` `self` → `addBuff(card, …)` ; `otherAllies` → tous les monstres des zones
  `attack` + `defense` de `seat`, sauf `card`.
- `bonusDamage` → `hit.bonusDamage += amount` ; `shield` → `hit.damageReduction += amount`.

Chaque effet résolu produit une entrée `EffectLog`.

### 3.4 Intégration dans les actions

- `applyPlace` : après `zones[zone][slot] = card`, `effects = fireTrigger(next, seat, card,
  'summon')` ; l'évènement `place` porte `effects`. Si `next.winner` est fixé, rien d'autre
  (la partie est finie, `isActionLegal` refuse déjà toute action).
- `applySell` : après défausse + pièce, supprimer `card.buff` (E9) puis `fireTrigger(…,
  'sold')` ; l'évènement `sell` porte `effects`.
- `applyFuse` : supprimer `buff` sur les exemplaires absorbés (ils partent en défausse).
- `applyEndTurn` : capturer `hpBefore`, appeler `resolveCombat(next, seat)`, écrire
  l'évènement `combat` avec `hpBefore` et les `steps`. Si `next.winner` est fixé (par
  n'importe quel camp), ne changer ni le tour ni la phase (H9 existant). Supprimer l'ancien
  `next.players[defenderSeat].hp = defenderHp` : les PV sont désormais mutés directement.

### 3.5 Réécriture de `resolveCombat` (cycles + riposte + déclencheurs)

Nouvelle signature : `resolveCombat(state, attackerSeat): { steps: CombatStep[]; stalemate: boolean }` — **elle
mute `state`** (documenter ce changement en commentaire ; `applyEndTurn` lui passe `next`, qui
est déjà un clone). Chaque combattant est suivi par :

```ts
interface Fighter { card: CardInstance; damageTaken: number; ko: boolean }
// défense restante = max(0, défense effective (relue à chaque fois) − damageTaken)
```

Pseudo-code :

```
attackers = Fighters des cartes non nulles de la zone d'attaque (gauche → droite),
            défense effective > 0 (E17)
defenders = Fighters de la zone de défense adverse, défense effective > 0

cycle = 0
// --- Mêlée (E14) ---
stalemate = false
tant que !winner et un attaquant debout et un défenseur debout :
  si cycle == MAX_COMBAT_CYCLES : stalemate = true ; stop (E16, filet de sécurité)
  cycle += 1 ; damageThisCycle = 0
  pour chaque attacker debout (ordre gauche → droite, statut relu à chaque itération) :
    si winner ou plus aucun défenseur debout : sortir du cycle
    target = premier défenseur debout
    hit = { bonusDamage: 0, damageReduction: 0 }
    effects = fireTrigger(state, attackerSeat, attacker.card, 'attack', hit)
    si !winner : effects += fireTrigger(state, defenderSeat, target.card, 'defend', hit)
    si winner : damage = retaliation = 0
    sinon :
      damage      = max(0, stats(attacker).attack + hit.bonusDamage − hit.damageReduction)
      retaliation = stats(target, 'defense').attack                  // E13 (attaque ≥ 1, E16)
    target.damageTaken += damage ; attacker.damageTaken += retaliation   // simultanés
    damageThisCycle += damage + retaliation
    si défense restante(target) == 0 et !target.ko :
      target.ko = true ; si !winner : effects += fireTrigger(…, target.card, 'ko')
    si défense restante(attacker) == 0 et !attacker.ko :
      attacker.ko = true ; si !winner : effects += fireTrigger(…, attacker.card, 'ko')
    steps.push({ cycle, attackerUid, target: monster, damage, remaining, retaliation,
                 attackerRemaining, effects, hp: snapshot PV })
  si !winner et damageThisCycle == 0 : stalemate = true ; stop (E16, combat nul)

// --- Percée (E15), seulement si la mêlée s'est terminée faute de défenseur debout
//     (jamais en cas de combat nul, E16) ---
si !winner et !stalemate et aucun défenseur debout (y compris aucun au départ) :
  pour chaque attacker debout (gauche → droite) :
    si winner : stop
    hit = { bonusDamage: 0, damageReduction: 0 }
    effects = fireTrigger(state, attackerSeat, attacker.card, 'attack', hit)
    damage = winner ? 0 : stats(attacker).attack + hit.bonusDamage   // ≥ 1 (E16)
    damageHero(state, defenderSeat, damage)
    steps.push({ cycle: cycle + 1, attackerUid, target: player, damage,
                 remaining: PV du défenseur, retaliation: 0,
                 attackerRemaining: défense restante(attacker), effects, hp: snapshot })
```

Points d'attention :

- Les stats sont relues au moment où on en a besoin (un buff reçu par Attaque s'applique au
  coup en cours ; un buff de défense profite à un monstre debout, E9).
- « KO reste KO jusqu'à la fin du combat » passe par le flag `ko`, pas par la défense
  restante (sinon un buff pourrait relever un monstre).
- Aucun dégât subi n'est écrit dans l'état persistant : `damageTaken` vit uniquement dans
  `resolveCombat` (H1).
- `CombatStep.remaining` garde son sens actuel pour ne pas casser l'animation existante.
- Sans défenseur au départ et avec les nouvelles règles, le résultat est identique à
  aujourd'hui (chaque attaquant frappe le héros une fois) : garder ce test existant.

## 4. Textes de capacités (`src/game/cards.ts`)

```ts
export const TRIGGER_LABELS: Record<Trigger, string> = {
  summon: 'Invoqué', attack: 'Attaque', defend: 'Défend', ko: 'KO', sold: 'Vendu',
};
export function describeAbility(ability: CardAbility): string // « Invoqué : +1 pièce »
```

Textes des effets (gérer le pluriel) :

| Effet                          | Texte                                  |
|--------------------------------|----------------------------------------|
| `gainCoins`                    | `+N pièce(s)`                          |
| `damageOpponent`               | `N dégât(s) au héros adverse`          |
| `healSelf`                     | `+N PV à ton héros`                    |
| `drawCard`                     | `pioche N carte(s)`                    |
| `buff` self                    | `gagne +A/+D` (ou `+A attaque` / `+D défense` si l'un vaut 0, comme `describeEffect`) |
| `buff` otherAllies             | `+A/+D à tes autres monstres`          |
| `bonusDamage`                  | `+N dégât(s) sur ce coup`              |
| `shield`                       | `subit N dégât(s) de moins`            |

Ajouter aussi `isAbilityAllowed(def: CardDef, ability: CardAbility): boolean` (E12 + combat
réservé aux monstres : `attack`/`defend`/`ko` interdits sur un enchantement) — utilisé par le
test du catalogue.

## 5. Batch de cartes de test (`CARD_CATALOG`)

Ajouter `abilities` sur les cartes existantes (le deck de départ ne change pas : 50 cartes,
toutes présentes dans le deck, donc toutes rencontrées rapidement au marché). Chaque
déclencheur apparaît au moins deux fois et chaque effet au moins une fois.

| Carte (id)                  | Stats / coût | Capacité(s)                                            | Ce que ça teste                              |
|-----------------------------|--------------|--------------------------------------------------------|----------------------------------------------|
| Écuyer (`squire`)           | 1/2, 1       | Invoqué : +1 pièce · KO : pioche 1 carte               | 2 capacités sur une carte, pioche hors tour, KO d'attaquant par riposte |
| Loup gris (`wolf`)          | 3/1, 2       | Attaque : +2 dégâts sur ce coup · Vendu : +2 PV à ton héros | modificateur de coup, soin, vente      |
| Garde du pont (`guard`)     | 1/4, 2       | Défend : subit 1 dégât de moins                        | `shield` à chaque coup reçu, sur plusieurs cycles |
| Archère (`archer`)          | 3/2, 3       | Invoqué : 1 dégât au héros adverse                     | dégâts hors combat, victoire sur `place`     |
| Chevalier (`knight`)        | 3/4, 4       | Attaque : gagne +1 attaque (permanent)                 | buff persistant, cumul sur plusieurs cycles  |
| Golem de pierre (`golem`)   | 1/8, 5       | Défend : 1 dégât au héros adverse                      | l'attaquant peut perdre pendant son combat   |
| Drake (`drake`)             | 5/4, 6       | KO : +3 PV à ton héros                                 | KO + soin plafonné                           |
| Titan (`titan`)             | 7/7, 8       | Aura : +1/+1 à tes autres monstres (même posés après) | aura continue, comme un enchantement         |
| Trésorerie (`treasury`)     | ench., 3     | Vendu : +2 pièces (garde son effet `coinsPerTurn`)     | capacité sur enchantement + effet permanent  |

Les valeurs sont volontairement simples et lisibles ; l'équilibrage n'est pas l'objet. À
noter : avec les cycles, Attaque se déclenche à chaque attaque, donc le Chevalier peut
gagner plusieurs +1 par combat — c'est voulu pour tester le cumul, mais c'est la première
carte à ajuster si elle s'emballe.

> **Mise à jour (règles v8)** : c'est arrivé. Le buff Attaque du Chevalier et les dégâts
> Défend du Golem portent désormais `oncePerCombat: true` (champ de `CardAbility`) : ils ne se
> déclenchent qu'au premier coup éligible de chaque combat, plus à chaque cycle. Les
> modificateurs de coup (`bonusDamage`, `shield`) restent, eux, appliqués à chaque coup.

## 6. Affichage

### 6.1 Texte sur la face (`src/scene/textures.ts`)

- Monstre : zone de texte entre le nom/bandeau doré (y ≈ 130) et les badges de stats
  (y ≈ 340). Fond sombre semi-transparent arrondi, un paragraphe par capacité
  (`describeAbility`), police ~18 px, `wrapText` existant (l'étendre pour renvoyer la hauteur
  utilisée ou empiler les paragraphes). Rien n'est dessiné si `abilities` est absent : les
  cartes sans capacité gardent exactement leur rendu actuel.
- Enchantement : capacités sous le texte de l'effet permanent (vers y ≈ 310).
- La clé de cache contient déjà `def.id` : pas de changement de clé nécessaire.
- Le zoom (`getCardFaceDataUrl`) en profite automatiquement.

### 6.2 Lecture du combat (`combatPlayback.ts`, `useCombatPlayback.ts`, `cardFaceStats.ts`)

Les attaquants perdent maintenant de la défense et peuvent être KO, et les PV des **deux**
joueurs peuvent bouger pendant un combat (épines du Golem, soins du Drake).

- `combatDisplay(steps, applied, hpBefore)` :
  - `defense` : pour chaque coup appliqué, `target.uid → remaining` (cible monstre) **et**
    `attackerUid → attackerRemaining` ; `ko` : toute carte dont la valeur tombe à 0 (les
    deux camps) ;
  - `hp: Record<Seat, number>` = `applied === 0 ? hpBefore : steps[applied - 1].hp`
    (remplace `pendingPlayerDamage`) ;
  - `appliedEffects: EffectLog[]` (effets des coups déjà appliqués, dans l'ordre) pour §6.3 ;
  - `cycle` : cycle du dernier coup appliqué (ou du coup en cours).
- `useCombatPlayback` mémorise `hpBefore` avec les steps, expose `displayedHp = view.hp`
  pendant la lecture (`state.players[*].hp` sinon), `appliedEffects` et `cycle`.
- `computeMonsterFaceStats` : appliquer les surcharges de défense / KO dans **les deux**
  zones (aujourd'hui seulement `zone === 'defense'`). Le flash de dégâts de `Card.tsx`
  (déclenché par une baisse de `stats.defense`) fonctionne alors aussi pour la riposte, et
  la rotation KO pour un attaquant.
- Cadence : un combat peut maintenant compter plusieurs dizaines de coups. Passer
  `STEP_MS` de 750 à ~550 ms (et `IMPACT_MS` au milieu de la fente, en ajustant
  `LUNGE_DURATION` de `Card.tsx` si besoin). Garder un pas uniforme pour que
  `playbackCursor` reste simple.
- Bannière de combat (`GameScreen`) : « Combat · cycle N » à partir du cycle 2, « Percée ! »
  pendant les coups de percée, « Combat nul » en fin de lecture si `stalemate`.
- Mettre à jour `combatPlayback.test.ts` (riposte, KO d'attaquant, PV des deux camps).

Limites acceptées (à documenter en commentaire) : pièces, main (pioche) et buffs permanents
reflètent l'état final dès l'arrivée de l'évènement `combat`, pas au fil de l'animation.

### 6.3 Retour visuel des effets

1. **Fil d'effets (obligatoire)** — petite pile de toasts HTML dans `GameScreen` (côté
   gauche, sous la plaque adverse ; styles dans `src/styles.css` dans le ton du HUD), ex.
   « Golem de pierre — Défend : 1 dégât au héros adverse », ou, pour une habileté,
   « Garde du pont — Provocation : l'attaque est détournée sur lui ». Couleur/icône différente selon
   que la carte source est à moi ou à l'adversaire. Chaque toast disparaît après ~2,5 s.
   Sources : `lastEvent.effects` d'un nouvel évènement `place`/`sell`, et les
   `appliedEffects` du combat au fil de la lecture. Même garde que la bannière de tour :
   au premier rendu (rafraîchissement de page), ne rien rejouer.
2. **Pulsation de la carte source (souhaitable)** — `Card` reçoit une prop
   `effectPulse: number | null` (clé qui change à chaque déclenchement) ; flash émissif
   violet sur le modèle de `flashIntensity`/`goldFlash`. `Board` construit la table
   `uid → clé` à partir des mêmes sources que le fil.

## 7. Tests (`src/game/rules.test.ts`)

Les tests de combat existants reposent sur H8 (pas de riposte, un seul passage) : les
**réécrire** selon les nouvelles règles plutôt que de conserver leurs anciennes attentes.
Mettre à jour aussi les tests cassés par les changements de format (`effects: []` sur les
évènements `place`/`sell`, nouveaux champs de `CombatStep`, signature de `getMonsterStats`,
`rulesVersion` → utiliser la constante `RULES_VERSION`). Utiliser `toMatchObject` quand
seul un sous-ensemble compte.

### 7.1 Combat en cycles (`describe('combat : riposte et cycles')`, sans capacités)

Pour ces tests, construire des cartes sans capacité : soit utiliser des cartes du catalogue
qui n'en ont pas (`rampart`, `banner`, `blessing` sont des enchantements ; aucun monstre du
batch n'est vierge), soit — préférable — ajouter dans le test un moyen d'isoler les règles
de combat (ex. vérifier seulement `damage`/`retaliation`/`remaining` sur des échanges où les
capacités n'interviennent pas, ou exporter une variante interne `resolveCombat` qui ignore
les capacités **uniquement** si c'est simple ; ne pas complexifier le code de production
pour ça).

- Riposte : attaquant 3/2 contre défenseur 1/4 → défenseur 1 restant, attaquant 1 restant.
- Simultanéité : un défenseur mis KO par le coup riposte quand même.
- Cycles : 1 attaquant 1/5 contre 1 défenseur 0/3 → 3 cycles, 3 coups, défenseur KO, puis
  percée : 1 dégât au héros.
- Un attaquant KO par riposte au cycle 1 n'apparaît plus dans les coups suivants.
- Le dernier défenseur tombe en milieu de cycle → les attaquants suivants frappent en percée
  (pas en mêlée), chacun une fois, y compris ceux qui avaient déjà frappé dans le cycle.
- Tous les attaquants KO → aucun dégât au héros, PV inchangés.
- Aucun défenseur au départ → chaque attaquant frappe le héros une fois (comportement
  actuel conservé).
- Attaque minimum (E16) : un monstre dont l'attaque calculée serait ≤ 0 a une attaque
  effective de 1 (`getMonsterStats`) et riposte donc de 1.
- Combat nul (E16) : `stalemate` vaut `false` dans tous les combats normaux ; deux monstres
  1/5 face à face → le combat se termine sans atteindre `MAX_COMBAT_CYCLES`. (Le cas
  `stalemate: true` n'est pas atteignable avec les règles actuelles, voir E16.)
- Catalogue : tout monstre a une attaque de base ≥ 1.
- Excédent de dégâts perdu (H2) sur le coup et sur la riposte.
- H1 : après le combat, l'état ne contient aucune trace de dégâts sur les monstres.
- Victoire en percée : PV adverses à 0 → `winner`, combat arrêté (H9).

### 7.2 Effets déclenchés (`describe('effets déclenchés')`)

- Catalogue : toutes les capacités respectent `isAbilityAllowed` ; le deck fait toujours 50.
- Invoqué : Écuyer posé → +1 pièce, log dans `lastEvent.effects`.
- Invoqué : Archère posée avec l'adversaire à 1 PV → `winner` = poseur, PV adverses 0.
- Invoqué : Titan → +1/+1 sur les autres monstres (attaque et défense), pas sur lui-même ;
  buff visible via `getMonsterStats`.
- Vendu : Trésorerie → 1 (vente) + 2 pièces ; Loup → +2 PV, plafonné à 20 (E8).
- Vendu/fusion : `buff` supprimé sur la carte qui part en défausse.
- Attaque : Loup (3 atq) contre le héros → 5 dégâts ; contre un monstre → 5 dégâts, la
  riposte n'est pas augmentée.
- Attaque : Chevalier → Attaque se déclenche à chaque cycle, `buff.attack` égal au nombre
  d'attaques effectuées, buff conservé au combat suivant.
- Défend : Garde (4 déf) frappée par un 3 atq → 2 restant ; le shield s'applique à chaque
  coup, sur plusieurs cycles ; shield ≥ dégâts → 0 dégât (coup absorbé) ; la riposte de
  la Garde (1) n'est pas affectée, donc le combat ne se bloque pas (`stalemate: false`).
- Défend : Golem avec l'attaquant à 1 PV → l'attaquant perd, combat interrompu, coups
  suivants non résolus, `winner` = défenseur, tour et phase inchangés.
- KO : Écuyer **défenseur** mis KO → pioche la carte du dessus de son deck ; deck vide → rien.
- KO : Écuyer **attaquant** mis KO par riposte → son propriétaire (joueur actif) pioche.
- KO : déclenché une seule fois par combat même si le combat continue.
- KO : Drake → +3 PV (plafond 20).
- Ordre des `effects` dans un échange = Attaque, Défend, KO du défenseur, KO de
  l'attaquant (E5) ; `CombatStep.hp` et `hpBefore` cohérents avec l'état final.
- Doré : un Écuyer doré posé donne toujours +1 pièce (E10).

## 8. Documentation

- `README.md` §4 :
  - réécrire le paragraphe **Combat** : riposte, cycles, percée, attaque minimum de 1,
    combat nul, et retirer la mention « le défenseur ne riposte jamais » dans le paragraphe des
    hypothèses ;
  - ajouter un paragraphe **Capacités** (liste des déclencheurs, ordre de résolution d'un
    échange, où ajouter une capacité : `abilities` dans `CARD_CATALOG`, effets disponibles
    dans `AbilityEffect`) et mentionner les hypothèses E1–E17.
- Commentaires `// En` dans le code aux endroits correspondants ; mettre à jour tout
  commentaire citant H8.

## 9. Étapes d'exécution

Après chaque étape : `npm run test` et `npm run build` doivent passer.

1. **Types et stats** — §2 + `getMonsterStats(player, card, zone)` avec `buff` + mise à jour
   des appelants et des tests. Nouveaux champs d'évènements renseignés (`effects: []`,
   `hp`, `hpBefore`, `stalemate`, `cycle`, `retaliation`, `attackerRemaining`) mais combat encore à
   l'ancienne. `RULES_VERSION = 5`.
2. **Combat en cycles avec riposte, sans capacités** — §1bis + §3.5 sans les appels à
   `fireTrigger` + tests §7.1.
3. **Lecture du combat** — §6.2 (riposte et KO d'attaquant visibles, PV des deux camps,
   cadence, bannière de cycle) + `combatPlayback.test.ts`. Vérifier en jeu à deux onglets
   à ce stade, avant d'ajouter les capacités.
4. **Textes et catalogue** — §4 + batch §5 + test du catalogue.
5. **Moteur hors combat** — §3.2, §3.3, Invoqué / Vendu / fusion (§3.4) + tests associés.
6. **Déclencheurs de combat** — brancher Attaque / Défend / KO dans `resolveCombat` (§3.5)
   + tests §7.2 correspondants.
7. **Faces de cartes** — §6.1.
8. **Retour visuel** — §6.3 (fil d'effets, puis pulsation).
9. **Doc** — §8.

### Vérification manuelle finale (mode local, deux onglets — voir README §1)

- Combat : un attaquant perd de la défense à chaque riposte (flash), tombe KO (rotation) et
  n'attaque plus ; le combat enchaîne plusieurs cycles (bannière « cycle N ») puis la percée
  touche le héros seulement si tous les défenseurs sont tombés. Tous les monstres se
  relèvent, défense pleine, en fin de combat.
- Une Garde (bouclier 1) frappée par un Écuyer (1 attaque) ne perd rien (coup absorbé),
  mais sa riposte fait tomber l'Écuyer : le combat se termine normalement.
- Poser un Écuyer : +1 pièce, toast visible dans les deux onglets.
- Poser une Archère : PV adverses −1 ; à 1 PV adverse, la partie se termine.
- Attaquer avec un Loup : le coup affiche 2 dégâts de plus ; un Chevalier garde son bonus
  (chiffre vert) au tour suivant.
- Attaquer une Garde / un Golem : dégâts réduits / PV de l'attaquant qui baissent pendant
  l'animation (pas avant).
- Mettre KO un Écuyer / un Drake (en défense ou en attaque) : rotation KO, toast, pioche /
  soin.
- Vendre une Trésorerie : +3 pièces au total.
- Rafraîchir la page en cours de partie : aucun toast ni combat rejoué.
- Les textes des capacités sont lisibles sur la face et dans le zoom, les cartes sans
  capacité sont inchangées.

## 10. Hors scope

Ciblage choisi par le joueur, effets aléatoires (nécessiterait un PRNG stocké dans l'état),
chaînes d'effets, effets qui posent/détruisent des cartes, capacités « au début du tour »,
dégâts persistants entre combats, équilibrage du batch.
