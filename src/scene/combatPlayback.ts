// Curseur de lecture du combat (§7.1), pur : dérive de l'écoulement du temps quel coup est
// en cours de fente et combien de coups ont déjà leur impact affiché. Les DEUX clients
// partagent la même liste de coups (`GameEvent` de type `combat`) et rejouent donc la même
// animation, sans état intermédiaire à synchroniser (T4).

import type { CombatStep } from '../game/types';

export const START_DELAY_MS = 400;
export const STEP_MS = 750;
export const IMPACT_MS = 225; // milieu de la fente de 0.45 s de Card.tsx
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
  defense: Map<string, number>; // défense affichée des défenseurs déjà touchés
  ko: Set<string>;
  pendingPlayerDamage: number; // dégâts aux PV pas encore « arrivés »
}

export function combatDisplay(steps: CombatStep[], applied: number): CombatDisplay {
  const defense = new Map<string, number>();
  const ko = new Set<string>();
  let pendingPlayerDamage = 0;

  for (let i = 0; i < applied; i++) {
    const step = steps[i];
    if (step.target.kind === 'monster') {
      defense.set(step.target.uid, step.remaining);
      if (step.remaining === 0) ko.add(step.target.uid);
    }
  }

  // Les dégâts aux PV pas encore appliqués sont ceux des coups restants ciblant le joueur :
  // les PV affichés = PV finaux + ce qui n'est pas encore "arrivé" (§7.1).
  for (let i = applied; i < steps.length; i++) {
    const step = steps[i];
    if (step.target.kind === 'player') pendingPlayerDamage += step.damage;
  }

  return { defense, ko, pendingPlayerDamage };
}
