import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import * as THREE from 'three';
import { cameraFraming, isCompactViewport } from './layout';

// `@react-three/drei` n'est pas utilisé (D4) : on positionne la caméra à la main. Le cadrage
// change avec la hauteur du canvas (téléphone en paysage, voir `CAMERA_COMPACT`), y compris
// quand on tourne l'écran en cours de partie.
function CameraRig() {
  const { camera } = useThree();
  const compact = useThree((s) => isCompactViewport(s.size.height));

  useEffect(() => {
    const framing = cameraFraming(compact);
    camera.position.set(...framing.position);
    camera.lookAt(...framing.lookAt);
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = framing.fov;
      camera.updateProjectionMatrix();
    }
  }, [camera, compact]);

  return null;
}

export default CameraRig;
