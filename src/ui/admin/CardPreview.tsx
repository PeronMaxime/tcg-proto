import { useEffect, useRef } from 'react';
import { isMonster } from '../../game/cards';
import type { CardDef } from '../../game/types';
import { hasCardArt } from '../../scene/cardArt';
import { getCardFaceTexture } from '../../scene/textures';

// Aperçu de la face de la carte, exactement telle qu'elle sera vue en jeu. On réutilise le
// dessin de la scène 3D : `getCardFaceTexture` rend une texture Three.js dont l'image EST un
// canvas HTML, qu'il suffit de recopier ici. Aucun code de rendu en double, et le texte des
// capacités est donc forcément celui de la partie.
//
// Le cache de `textures.ts` est vidé par `applyCatalog` à chaque modification du brouillon
// (voir `useCatalogAdmin`), donc l'aperçu suit la saisie.

interface CardPreviewProps {
  def: CardDef;
  width?: number;
}

function CardPreview({ def, width = 210 }: CardPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const stats = isMonster(def)
      ? {
          attack: def.attack,
          defense: def.defense,
          attackTone: 'base' as const,
          defenseTone: 'base' as const,
          golden: false,
        }
      : null;
    const source = getCardFaceTexture(def, stats).image as HTMLCanvasElement;

    canvas.width = source.width;
    canvas.height = source.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0);
  }, [def]);

  return (
    <div className="admin-preview">
      <canvas ref={canvasRef} style={{ width, height: 'auto' }} />
      {!hasCardArt(def.id) && (
        <p className="admin-preview-note">
          Pas d’illustration pour « {def.id} » : seul le décor de l’élément est dessiné. Demande-moi
          une illustration pour cette carte et elle apparaîtra ici.
        </p>
      )}
    </div>
  );
}

export default CardPreview;
