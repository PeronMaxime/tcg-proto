import { describe, expect, it } from 'vitest';
import { DEFAULT_CATALOG } from '../game/defaultCatalog';
import { drawCardArt, hasCardArt } from './cardArt';

// Garde-fou : une carte ajoutée au catalogue sans silhouette n'affichait qu'un décor vide,
// sans que rien ne le signale (c'est arrivé aux cartes à habileté de la v12). Ce test ne
// juge pas le dessin, seulement qu'il existe et qu'il s'exécute sans erreur — les tracés
// sont rejoués sur un contexte 2D factice, `node` n'ayant pas de canvas.

// Contexte 2D minimal : chaque méthode utilisée par cardArt.ts est un enregistreur muet.
function fakeContext(): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => {} };
  const noop = () => {};
  return {
    save: noop,
    restore: noop,
    translate: noop,
    scale: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    arcTo: noop,
    ellipse: noop,
    quadraticCurveTo: noop,
    bezierCurveTo: noop,
    roundRect: noop,
    fill: noop,
    stroke: noop,
    fillRect: noop,
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
  } as unknown as CanvasRenderingContext2D;
}

describe('illustrations des cartes', () => {
  it('chaque carte du catalogue a sa propre illustration', () => {
    const missing = DEFAULT_CATALOG.cards.filter((def) => !hasCardArt(def.id)).map((def) => def.id);
    expect(missing).toEqual([]);
  });

  it('chaque illustration se dessine sans erreur', () => {
    for (const def of DEFAULT_CATALOG.cards) {
      expect(() => drawCardArt(fakeContext(), def.id, def.element, 0, 0)).not.toThrow();
    }
  });
});
