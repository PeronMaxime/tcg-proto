# Retour sur modifsV2.md

Ce fichier répond aux questions et aux demandes de propositions de `modifsV2.md`. Les
propositions retenues sont marquées **✅ implémenté** ; le reste n'est pas implémenté et reste
à valider.

## 1. L'état « brûlé »

Implémenté selon ton choix : à la fin de chaque combat auquel il participe, le monstre brûlé
perd définitivement de la défense. À 0 de défense, il quitte le board et retourne sous le deck
(une créature invoquée disparaît). La brûlure dure tant que le monstre reste sur le board.

- ✅ **Brûlure cumulable** (implémenté) : chaque nouvelle brûlure ajoute 1 au montant perdu par
  combat (brûlé ×2 → −2 par combat). Le nombre de brûlures s'affiche à côté de la flamme.
- ✅ **Extinction par l'eau** (implémenté) : nouvel effet de capacité « Éteint la brûlure du
  monstre choisi » (sur Invoqué / Vendu, cible : un de tes monstres brûlés). Il retire toutes les
  brûlures, mais pas la défense déjà perdue. L'élément de la carte n'est pas imposé par le code :
  c'est à toi de le réserver aux cartes d'eau dans l'admin. Les soins du héros n'éteignent rien
  (ils ne touchent pas les monstres) — dis-moi si tu veux aussi une variante « éteint la brûlure
  de tous tes monstres ».
- **Brûlure qui se propage** (non retenu) : à la fin d'un combat, la brûlure se transmet à un
  voisin dans la rangée. Très offensif, à réserver à une carte rare.

## 2. Propositions d'états

Chaque état est pensé pour renforcer l'identité d'un élément.

| État | Effet proposé | Élément | Pourquoi |
|---|---|---|---|
| **Affaibli** | −X attaque jusqu'à la fin de son prochain combat | Eau / Air | Contrôle défensif sans tuer : protège un défenseur fragile. |
| **Étourdi** | Ne riposte pas pendant son prochain combat | Air | Plus doux que le gel : le monstre combat mais encaisse sans répondre. |
| **Enragé** | +X attaque, mais doit attaquer (ou être attaqué) en premier | Feu | Gros dégâts au prix d'une exposition. |
| **Empoisonné** | Perd 1 défense au début de chacun de ses combats, pour ce combat seulement, pendant N combats | Feu / Air | Version « temporaire » de la brûlure, plus facile à équilibrer. |
| ✅ **Enraciné (état)** | Ne peut plus changer de zone ni de position, même par son joueur, pendant 1 tour | Terre | Contre direct de l'Air. |
| **Aveuglé** | Son prochain coup vise un défenseur au hasard au lieu du plus à gauche | Air | Casse les plans basés sur Provocation ou le placement. |
| ✅ **Silence** | Ses capacités ne se déclenchent plus jusqu'à la fin de son prochain combat | Eau | Réponse aux monstres à gros effets. |
| **Marqué** | Les dégâts qu'il reçoit sont augmentés de 1 jusqu'à la fin du combat | Feu | Prépare un enchaînement offensif. |

Pour garder la lisibilité, je conseillerais de ne pas dépasser **4 ou 5 états** au total.
Avec gelé, brûlé, enraciné et silence, on en est à 4.

### Comment les deux états retenus ont été implémentés

- **Enraciné (état)** — effet « Enracine le monstre ciblé » (Invoqué / Vendu, cible : n'importe
  quel monstre, des deux camps). Le monstre ne peut plus être changé de zone ni de position, ni
  par un effet, ni par son joueur (glisser-déposer et Vol compris). L'état dure **jusqu'au début
  du prochain tour du joueur qui l'a enraciné** : enraciner un de ses monstres le protège pendant
  le tour adverse, enraciner un monstre adverse l'empêche d'être replacé pendant ce même tour.
  Il est distinct de l'habileté Enraciné (permanente, contre les effets seulement). Marque : des
  racines sur la face, en haut à gauche.
- **Silence** — effet « Réduit au silence le monstre ciblé » (Invoqué / Vendu, cible : un monstre
  adverse). Ses capacités (tous déclencheurs, Vendu compris) ne se déclenchent plus ; ses
  habiletés restent actives. Il retrouve la parole à la fin de son prochain combat, au même
  rythme que le gel. Marque : une bulle de parole barrée, en haut à gauche.

## 3. Choix faits pendant l'implémentation (conservés pour le moment)

Ces points n'étaient pas précisés dans `modifsV2.md`. J'ai pris l'option qui me paraissait la
plus logique ; dis-moi s'il faut changer.

