import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Zone } from '../game/types';
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
  // (demande utilisateur), donc les rangées suivent avec une teinte/opacité plus vive.
  bright: boolean;
}

const ZONE_COLOR: Record<Zone, string> = {
  attack: theme.colors.zoneAttack,
  defense: theme.colors.zoneDefense,
  enchant: theme.colors.zoneEnchant,
};

const ZONE_COLOR_BRIGHT: Record<Zone, string> = {
  attack: theme.colors.zoneAttackBright,
  defense: theme.colors.zoneDefenseBright,
  enchant: theme.colors.zoneEnchantBright,
};

// Contour dessiné à la proportion du rectangle (`aspect` = largeur / hauteur), pour que le
// trait garde la même épaisseur sur les côtés et en haut/bas une fois la texture étirée.
function outlineTexture(color: string, aspect: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(128 * aspect);
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, canvas.width - 12, canvas.height - 12);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const cachedOutlines = new Map<string, THREE.CanvasTexture>();
function getOutlineTexture(color: string, aspect: number): THREE.CanvasTexture {
  const key = `${color}-${aspect.toFixed(3)}`;
  let cached = cachedOutlines.get(key);
  if (!cached) {
    cached = outlineTexture(color, aspect);
    cachedOutlines.set(key, cached);
  }
  return cached;
}

function ZoneRow({ center, halfW, zone, highlighted, ghostX, bright }: ZoneRowProps) {
  const { width, height } = theme.card;
  const bandW = halfW * 2;
  const bandH = height * 0.72 + 0.08;
  const outlineColor = bright ? theme.colors.zoneOutlineBright : theme.colors.zoneOutline;
  const outlineMap = useMemo(() => getOutlineTexture(outlineColor, bandW / bandH), [outlineColor, bandW, bandH]);
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
          color={bright ? ZONE_COLOR_BRIGHT[zone] : ZONE_COLOR[zone]}
          map={outlineMap}
          transparent
          opacity={bright ? 0.8 : 0.55}
        />
      </mesh>
      <mesh position={[0, 0, 0.001]}>
        <planeGeometry args={[bandW + 0.12, bandH + 0.12]} />
        <meshBasicMaterial ref={haloRef} color={theme.colors.haloPlayable} transparent opacity={0} />
      </mesh>
      {ghostX !== null && (
        <mesh position={[ghostX - center[0], 0, 0.002]}>
          <planeGeometry args={[width * 0.72 + 0.2, height * 0.72 + 0.2]} />
          <meshBasicMaterial color={theme.colors.haloPlayable} transparent opacity={0.9} />
        </mesh>
      )}
    </group>
  );
}

export default ZoneRow;
