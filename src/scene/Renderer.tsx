/**
 * The R3F canvas, backed by three's WebGPURenderer.
 *
 * WebGPURenderer uses WebGPU when the browser has it and silently falls back
 * to WebGL2 when it does not, so this is safe on every phone and laptop.
 * Set VITE_RENDERER=webgl to force the WebGL2 backend (useful for comparing).
 *
 * Constraint that comes with WebGPU: only built-in / node materials. No
 * ShaderMaterial, no onBeforeCompile, which also rules out drei's <Text>
 * and anything else that patches shaders. Labels are HTML overlays instead.
 */

import { Canvas, extend, type ThreeToJSXElements } from '@react-three/fiber';
import type { ReactNode } from 'react';
import * as THREE from 'three/webgpu';
import { config } from '@/config';

declare module '@react-three/fiber' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ThreeElements extends ThreeToJSXElements<typeof THREE> {}
}
// Make every three/webgpu class available as a JSX element.
extend(THREE as unknown as Parameters<typeof extend>[0]);

interface Props {
  children: ReactNode;
  camera: { position: [number, number, number]; fov?: number; near?: number; far?: number };
  onBackend?: (backend: 'WebGPU' | 'WebGL2') => void;
  /**
   * The GPU dropped our device (driver reset, GPU memory pressure, many hot
   * reloads). Nothing draws after that, so the owner should remount us.
   */
  onLost?: (reason: string) => void;
}

export function Renderer({ children, camera, onBackend, onLost }: Props) {
  return (
    <Canvas
      shadows
      camera={{ fov: 42, near: 0.3, far: 6000, ...camera }}
      // Cap pixel ratio: 3× phones would quadruple fill cost for no visible gain.
      dpr={[1, 1.75]}
      gl={async (props) => {
        const renderer = new THREE.WebGPURenderer({
          ...(props as ConstructorParameters<typeof THREE.WebGPURenderer>[0]),
          antialias: true,
          forceWebGL: config.renderer === 'webgl',
          powerPreference: 'high-performance',
        });
        await renderer.init();
        renderer.onDeviceLost = (info) => {
          console.warn('GPU device lost:', info.message);
          onLost?.(info.message);
        };
        renderer.toneMapping = THREE.NeutralToneMapping;
        const isWebGPU =
          (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
        onBackend?.(isWebGPU ? 'WebGPU' : 'WebGL2');
        return renderer;
      }}
    >
      {children}
    </Canvas>
  );
}
