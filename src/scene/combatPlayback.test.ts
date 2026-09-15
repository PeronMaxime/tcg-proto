import { describe, expect, it } from 'vitest';
import {
  combatDisplay,
  END_PAUSE_MS,
  IMPACT_MS,
  playbackCursor,
  START_DELAY_MS,
  STEP_MS,
} from './combatPlayback';
import type { CombatStep, Seat } from '../game/types';

describe('playbackCursor', () => {
  it('est terminé immédiatement pour zéro coup', () => {
    expect(playbackCursor(0, 0)).toEqual({ lungeIndex: null, applied: 0, done: true });
    expect(playbackCursor(99999, 0)).toEqual({ lungeIndex: null, applied: 0, done: true });
  });

  it("rien n'est appliqué avant le délai de départ", () => {
    const cursor = playbackCursor(START_DELAY_MS - 1, 2);
    expect(cursor).toEqual({ lungeIndex: null, applied: 0, done: false });
  });

  it('la fente du 1er coup démarre juste après le délai de départ', () => {
    const cursor = playbackCursor(START_DELAY_MS + 1, 2);
    expect(cursor.lungeIndex).toBe(0);
    expect(cursor.applied).toBe(0);
    expect(cursor.done).toBe(false);
  });

  it("l'impact du 1er coup s'applique après IMPACT_MS", () => {
    const cursor = playbackCursor(START_DELAY_MS + IMPACT_MS + 1, 2);
    expect(cursor.lungeIndex).toBe(0);
    expect(cursor.applied).toBe(1);
  });

  it('passe au 2e coup après STEP_MS', () => {
    const cursor = playbackCursor(START_DELAY_MS + STEP_MS + 1, 2);
    expect(cursor.lungeIndex).toBe(1);
    expect(cursor.applied).toBe(1);
  });

  it('est done après le dernier coup + la pause finale', () => {
    const almostDone = playbackCursor(START_DELAY_MS + 2 * STEP_MS + END_PAUSE_MS - 1, 2);
    expect(almostDone.done).toBe(false);
    expect(almostDone.applied).toBe(2);

    const done = playbackCursor(START_DELAY_MS + 2 * STEP_MS + END_PAUSE_MS + 1, 2);
    expect(done.done).toBe(true);
    expect(done.lungeIndex).toBeNull();
  });
});

describe('combatDisplay', () => {
  const hpBefore: Record<Seat, number> = { p1: 20, p2: 20 };

  function step(overrides: Partial<CombatStep> & Pick<CombatStep, 'attackerUid' | 'target'>): CombatStep {
    return {
      cycle: 1,
      damage: 1,
      remaining: 0,
      retaliation: 0,
      attackerRemaining: 5,
      effective: false,
      retaliationEffective: false,
      effects: [],
      hp: { p1: 20, p2: 20 },
      ...overrides,
    };
  }

  const steps: CombatStep[] = [
    step({
      attackerUid: 'a1',
      target: { kind: 'monster', uid: 'd1' },
      damage: 1,
      remaining: 1,
      retaliation: 2,
      attackerRemaining: 3,
      hp: { p1: 20, p2: 20 },
    }),
    step({
      attackerUid: 'a2',
      target: { kind: 'monster', uid: 'd1' },
      damage: 1,
      remaining: 0,
      retaliation: 0,
      attackerRemaining: 5,
      hp: { p1: 20, p2: 20 },
    }),
    step({
      attackerUid: 'a3',
      target: { kind: 'player' },
      cycle: 2,
      damage: 3,
      remaining: 5,
      retaliation: 0,
      attackerRemaining: 5,
      hp: { p1: 20, p2: 17 },
    }),
  ];

  it('début : rien appliqué, PV = hpBefore', () => {
    const display = combatDisplay(steps, 0, hpBefore);
    expect(display.defense.size).toBe(0);
    expect(display.ko.size).toBe(0);
    expect(display.hp).toEqual(hpBefore);
    expect(display.appliedEffects).toEqual([]);
    expect(display.phase).toBe('melee');
  });

  it('milieu : blessure et riposte affichées, puis KO du défenseur', () => {
    const wounded = combatDisplay(steps, 1, hpBefore);
    expect(wounded.defense.get('d1')).toBe(1);
    expect(wounded.defense.get('a1')).toBe(3); // riposte : l'attaquant encaisse aussi (E13)
    expect(wounded.ko.has('d1')).toBe(false);
    expect(wounded.hp).toEqual(steps[0].hp);

    const koed = combatDisplay(steps, 2, hpBefore);
    expect(koed.defense.get('d1')).toBe(0);
    expect(koed.ko.has('d1')).toBe(true);
  });

  it('fin : tout appliqué, PV du joueur mis à jour, phase percée', () => {
    const display = combatDisplay(steps, 3, hpBefore);
    expect(display.hp).toEqual({ p1: 20, p2: 17 });
    expect(display.ko.has('d1')).toBe(true);
    expect(display.complete).toBe(true);
    expect(display.phase).toBe('breakthrough');
    expect(display.cycle).toBe(2);
  });

  it('zéro coup : displays vides, PV = hpBefore', () => {
    const display = combatDisplay([], 0, hpBefore);
    expect(display.defense.size).toBe(0);
    expect(display.ko.size).toBe(0);
    expect(display.hp).toEqual(hpBefore);
    expect(display.complete).toBe(true);
  });
});
