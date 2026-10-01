// Versions du jeu (demande utilisateur) : la V1 est l'état actuel, conservé tel quel pour
// pouvoir encore y jouer, pendant que la V2 se construit à côté avec de nouvelles cartes.
//
// Une version, c'est d'abord SON catalogue de cartes : chacune a le sien, édité séparément
// dans l'admin (sélecteur en haut à droite) et stocké séparément (`net/catalogStore.ts`). Le
// choix se fait dans le menu à la création d'une room et vaut pour toutes ses revanches.
//
// Les règles de la V2 (modifsV2.md) vivent dans `rulesV2.ts`, auquel `rules.ts` délègue dès
// que le catalogue actif porte `gameVersion: 'v2'`. Les habiletés et effets admis par chaque
// version sont listés dans `vocabulary.ts`.
//
// Module pur, comme `rules.ts`. La première valeur est la version par défaut.
export const GAME_VERSIONS = ['v1', 'v2'] as const;

export type GameVersion = (typeof GAME_VERSIONS)[number];

export const DEFAULT_GAME_VERSION: GameVersion = GAME_VERSIONS[0];

export const GAME_VERSION_LABELS: Record<GameVersion, string> = { v1: 'V1', v2: 'V2' };

export function isGameVersion(value: unknown): value is GameVersion {
  return (GAME_VERSIONS as readonly unknown[]).includes(value);
}
