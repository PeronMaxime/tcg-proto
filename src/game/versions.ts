// Versions du jeu (demande utilisateur) : la V1 est l'état actuel, conservé tel quel pour
// pouvoir encore y jouer, pendant que la V2 se construit à côté avec de nouvelles cartes.
//
// Une version, c'est d'abord SON catalogue de cartes : chacune a le sien, édité séparément
// dans l'admin (sélecteur en haut à droite) et stocké séparément (`net/catalogStore.ts`). Le
// choix se fait dans le menu à la création d'une room et vaut pour toutes ses revanches.
//
// Le code des règles, lui, est commun : une capacité ajoutée pour la V2 existe aussi pour la
// V1 (sans effet tant qu'aucune carte V1 ne l'utilise). Une mécanique propre à une version
// devra lire la version de la partie pour ne s'appliquer qu'à elle.
//
// Module pur, comme `rules.ts`. La première valeur est la version par défaut.
export const GAME_VERSIONS = ['v1', 'v2'] as const;

export type GameVersion = (typeof GAME_VERSIONS)[number];

export const DEFAULT_GAME_VERSION: GameVersion = GAME_VERSIONS[0];

export const GAME_VERSION_LABELS: Record<GameVersion, string> = { v1: 'V1', v2: 'V2' };

export function isGameVersion(value: unknown): value is GameVersion {
  return (GAME_VERSIONS as readonly unknown[]).includes(value);
}
