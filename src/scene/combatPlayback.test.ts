import { describe, expect, it } from 'vitest';
import {
  combatDisplay,
  END_PAUSE_MS,
  IMPACT_MS,
  playbackCursor,
  START_DELAY_MS,
  STEP_MS,
} from './combatPlayback';
import type { CombatStep } from '../game/types';

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
  const steps: CombatStep[] = [
    { attackerUid: 'a1', target: { kind: 'monster', uid: 'd1' }, damage: 1, remaining: 1 },
    { attackerUid: 'a2', target: { kind: 'monster', uid: 'd1' }, damage: 1, remaining: 0 },
    { attackerUid: 'a3', target: { kind: 'player' }, damage: 3, remaining: 5 },
  ];

  it('début : rien appliqué', () => {
    const display = combatDisplay(steps, 0);
    expect(display.defense.size).toBe(0);
    expect(display.ko.size).toBe(0);
    expect(display.pendingPlayerDamage).toBe(3);
  });

  it('milieu : blessure affichée puis KO du même défenseur', () => {
    const wounded = combatDisplay(steps, 1);
    expect(wounded.defense.get('d1')).toBe(1);
    expect(wounded.ko.has('d1')).toBe(false);

    const koed = combatDisplay(steps, 2);
    expect(koed.defense.get('d1')).toBe(0);
    expect(koed.ko.has('d1')).toBe(true);
  });

  it('fin : tout appliqué, plus de dégâts en attente', () => {
    const display = combatDisplay(steps, 3);
    expect(display.pendingPlayerDamage).toBe(0);
    expect(display.ko.has('d1')).toBe(true);
  });

  it('zéro coup : displays vides', () => {
    const display = combatDisplay([], 0);
    expect(display.defense.size).toBe(0);
    expect(display.ko.size).toBe(0);
    expect(display.pendingPlayerDamage).toBe(0);
  });
});
