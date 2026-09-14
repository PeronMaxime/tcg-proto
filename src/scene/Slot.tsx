import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Zone } from '../game/types';
import type { Pose } from './layout';
import { theme } from './theme';

// Emplacement d'une zone : toujours affiché (même vide), pas une carte — ne fait pas partie
// de la liste plate D6. Un plan fin juste au-dessus de la table (§6.2), avec un halo pulsé
// quand il est une cible légale pour la carte en cours de glisser-déposer, plein quand
// c'est l'emplacement survolé.

interface SlotProps {
  pose: Pose;
  zone: Zone;
  highlighted: boolean;
  hovered: boolean;
  // Vrai quand le marché est masqué : le plateau passe alors à un éclairage plus clair
  // (demande utilisateur), donc les emplacements suivent avec une teinte/opacité plus vive.
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

function outlineTexture(color: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
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
function getOutlineTexture(color: string): THREE.CanvasTexture {
  let cached = cachedOutlines.get(color);
  if (!cached) {
    cached = outlineTexture(color);
    cachedOutlines.set(color, cached);
  }
  return cached;
}

function Slot({ pose, zone, highlighted, hovered, bright }: SlotProps) {
  const { width, height } = theme.card;
  const outlineColor = bright ? theme.colors.zoneOutlineBright : theme.colors.zoneOutline;
  const outlineMap = useMemo(() => getOutlineTexture(outlineColor), [outlineColor]);
  const haloRef = useRef<THREE.MeshBasicMaterial>(null!);

  useFrame(() => {
    if (!haloRef.current) return;
    const pulse = 0.35 + Math.sin(performance.now() / 200) * 0.15;
    haloRef.current.opacity = hovered ? 0.9 : highlighted ? pulse : 0;
  });

  return (
    <group position={[pose.position[0], 0.005, pose.position[2]]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh>
        <planeGeometry args={[width * 0.72 + 0.08, height * 0.72 + 0.08]} />
        <meshBasicMaterial
          color={bright ? ZONE_COLOR_BRIGHT[zone] : ZONE_COLOR[zone]}
          map={outlineMap}
          transparent
          opacity={bright ? 0.8 : 0.55}
        />
      </mesh>
      <mesh position={[0, 0, 0.001]}>
        <planeGeometry args={[width * 0.72 + 0.2, height * 0.72 + 0.2]} />
        <meshBasicMaterial ref={haloRef} color={theme.colors.haloPlayable} transparent opacity={0} />
      </mesh>
    </group>
  );
}

export default Slot;
