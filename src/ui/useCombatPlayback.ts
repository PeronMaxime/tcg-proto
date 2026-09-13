import { useEffect, useRef, useState } from 'react';
import { combatDisplay, playbackCursor } from '../scene/combatPlayback';
import type { CombatStep, CombatTarget, GameState, Seat } from '../game/types';
import { opponentOf } from '../game/rules';

// Hook de lecture animée du combat (§7.2) : détecte un nouvel évènement `combat`, fait
// avancer un curseur de temps via requestAnimationFrame, et en dérive les surcharges
// d'affichage pour que LES DEUX clients rejouent la même animation.

export interface CombatView {
  defense: Map<string, number>;
  ko: Set<string>;
  pendingPlayerDamage: number;
}

export interface ActiveCombatStep {
  key: number;
  attackerUid: string;
  target: CombatTarget;
  attackerSeat: Seat;
}

export interface CombatPlaybackResult {
  playing: boolean;
  combatView: CombatView | null;
  activeStep: ActiveCombatStep | null;
  displayedHp: Record<Seat, number>;
}

export function useCombatPlayback(state: GameState): CombatPlaybackResult {
  const lastHandledIdRef = useRef<number | undefined>(undefined);
  const startedAtRef = useRef(0);
  const stepsRef = useRef<CombatStep[]>([]);
  const attackerSeatRef = useRef<Seat>('p1');
  const eventIdRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [, forceRender] = useState(0);

  // Détecte un NOUVEL évènement `combat` (id différent du dernier traité). Au premier
  // rendu, mémorise l'id sans animer : un rafraîchissement ne rejoue pas le combat (§12).
  useEffect(() => {
    const event = state.lastEvent;
    const currentId = event?.id ?? 0;

    if (lastHandledIdRef.current === undefined) {
      lastHandledIdRef.current = currentId;
      return;
    }
    if (currentId === lastHandledIdRef.current) return;
    lastHandledIdRef.current = currentId;

    if (event?.type === 'combat' && event.steps.length > 0) {
      stepsRef.current = event.steps;
      attackerSeatRef.current = event.seat;
      eventIdRef.current = event.id;
      startedAtRef.current = performance.now();
      setPlaying(true);
    } else {
      // Un évènement d'un autre type pendant la lecture l'interrompt (léger décalage
      // réseau entre les deux clients, cas rare).
      setPlaying(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.lastEvent]);

  useEffect(() => {
    if (!playing) return;
    let raf: number;
    const tick = () => {
      const elapsed = performance.now() - startedAtRef.current;
      const cursor = playbackCursor(elapsed, stepsRef.current.length);
      if (cursor.done) {
        setPlaying(false);
        return;
      }
      forceRender((n) => n + 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const baseHp: Record<Seat, number> = { p1: state.players.p1.hp, p2: state.players.p2.hp };

  if (!playing) {
    return { playing: false, combatView: null, activeStep: null, displayedHp: baseHp };
  }

  const elapsed = performance.now() - startedAtRef.current;
  const cursor = playbackCursor(elapsed, stepsRef.current.length);
  const view = combatDisplay(stepsRef.current, cursor.applied);
  const defenderSeat = opponentOf(attackerSeatRef.current);

  const displayedHp: Record<Seat, number> = {
    ...baseHp,
    [defenderSeat]: baseHp[defenderSeat] + view.pendingPlayerDamage,
  };

  const activeStep: ActiveCombatStep | null =
    cursor.lungeIndex !== null
      ? {
          key: eventIdRef.current * 100 + cursor.lungeIndex,
          attackerUid: stepsRef.current[cursor.lungeIndex].attackerUid,
          target: stepsRef.current[cursor.lungeIndex].target,
          attackerSeat: attackerSeatRef.current,
        }
      : null;

  return { playing: true, combatView: view, activeStep, displayedHp };
}
