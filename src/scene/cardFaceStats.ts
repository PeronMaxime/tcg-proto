// Calcule les stats affichées d'un monstre posé (buffs d'enchantement + surcharges de
// combat en cours de lecture). Partagé entre `Board.tsx` (rendu 3D) et le zoom de carte
// (`GameScreen.tsx`) pour que les deux affichent exactement les mêmes chiffres.

import { getBaseMonsterStats, getMonsterStats } from '../game/rules';
import type { CardInstance, MonsterZone, PlayerState } from '../game/types';
import type { CombatView } from '../ui/useCombatPlayback';
import type { MonsterFaceStats } from './textures';

export function computeMonsterFaceStats(
  ownerPlayer: PlayerState,
  card: CardInstance,
  zone: MonsterZone,
  combatView: CombatView | null,
): { stats: MonsterFaceStats; ko: boolean } {
  const { uid, cardId, golden } = card;
  // Référence des couleurs de stats : la base du monstre (doublée s'il est doré), pour que
  // seul un vrai bonus d'enchantement OU un buff permanent (E9) s'affiche en vert.
  const base = getBaseMonsterStats(cardId, golden);
  const effective = getMonsterStats(ownerPlayer, card, zone);
  let defenseValue = effective.defense;
  let defenseTone: MonsterFaceStats['defenseTone'] = effective.defense > base.defense ? 'buffed' : 'base';
  let ko = false;

  // §6.2 : un attaquant peut désormais aussi encaisser (riposte, E13) et être mis KO, donc
  // les surcharges de combat s'appliquent dans LES DEUX zones (avant : seulement 'defense').
  if (combatView) {
    const overridden = combatView.defense.get(uid);
    if (overridden !== undefined) {
      defenseValue = overridden;
      if (overridden < effective.defense) defenseTone = 'wounded';
    }
    ko = combatView.ko.has(uid);
  }

  return {
    stats: {
      attack: effective.attack,
      defense: defenseValue,
      attackTone: effective.attack > base.attack ? 'buffed' : 'base',
      defenseTone,
      golden: golden === true,
    },
    ko,
  };
}
