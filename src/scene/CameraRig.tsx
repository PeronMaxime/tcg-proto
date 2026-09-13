import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { CAMERA } from './layout';

// `@react-three/drei` n'est pas utilisé (D4) : on positionne la caméra à la main.
function CameraRig() {
  const { camera } = useThree();

  useEffect(() => {
    camera.position.set(...CAMERA.position);
    camera.lookAt(...CAMERA.lookAt);
  }, [camera]);

  return null;
}

export default CameraRig;
