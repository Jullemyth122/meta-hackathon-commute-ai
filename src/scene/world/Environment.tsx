/**
 * Ground, sky light and a sun whose shadow box follows the camera target.
 * A route can be kilometres long; one shadow map that covered all of it would
 * be blurry. Covering ~160 m around what you are looking at stays sharp.
 *
 * Fog starts far out and only hides the edge of the world at the horizon;
 * the map itself should read clearly from the overview.
 */

import { useFrame, useThree } from '@react-three/fiber';
import { useLayoutEffect, useRef } from 'react';
import type { DirectionalLight } from 'three';
import { LAND_COLOR } from '@/core/map/style';
import { FLAT_ORDER } from '../map/flatLayers';

const SHADOW_HALF_EXTENT = 80;
const SUN_OFFSET: [number, number, number] = [60, 120, 45];
const SKY = '#dbe5ec';

export function Environment({ groundSize = 40_000 }: { groundSize?: number }) {
  const sun = useRef<DirectionalLight>(null);
  const controls = useThree((s) => s.controls) as {
    target?: { x: number; y: number; z: number };
  } | null;

  useLayoutEffect(() => {
    const light = sun.current;
    if (!light) return;
    const cam = light.shadow.camera;
    cam.left = -SHADOW_HALF_EXTENT;
    cam.right = SHADOW_HALF_EXTENT;
    cam.top = SHADOW_HALF_EXTENT;
    cam.bottom = -SHADOW_HALF_EXTENT;
    cam.near = 1;
    cam.far = 400;
    cam.updateProjectionMatrix();
    light.shadow.mapSize.set(2048, 2048);
    light.shadow.bias = -0.0003;
    light.shadow.normalBias = 0.04;
  }, []);

  useFrame(() => {
    const light = sun.current;
    const t = controls?.target;
    if (!light || !t) return;
    light.position.set(t.x + SUN_OFFSET[0], t.y + SUN_OFFSET[1], t.z + SUN_OFFSET[2]);
    light.target.position.set(t.x, t.y, t.z);
    light.target.updateMatrixWorld();
  });

  return (
    <>
      <color attach="background" args={[SKY]} />
      <fog attach="fog" args={[SKY, 2_500, 14_000]} />
      {/* Sky + sun add up to ~1.2× on flat ground: bright, without clipping light
          map colours to white (which is what made the first version look blank). */}
      <hemisphereLight args={['#ffffff', '#c9c0ae', 0.8]} />
      <directionalLight ref={sun} intensity={1.15} castShadow />
      <mesh rotation-x={-Math.PI / 2} renderOrder={FLAT_ORDER.ground} receiveShadow>
        <planeGeometry args={[groundSize, groundSize]} />
        <meshLambertMaterial color={LAND_COLOR} depthTest={false} depthWrite={false} />
      </mesh>
    </>
  );
}