1. **Cible choisie** (tes réponses) : seulement sur Invoqué / Vendu, le joueur clique la cible.
   Il peut aussi **renoncer** à l'effet (bouton « Renoncer »). Sans aucune cible possible,
   l'effet ne fait rien.
2. **Qui peut être ciblé** :
   - armure / protection : un de tes monstres (lui-même compris) ;
   - brûlure / gel : un monstre adverse ;
   - changement de zone / de position : n'importe quel monstre, des deux camps, sauf un
     Enraciné.
3. **« Gagne X armure »** : interprété comme « le monstre lui-même gagne X armure », et non le
   héros. Le héros n'a pas d'armure pour l'instant.
4. **« Tous les monstres de sa zone » / « de son board »** : le monstre source est inclus.
5. **Changement de position** : le joueur clique le monstre, puis la carte de la même zone dont
   il prend la place. Un monstre changé de zone (par effet, ou « Change de zone ») arrive tout à
   droite de sa nouvelle zone.
6. **Créature invoquée** : elle apparaît juste à droite de la carte qui l'invoque, avec
   l'élément de cette carte (nom générique : Flammèche, Ondine, Zéphyr, Golemite). Vendue, elle
   rapporte le prix normal (1 pièce) puis disparaît au lieu d'aller dans le deck. Un monstre
   doré invoque une créature aux stats doublées.
7. **Gel** : le monstre ne participe pas au prochain combat où il aurait combattu (s'il est en
   attaque : le prochain combat de son joueur ; en défense : le prochain combat de
   l'adversaire), puis dégèle à la fin de ce combat. Geler un défenseur adverse avant de lancer
   le combat l'en retire donc tout de suite.
8. **Toxic contre l'armure** : si l'armure encaisse tout le coup, Toxic ne tue pas. Il faut
   qu'au moins 1 dégât atteigne la défense. Percée + Toxic tue toujours.
9. **Portée** : 1 dégât aux voisins, même pour un monstre doré (en V1, un doré faisait +1). Les
   voisins déclenchent leurs effets « Défend », leur Protection, leur armure, et subissent le
   Toxic / la Percée de l'attaquant, mais **ne ripostent pas**.
10. **Furie** : deux coups complets (avec riposte) **à chaque cycle** du combat, pas seulement au
    premier.
11. **Protection reçue par effet** : à usage unique, elle passe après l'habileté Protection (qui
    se recharge à chaque combat). Elle s'affiche avec la même bulle.
12. **Vol** : le changement de zone consomme le déplacement de la zone de départ (règle « un
    déplacement par zone et par tour »), et ne peut pas dépasser la capacité de la zone (seuls
    les effets le peuvent).
13. **« Double les soins reçus »** : concerne les soins du héros. Deux enchantements
    → ×4 ; un enchantement doré → ×4. Le plafond de 10 PV reste.
14. **« Ajoute +X pièces au prix de vente »** : l'enchantement ne compte pas pour sa propre
    vente.
15. **Bonus de stats des enchantements** : l'éditeur garde le choix libre zone + attaque +
    défense. Il couvre les 7 lignes de ta liste, mais permet aussi des combinaisons hors liste
    (ex. « +1 défense aux monstres en attaque »). Dis-moi si tu veux le restreindre aux 7 cas.
16. **Copie V1 → V2** : à la lecture du catalogue V2, tout ce qui n'existe plus en V2 est retiré
    automatiquement (auras, bonus permanents, dégâts bonus, bouclier de capacité). Les cartes
    concernées gardent leurs stats et le reste de leurs capacités. Le catalogue V2 de l'admin
    affichera donc ces cartes sans ces éléments ; enregistre-le pour figer le nettoyage.
17. **Onglet Puissances** : la liste des effets d'enchantement (valeur + coefficient) n'est
    ajoutée qu'en V2, pour ne pas changer les puissances de la V1. Je peux l'étendre à la V1 si
    tu le souhaites.

## 4. Points d'attention pour l'équilibrage

- **Armure qui s'accumule** : les effets « Gagne X armure » sur Défend ou Début du combat peuvent
  produire un monstre quasi intuable sans carte Percée. À surveiller.
- **Combat nul** : l'armure et les protections comptent comme un « progrès » dans un cycle,
  donc un combat ne s'arrête plus à tort quand tous les coups tombent dans l'armure. Le filet de
  20 cycles reste.
- **Dépassement de zone** : la rangée se resserre au-delà de 5 cartes. Au-delà de 8 ou 9 cartes,
  la lisibilité devient médiocre. Une limite haute (par exemple 7) serait peut-être utile.
