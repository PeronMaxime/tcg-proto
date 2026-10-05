import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import * as THREE from 'three';
import { computeView } from './layout';

// `@react-three/drei` n'est pas utilisé (D4) : on positionne la caméra à la main. Le cadrage
// (`computeView`) se recalcule à chaque changement de taille du canvas, y compris quand on
// tourne l'écran en cours de partie, pour que le plateau remplisse toujours l'écran.
function CameraRig() {
  const { camera } = useThree();
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);

  useEffect(() => {
    const { framing } = computeView(width, height);
    camera.position.set(...framing.position);
    camera.lookAt(...framing.lookAt);
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = framing.fov;
      camera.updateProjectionMatrix();
    }
  }, [camera, width, height]);

  return null;
}

export default CameraRig;
