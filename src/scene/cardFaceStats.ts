// Calcule les stats affichées d'un monstre posé (buffs d'enchantement + surcharges de
// combat en cours de lecture). Partagé entre `Board.tsx` (rendu 3D) et le zoom de carte
// (`GameScreen.tsx`) pour que les deux affichent exactement les mêmes chiffres.

import { getCardDef, isMonster } from '../game/cards';
import { getMonsterStats } from '../game/rules';
import type { MonsterZone, PlayerState } from '../game/types';
import type { CombatView } from '../ui/useCombatPlayback';
import type { MonsterFaceStats } from './textures';

export function computeMonsterFaceStats(
  ownerPlayer: PlayerState,
  cardId: string,
  zone: MonsterZone,
  uid: string,
  combatView: CombatView | null,
): { stats: MonsterFaceStats; ko: boolean } {
  const def = getCardDef(cardId);
  if (!isMonster(def)) throw new Error(`Carte non-monstre: ${cardId}`);

  const effective = getMonsterStats(ownerPlayer, cardId, zone);
  let defenseValue = effective.defense;
  let defenseTone: MonsterFaceStats['defenseTone'] = effective.defense > def.defense ? 'buffed' : 'base';
  let ko = false;

  if (zone === 'defense' && combatView) {
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
      attackTone: effective.attack > def.attack ? 'buffed' : 'base',
      defenseTone,
    },
    ko,
  };
}
