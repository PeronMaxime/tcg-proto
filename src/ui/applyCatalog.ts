import { setActiveCatalog } from '../game/cards';
import type { Catalog } from '../game/types';
import { invalidateCardTextures } from '../scene/textures';

// Installe un catalogue pour tout ce qui est rendu ensuite. Les deux gestes vont toujours
// ensemble : `setActiveCatalog` change ce que `getCardDef` renvoie, et le cache de faces de
// `textures.ts` est indexé par id de carte — sans l'invalidation, une carte renommée ou
// re-équilibrée garderait son ancienne image.
//
// Ce module vit dans `ui/` parce qu'il fait le pont entre la couche données (`game/`) et la
// scène (`scene/`) : `cards.ts` reste une brique pure, qui ne connaît pas Three.js.
export function applyCatalog(catalog: Catalog): void {
  setActiveCatalog(catalog);
  invalidateCardTextures();
}
