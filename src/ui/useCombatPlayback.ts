import { useEffect, useRef, useState } from 'react';
import { combatDisplay, playbackCursor } from '../scene/combatPlayback';
import type { CombatStep, CombatTarget, EffectLog, GameState, Seat } from '../game/types';
import { STARTING_HP } from '../game/rules';

// Hook de lecture animée du combat (§7.2) : détecte un nouvel évènement `combat`, fait
// avancer un curseur de temps via requestAnimationFrame, et en dérive les surcharges
// d'affichage pour que LES DEUX clients rejouent la même animation.

export interface CombatView {
  defense: Map<string, number>;
  ko: Set<string>;
  hp: Record<Seat, number>;
  appliedEffects: EffectLog[];
  cycle: number;
  phase: 'melee' | 'breakthrough';
  complete: boolean;
  stalemate: boolean;
}

export interface ActiveCombatStep {
  key: number;
  attackerUid: string;
  target: CombatTarget;
  attackerSeat: Seat;
  effective: boolean; // coup augmenté par l'élément (animation « Efficace ! » sur la cible)
  retaliationEffective: boolean; // riposte augmentée (animation sur l'attaquant)
}

export interface CombatPlaybackResult {
  playing: boolean;
  combatView: CombatView | null;
  activeStep: ActiveCombatStep | null;
  displayedHp: Record<Seat, number>;
}

const DEFAULT_HP: Record<Seat, number> = { p1: STARTING_HP, p2: STARTING_HP };

export function useCombatPlayback(state: GameState): CombatPlaybackResult {
  const lastHandledIdRef = useRef<number | undefined>(undefined);
  const startedAtRef = useRef<number | null>(null);
  const stepsRef = useRef<CombatStep[]>([]);
  const attackerSeatRef = useRef<Seat>('p1');
  const hpBeforeRef = useRef<Record<Seat, number>>(DEFAULT_HP);
  const startEffectsRef = useRef<EffectLog[]>([]);
  const hpAfterStartRef = useRef<Record<Seat, number>>(DEFAULT_HP);
  const stalemateRef = useRef(false);
  const eventIdRef = useRef(0);
  const [, forceRender] = useState(0);

  const event = state.lastEvent;
  const currentId = event?.id ?? 0;

  // Détection d'un NOUVEL évènement `combat`, faite PENDANT le rendu (pas dans un effet) :
  // sur le rendu où l'évènement apparaît, `playing` doit déjà valoir `true` pour CE rendu.
  // Sinon, un autre effet du composant appelant lu juste après dans le même flush (le
  // déclenchement automatique de `beginTurn`, §7.4) lirait encore l'ancienne valeur de
  // `playing` (fausse) et enverrait `beginTurn` avant que la lecture ait eu la moindre
  // chance de démarrer. C'était le bug observé : seul le combat qui met fin à la partie (qui
  // ne change ni le tour ni la phase, donc ne déclenche pas `beginTurn`) avait le temps de
  // s'animer en entier ; tous les autres étaient interrompus dès la frame suivante. Muter des
  // refs pendant le rendu pour comparer avec le rendu précédent est un pattern reconnu par
  // React (cf. « storing information from previous renders ») tant que c'est idempotent —
  // c'est le cas ici : un même `currentId` ne redéclenche jamais la détection.
  if (lastHandledIdRef.current === undefined) {
    // Premier rendu : mémorise sans animer, sinon un rafraîchissement rejoue le combat (§12).
    lastHandledIdRef.current = currentId;
  } else if (currentId !== lastHandledIdRef.current) {
    lastHandledIdRef.current = currentId;
    if (event?.type === 'combat' && (event.steps.length > 0 || (event.startEffects?.length ?? 0) > 0)) {
      stepsRef.current = event.steps;
      attackerSeatRef.current = event.seat;
      hpBeforeRef.current = event.hpBefore;
      startEffectsRef.current = event.startEffects ?? [];
      hpAfterStartRef.current = event.hpAfterStart ?? event.hpBefore;
      stalemateRef.current = event.stalemate;
      eventIdRef.current = event.id;
      startedAtRef.current = performance.now();
    } else {
      // Un évènement d'un autre type pendant la lecture l'interrompt (léger décalage réseau
      // entre les deux clients, cas rare).
      startedAtRef.current = null;
    }
  }

  // Fait avancer la lecture : force un nouveau rendu à chaque frame tant qu'elle est en
  // cours, jusqu'à ce que `playbackCursor` indique qu'elle est terminée.
  useEffect(() => {
    if (startedAtRef.current === null) return;
    let raf: number;
    const tick = () => {
      const elapsed = performance.now() - (startedAtRef.current ?? 0);
      const cursor = playbackCursor(elapsed, stepsRef.current.length, startEffectsRef.current.length > 0);
      if (cursor.done) {
        startedAtRef.current = null;
      }
      forceRender((n) => n + 1);
      if (!cursor.done) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [currentId]);

  const baseHp: Record<Seat, number> = { p1: state.players.p1.hp, p2: state.players.p2.hp };

  if (startedAtRef.current === null) {
    return { playing: false, combatView: null, activeStep: null, displayedHp: baseHp };
  }

  const elapsed = performance.now() - startedAtRef.current;
  const cursor = playbackCursor(elapsed, stepsRef.current.length, startEffectsRef.current.length > 0);
  const view = combatDisplay(stepsRef.current, cursor.applied, hpBeforeRef.current, {
    effects: startEffectsRef.current,
    hp: hpAfterStartRef.current,
    applied: cursor.startApplied,
  });
  const combatView: CombatView = { ...view, stalemate: stalemateRef.current };

  const lungeStep = cursor.lungeIndex !== null ? stepsRef.current[cursor.lungeIndex] : null;
  const activeStep: ActiveCombatStep | null =
    lungeStep && cursor.lungeIndex !== null
      ? {
          key: eventIdRef.current * 100 + cursor.lungeIndex,
          attackerUid: lungeStep.attackerUid,
          target: lungeStep.target,
          attackerSeat: attackerSeatRef.current,
          // `?? false` : un évènement de combat écrit avant cette fonctionnalité n'a pas ces champs.
          effective: lungeStep.effective ?? false,
          retaliationEffective: lungeStep.retaliationEffective ?? false,
        }
      : null;

  return { playing: true, combatView, activeStep, displayedHp: combatView.hp };
}
