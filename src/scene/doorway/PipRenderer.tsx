/**
 * Takes over rendering for the doorway lab (useFrame priority 1):
 *
 *   1. ESP32 camera  → 320×240 render target (exactly a QVGA frame)
 *   2. main camera   → screen
 *   3. HUD pass      → the QVGA frame drawn as a picture-in-picture quad
 *
 * The PiP goes through a render target rather than a scissored viewport on
 * purpose: on WebGPU a viewport clear can wipe the whole framebuffer, while a
 * render target behaves the same on both backends.
 *
 * The box/centroid overlay is HTML canvas on top (ui/PipOverlay.tsx); both use
 * PIP_LAYOUT so they line up.
 *
 * Orientation: the WebGL2 backend flips render-target textures when they are
 * sampled; the WebGPU backend does not (a WebGPU texture's first row is the
 * top). So on WebGPU the quad's v coordinate is flipped here, or the camera
 * frame shows upside down and the detection boxes miss the people.
 */

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import {
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  RenderTarget,
  Scene,
  type PerspectiveCamera,
} from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { FRAME_H, FRAME_W } from '@/core/doorway/pipeline';

/** Where the PiP sits, in CSS pixels from the bottom-right of the canvas. */
export const PIP_LAYOUT = { margin: 16, maxScale: 1, maxWidthFraction: 0.46 } as const;

/** PiP size for a canvas width. It is anchored `margin` px from the bottom-right corner. */
export function pipSize(canvasW: number): { w: number; h: number } {
  const scale = Math.min(PIP_LAYOUT.maxScale, (canvasW * PIP_LAYOUT.maxWidthFraction) / FRAME_W);
  return { w: FRAME_W * scale, h: FRAME_H * scale };
}

export function PipRenderer({ espCamera }: { espCamera: PerspectiveCamera }) {
  const size = useThree((s) => s.size);
  const renderer = useThree((s) => s.gl) as unknown as WebGPURenderer;

  const hud = useMemo(() => {
    const target = new RenderTarget(FRAME_W, FRAME_H, { samples: 1 });
    const scene = new Scene();
    const camera = new OrthographicCamera(0, 1, 1, 0, -1, 1);
    const quad = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({
        map: target.texture,
        toneMapped: false,
        depthTest: false,
        depthWrite: false,
      }),
    );
    scene.add(quad);
    // The plane's original v coordinates (bottom row 0, top row 1).
    const uv = quad.geometry.getAttribute('uv');
    const baseV = Array.from({ length: uv.count }, (_, i) => uv.getY(i));
    return { target, scene, camera, quad, baseV };
  }, []);

  // Set (not toggle) the orientation, so running this twice is harmless.
  useEffect(() => {
    const webgpu = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
    const uv = hud.quad.geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setY(i, webgpu ? 1 - hud.baseV[i]! : hud.baseV[i]!);
    uv.needsUpdate = true;
  }, [renderer, hud]);

  // Pixel-space HUD camera: (0, 0) is the canvas's bottom-left corner.
  useEffect(() => {
    const { camera, quad } = hud;
    camera.left = 0;
    camera.right = size.width;
    camera.top = size.height;
    camera.bottom = 0;
    camera.updateProjectionMatrix();
    const { w, h } = pipSize(size.width);
    const m = PIP_LAYOUT.margin;
    quad.scale.set(w, h, 1);
    quad.position.set(size.width - m - w / 2, m + h / 2, 0);
  }, [hud, size]);

  useEffect(
    () => () => {
      hud.target.dispose();
      hud.quad.geometry.dispose();
      (hud.quad.material as MeshBasicMaterial).dispose();
    },
    [hud],
  );

  useFrame(({ gl: glAny, scene, camera }) => {
    // R3F types `gl` as WebGLRenderer; Renderer.tsx actually gives us a WebGPURenderer.
    const gl = glAny as unknown as WebGPURenderer;
    // Reuse the main pass's 2048×2048 directional shadow map for the 320×240 PiP pass.
    const shadowMap = (gl as unknown as { shadowMap?: { autoUpdate: boolean } }).shadowMap;
    const prevAutoUpdate = shadowMap?.autoUpdate ?? true;
    if (shadowMap) shadowMap.autoUpdate = false;
    gl.setRenderTarget(hud.target);
    gl.render(scene, espCamera);
    if (shadowMap) shadowMap.autoUpdate = prevAutoUpdate;
    gl.setRenderTarget(null);
    gl.render(scene, camera);

    // Draw the PiP on top without clearing what is already on screen.
    // The quad ignores depth, so no depth clear is needed either.
    const autoClear = gl.autoClear;
    gl.autoClear = false;
    gl.render(hud.scene, hud.camera);
    gl.autoClear = autoClear;
  }, 1);

  return null;
}
