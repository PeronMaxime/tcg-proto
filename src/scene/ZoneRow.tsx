import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Zone } from '../game/types';
import { BOARD_CARD_SCALE } from './layout';
import { theme } from './theme';

// Rangée d'une zone : toujours affichée (même vide), pas une carte — ne fait pas partie de
// la liste plate D6. Rangée compacte (demande utilisateur) : plus d'emplacements fixes, un
// seul fond fin juste au-dessus de la table (§6.2), à la taille de la zone pleine, avec un
// halo pulsé quand la carte en cours de glisser-déposer peut y être déposée, et un
// emplacement fantôme plein là où elle s'insérerait (entre deux cartes, ou à un bout).

interface ZoneRowProps {
  center: [number, number]; // x, z du centre de la rangée
  halfW: number; // demi-largeur de la rangée pleine
  zone: Zone;
  highlighted: boolean;
  // Abscisse de l'emplacement fantôme (position d'insertion survolée), absente sinon.
  ghostX: number | null;
  // Vrai quand le marché est masqué : le plateau passe alors à un éclairage plus clair
  // (demande utilisateur), donc les rangées suivent avec une opacité plus vive.
  bright: boolean;
}

const ZONE_COLOR: Record<Zone, string> = {
  attack: theme.colors.zoneAttack,
  defense: theme.colors.zoneDefense,
  enchant: theme.colors.zoneEnchant,
};

// Contour dessiné à la proportion du rectangle (`aspect` = largeur / hauteur), pour que le
// trait garde la même épaisseur sur les côtés et en haut/bas une fois la texture étirée.
// Peint en blanc : le matériau le teinte de la couleur de la zone.
function outlineTexture(aspect: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(160 * aspect);
  canvas.height = 160;
  const ctx = canvas.getContext('2d')!;
  // Fond à peine teinté, plus sombre au centre : un emplacement imprimé sur le feutre.
  const fill = ctx.createRadialGradient(
    canvas.width / 2,
    canvas.height / 2,
    0,
    canvas.width / 2,
    canvas.height / 2,
    canvas.width / 2,
  );
  fill.addColorStop(0, 'rgba(255, 255, 255, 0.16)');
  fill.addColorStop(1, 'rgba(255, 255, 255, 0.34)');
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(4, 4, canvas.width - 8, canvas.height - 8, 14);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.roundRect(5, 5, canvas.width - 10, canvas.height - 10, 13);
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const cachedOutlines = new Map<string, THREE.CanvasTexture>();
function getOutlineTexture(aspect: number): THREE.CanvasTexture {
  const key = aspect.toFixed(3);
  let cached = cachedOutlines.get(key);
  if (!cached) {
    cached = outlineTexture(aspect);
    cachedOutlines.set(key, cached);
  }
  return cached;
}

function ZoneRow({ center, halfW, zone, highlighted, ghostX, bright }: ZoneRowProps) {
  const { width, height } = theme.card;
  const bandW = halfW * 2;
  const bandH = height * BOARD_CARD_SCALE + 0.12;
  const outlineMap = useMemo(() => getOutlineTexture(bandW / bandH), [bandW, bandH]);
  const haloRef = useRef<THREE.MeshBasicMaterial>(null!);

  useFrame(() => {
    if (!haloRef.current) return;
    const pulse = 0.2 + Math.sin(performance.now() / 200) * 0.08;
    haloRef.current.opacity = highlighted ? pulse : 0;
  });

  return (
    <group position={[center[0], 0.005, center[1]]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh>
        <planeGeometry args={[bandW, bandH]} />
        <meshBasicMaterial
          color={ZONE_COLOR[zone]}
          map={outlineMap}
          transparent
          depthWrite={false}
          opacity={bright ? 0.85 : 0.65}
        />
      </mesh>
      <mesh position={[0, 0, 0.001]}>
        <planeGeometry args={[bandW + 0.12, bandH + 0.12]} />
        <meshBasicMaterial ref={haloRef} color={theme.colors.haloPlayable} transparent depthWrite={false} opacity={0} />
      </mesh>
      {ghostX !== null && (
        <mesh position={[ghostX - center[0], 0, 0.002]}>
          <planeGeometry args={[width * BOARD_CARD_SCALE + 0.16, height * BOARD_CARD_SCALE + 0.16]} />
          <meshBasicMaterial color={theme.colors.haloPlayable} transparent depthWrite={false} opacity={0.9} />
        </mesh>
      )}
    </group>
  );
}

export default ZoneRow;
