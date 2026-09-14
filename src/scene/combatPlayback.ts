// Curseur de lecture du combat (§7.1), pur : dérive de l'écoulement du temps quel coup est
// en cours de fente et combien de coups ont déjà leur impact affiché. Les DEUX clients
// partagent la même liste de coups (`GameEvent` de type `combat`) et rejouent donc la même
// animation, sans état intermédiaire à synchroniser (T4).
//
// PLAN-effets-triggers.md §6.2 : un combat peut maintenant compter plusieurs dizaines de
// coups (mêlée en cycles, E14) — cadence resserrée par rapport à la v1.

import type { CombatStep, EffectLog, Seat } from '../game/types';

export const START_DELAY_MS = 400;
export const STEP_MS = 550;
export const IMPACT_MS = 160; // milieu de la fente de Card.tsx
export const END_PAUSE_MS = 700;

export interface PlaybackCursor {
  lungeIndex: number | null; // coup dont la fente est en cours
  applied: number; // nombre de coups dont l'impact est déjà affiché
  done: boolean;
}

export function playbackCursor(elapsedMs: number, stepCount: number): PlaybackCursor {
  if (stepCount === 0) return { lungeIndex: null, applied: 0, done: true };

  const t = elapsedMs - START_DELAY_MS;
  if (t < 0) return { lungeIndex: null, applied: 0, done: false };

  const i = Math.floor(t / STEP_MS);
  if (i < stepCount) {
    const withinStep = t - i * STEP_MS;
    const applied = i + (withinStep >= IMPACT_MS ? 1 : 0);
    return { lungeIndex: i, applied, done: false };
  }

  const done = t >= stepCount * STEP_MS + END_PAUSE_MS;
  return { lungeIndex: null, applied: stepCount, done };
}

export interface CombatDisplay {
  // Défense affichée pour chaque carte déjà touchée (cible ET attaquant, celui-ci recevant
  // la riposte, E13) — les deux camps peuvent donc apparaître ici.
  defense: Map<string, number>;
  ko: Set<string>;
  hp: Record<Seat, number>; // PV des deux joueurs après le dernier coup appliqué
  appliedEffects: EffectLog[]; // effets des coups déjà appliqués, dans l'ordre
  cycle: number; // cycle du dernier coup appliqué (ou du coup en cours)
  phase: 'melee' | 'breakthrough'; // mêlée (E14) ou percée (E15) du coup courant
  complete: boolean; // tous les coups ont déjà leur impact affiché
}

export function combatDisplay(
  steps: CombatStep[],
  applied: number,
  hpBefore: Record<Seat, number>,
): CombatDisplay {
  const defense = new Map<string, number>();
  const ko = new Set<string>();
  const appliedEffects: EffectLog[] = [];

  for (let i = 0; i < applied; i++) {
    const step = steps[i];
    if (step.target.kind === 'monster') {
      defense.set(step.target.uid, step.remaining);
      if (step.remaining === 0) ko.add(step.target.uid);
    }
    defense.set(step.attackerUid, step.attackerRemaining);
    if (step.attackerRemaining === 0) ko.add(step.attackerUid);
    appliedEffects.push(...step.effects);
  }

  const currentIndex = Math.min(applied, steps.length - 1);
  const currentStep = steps[currentIndex];
  const hp = applied === 0 ? hpBefore : steps[applied - 1].hp;
  const cycle = currentStep?.cycle ?? 1;
  const phase: CombatDisplay['phase'] = currentStep?.target.kind === 'player' ? 'breakthrough' : 'melee';

  return { defense, ko, hp, appliedEffects, cycle, phase, complete: applied >= steps.length };
}
