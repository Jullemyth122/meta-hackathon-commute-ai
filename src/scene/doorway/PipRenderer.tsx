/**
 * Takes over rendering when a camera inset is shown (useFrame priority 1):
 *
 *   1. ESP32 camera  → 320×240 render target (exactly a QVGA frame), at the
 *                      camera's own frame rate, not the screen's
 *   2. rear mirror   → render target, when riding in the front seat (optional)
 *   3. main camera   → screen
 *   4. HUD pass      → the frames drawn as quads: the camera picture-in-
 *                      picture bottom right, the mirror top centre
 *
 * The insets go through render targets rather than scissored viewports on
 * purpose: on WebGPU a viewport clear can wipe the whole framebuffer, while
 * a render target behaves the same on both backends.
 *
 * Each inset is a full extra render of the scene, so they are not redrawn
 * every screen frame: the ESP32 delivers ESP_FPS frames a second anyway, and
 * a mirror needs no more than MIRROR_FPS. On a 120 Hz screen that is most of
 * the cost of riding along saved.
 *
 * The box/centroid overlay is HTML canvas on top (ui/PipOverlay.tsx); both
 * use PIP_LAYOUT so they line up.
 *
 * Orientation: the WebGL2 backend flips render-target textures when they are
 * sampled; the WebGPU backend does not (a WebGPU texture's first row is the
 * top). So on WebGPU the quads' v coordinate is flipped here, or the camera
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
import { ESP32_HEAD_DETECTOR, FRAME_H, FRAME_W } from '@/core/doorway/pipeline';
import { poseAtScale, viewScale } from '../world/viewScale';

/** Where the PiP sits, in CSS pixels from the bottom-right of the canvas. */
export const PIP_LAYOUT = { margin: 16, maxScale: 1, maxWidthFraction: 0.46 } as const;

/**
 * The rear-view mirror: a wide strip at the top right, `top` px down so it
 * clears the camera toolbar, opposite the jeepney card on the left
 * (ui/ViewControls).
 */
export const MIRROR_LAYOUT = {
  top: 64,
  margin: 16,
  width: 480,
  height: 140,
  maxWidthFraction: 0.4,
} as const;

/** The ESP32 inset changes as often as the real camera's frames, no more. */
const ESP_FPS = ESP32_HEAD_DETECTOR.fps;
const MIRROR_FPS = 30;

/** PiP size for a canvas width. It is anchored `margin` px from the bottom-right corner. */
export function pipSize(canvasW: number): { w: number; h: number } {
  const scale = Math.min(PIP_LAYOUT.maxScale, (canvasW * PIP_LAYOUT.maxWidthFraction) / FRAME_W);
  return { w: FRAME_W * scale, h: FRAME_H * scale };
}

/** Mirror size for a canvas width. It is anchored `top` px down, `margin` px from the right. */
export function mirrorSize(canvasW: number): { w: number; h: number } {
  const w = Math.min(MIRROR_LAYOUT.width, canvasW * MIRROR_LAYOUT.maxWidthFraction);
  return { w, h: (w * MIRROR_LAYOUT.height) / MIRROR_LAYOUT.width };
}

/** A render target and the quad that shows it on the HUD. */
function inset(width: number, height: number) {
  const target = new RenderTarget(width, height, { samples: 1 });
  const quad = new Mesh(
    new PlaneGeometry(1, 1),
    new MeshBasicMaterial({
      map: target.texture,
      toneMapped: false,
      depthTest: false,
      depthWrite: false,
    }),
  );
  // The plane's original texture coordinates (bottom row v = 0, top row v = 1).
  const uv = quad.geometry.getAttribute('uv');
  const base = Array.from({ length: uv.count }, (_, i) => [uv.getX(i), uv.getY(i)] as const);
  return { target, quad, base, lastS: -Infinity };
}

