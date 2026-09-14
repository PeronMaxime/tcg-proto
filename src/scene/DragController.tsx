import { useThree } from '@react-three/fiber';
import { useEffect, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { ZONE_SIZES } from '../game/rules';
import type { Zone } from '../game/types';
import { slotPose } from './layout';
import { theme } from './theme';

// Glisser-déposer d'une carte de ma main (demande utilisateur : on pose une carte en la
// faisant glisser sur un emplacement, plus par clic). Monté uniquement pendant un drag :
// écoute le pointeur sur `window` (il peut passer au-dessus du HUD HTML), projette sa
// position sur la table pour faire suivre la carte et trouver l'emplacement visé, puis
// signale le dépôt au relâchement.

export type DropTarget = { kind: 'slot'; zone: Zone; slot: number } | { kind: 'fusion' };

export const DRAG_HEIGHT = 1.2; // hauteur de la carte tenue au-dessus de la table
const SLOT_Y = 0.03;
const HIT_MARGIN = 0.08; // tolérance autour d'un emplacement (reste < demi-espacement)

interface DragControllerProps {
  start: { x: number; y: number }; // position écran du pointeur au début du drag
  dragWorldRef: RefObject<THREE.Vector3 | null>; // lu par la carte tenue (Card)
  isLegalSlot: (zone: Zone, slot: number) => boolean;
  isOverFusionZone: (clientX: number, clientY: number) => boolean;
  onHover: (target: DropTarget | null) => void;
  onDrop: (target: DropTarget | null) => void;
}

function sameTarget(a: DropTarget | null, b: DropTarget | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === 'fusion' || b.kind === 'fusion') return a.kind === b.kind;
  return a.zone === b.zone && a.slot === b.slot;
}

function DragController(props: DragControllerProps) {
  const { camera, gl } = useThree();
  // Les callbacks changent à chaque rendu (état de jeu à jour) : on lit toujours les derniers.
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let current: DropTarget | null = null;

    function projectOnPlane(clientX: number, clientY: number, height: number): THREE.Vector3 | null {
      const rect = gl.domElement.getBoundingClientRect();
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -height);
      return raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    }

    function targetAt(clientX: number, clientY: number): DropTarget | null {
      const { isOverFusionZone, isLegalSlot } = latest.current;
      // La zone de fusion (surcouche HTML) passe avant les emplacements qu'elle recouvre.
      if (isOverFusionZone(clientX, clientY)) return { kind: 'fusion' };
      const hit = projectOnPlane(clientX, clientY, SLOT_Y);
      if (!hit) return null;
      for (const zone of ['attack', 'defense', 'enchant'] as Zone[]) {
        for (let slot = 0; slot < ZONE_SIZES[zone]; slot++) {
          const pose = slotPose(zone, slot, true);
          const halfW = (theme.card.width * pose.scale) / 2 + HIT_MARGIN;
          const halfH = (theme.card.height * pose.scale) / 2 + HIT_MARGIN;
          if (Math.abs(hit.x - pose.position[0]) <= halfW && Math.abs(hit.z - pose.position[2]) <= halfH) {
            return isLegalSlot(zone, slot) ? { kind: 'slot', zone, slot } : null;
          }
        }
      }
      return null;
    }

    function update(clientX: number, clientY: number) {
      latest.current.dragWorldRef.current = projectOnPlane(clientX, clientY, DRAG_HEIGHT);
      const target = targetAt(clientX, clientY);
      if (!sameTarget(target, current)) {
        current = target;
        latest.current.onHover(target);
      }
    }

    const onMove = (e: PointerEvent) => update(e.clientX, e.clientY);
    const onUp = (e: PointerEvent) => {
      update(e.clientX, e.clientY);
      stop();
      latest.current.onDrop(current);
    };
    const onCancel = () => {
      stop();
      latest.current.onDrop(null);
    };
    function stop() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      document.body.style.cursor = '';
    }

    update(latest.current.start.x, latest.current.start.y);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    document.body.style.cursor = 'grabbing';

    // La carte reste à sa dernière position tant que le composant est monté (le parent le
    // garde jusqu'à ce que l'action soit envoyée), puis rejoint sa pose normale.
    const dragWorldRef = latest.current.dragWorldRef;
    return () => {
      stop();
      dragWorldRef.current = null;
    };
  }, [camera, gl]);

  return null;
}

export default DragController;