export function PipRenderer({
  espCamera,
  mirrorCamera = null,
}: {
  espCamera: PerspectiveCamera;
  /** Looks back from the jeepney; shown as a mirror while set. */
  mirrorCamera?: PerspectiveCamera | null;
}) {
  const size = useThree((s) => s.size);
  const renderer = useThree((s) => s.gl) as unknown as WebGPURenderer;

  const hud = useMemo(() => {
    const scene = new Scene();
    const camera = new OrthographicCamera(0, 1, 1, 0, -1, 1);
    const esp = inset(FRAME_W, FRAME_H);
    const mirror = inset(MIRROR_LAYOUT.width * 1.5, MIRROR_LAYOUT.height * 1.5);
    scene.add(esp.quad, mirror.quad);
    return { scene, camera, esp, mirror };
  }, []);

  // Set (not toggle) the orientation, so running this twice is harmless. The
  // mirror is also flipped left to right: it is a mirror.
  useEffect(() => {
    const webgpu = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
    for (const [view, mirrored] of [
      [hud.esp, false],
      [hud.mirror, true],
    ] as const) {
      const uv = view.quad.geometry.getAttribute('uv');
      view.base.forEach(([u, v], i) => {
        uv.setXY(i, mirrored ? 1 - u : u, webgpu ? 1 - v : v);
      });
      uv.needsUpdate = true;
    }
  }, [renderer, hud]);

  // Pixel-space HUD camera: (0, 0) is the canvas's bottom-left corner.
  useEffect(() => {
    const { camera, esp, mirror } = hud;
    camera.left = 0;
    camera.right = size.width;
    camera.top = size.height;
    camera.bottom = 0;
    camera.updateProjectionMatrix();
    const pip = pipSize(size.width);
    esp.quad.scale.set(pip.w, pip.h, 1);
    esp.quad.position.set(
      size.width - PIP_LAYOUT.margin - pip.w / 2,
      PIP_LAYOUT.margin + pip.h / 2,
      0,
    );
    const m = mirrorSize(size.width);
    mirror.quad.scale.set(m.w, m.h, 1);
    mirror.quad.position.set(
      size.width - MIRROR_LAYOUT.margin - m.w / 2,
      size.height - MIRROR_LAYOUT.top - m.h / 2,
      0,
    );
  }, [hud, size]);

  useEffect(
    () => () => {
      for (const view of [hud.esp, hud.mirror]) {
        view.target.dispose();
        view.quad.geometry.dispose();
        (view.quad.material as MeshBasicMaterial).dispose();
      }
    },
    [hud],
  );

  useFrame((state) => {
    // R3F types `gl` as WebGLRenderer; Renderer.tsx actually gives us a WebGPURenderer.
    const gl = state.gl as unknown as WebGPURenderer;
    const { scene, camera } = state;
    const now = state.clock.elapsedTime;
    const espDue = now - hud.esp.lastS >= 1 / ESP_FPS;
    const mirrorDue = !!mirrorCamera && now - hud.mirror.lastS >= 1 / MIRROR_FPS;
    hud.mirror.quad.visible = !!mirrorCamera;

    if (espDue || mirrorDue) {
      // The insets stand for real cameras and mirrors: they see everything
      // at true size, not enlarged for the zoomed-out main view (see
      // world/viewScale.ts).
      const mainScale = viewScale(state);
      const rescaled = mainScale !== 1;
      if (rescaled) poseAtScale(1);
      // Reuse the main pass's directional shadow map for the small passes,
      // unless the scene was re-posed: then its shadows would come from the
      // enlarged jeepneys.
      const shadowMap = (gl as unknown as { shadowMap?: { autoUpdate: boolean } }).shadowMap;
      const prevAutoUpdate = shadowMap?.autoUpdate ?? true;
      if (shadowMap && !rescaled) shadowMap.autoUpdate = false;
      if (espDue) {
        gl.setRenderTarget(hud.esp.target);
        gl.render(scene, espCamera);
        hud.esp.lastS = now;
      }
      if (mirrorDue) {
        gl.setRenderTarget(hud.mirror.target);
        gl.render(scene, mirrorCamera!);
        hud.mirror.lastS = now;
      }
      if (shadowMap) shadowMap.autoUpdate = prevAutoUpdate;
      if (rescaled) poseAtScale(mainScale);
    }
    gl.setRenderTarget(null);
    gl.render(scene, camera);

    // Draw the insets on top without clearing what is already on screen.
    // The quads ignore depth, so no depth clear is needed either.
    const autoClear = gl.autoClear;
    gl.autoClear = false;
    gl.render(hud.scene, hud.camera);
    gl.autoClear = autoClear;
  }, 1);

  return null;
}
