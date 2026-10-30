/**
 * Text labels pinned to 3D points (place names, stop names).
 *
 * Plain DOM spans over the canvas, positioned once per frame. drei's <Text>
 * patches shaders and does not work with WebGPU, and one <Html> component per
 * label would mean one React subtree each; this is one loop over an array.
 *
 * Each kind has a maximum camera distance, so zooming out leaves only the big
 * names (districts, terminals) and zooming in reveals the small ones.
 */

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { Vector3 } from 'three';
import { viewScale } from './viewScale';

export interface SceneLabel {
  text: string;
  /** Styling and visibility class, e.g. 'suburb', 'quarter', 'stop', 'terminal'. */
  kind: string;
  x: number;
  y: number;
  z: number;
  /** Lift with the symbol it names (stop pins grow when zoomed out). */
  scaleWithView?: boolean;
  /** Shown instead of hiding beyond the kind's distance (⛽ for a gas station). */
  farText?: string;
  /** Background colour (a gas station's brand). */
  tone?: string;
}

/** Hide a label beyond this camera distance (metres). */
const MAX_DISTANCE: Record<string, number> = {
  'demand-stop': 3_000,
  'incoming-rider': 1_200,
  'passenger-area': 100,
  /** A planned trip (TripPlanLayer.tsx): its ends and stops from anywhere, its ways closer. */
  'trip-from': 60_000,
  'trip-to': 60_000,
  'trip-board': 60_000,
  'trip-alight': 60_000,
  'trip-way': 15_000,
  /** Beyond this a gas station is just its ⛽ (farText), visible at any distance. */
  fuel: 2_500,
  'fuel-across': 2_500,
  terminal: 15_000,
  city: 12_000,
  town: 9_000,
  suburb: 6_000,
  stop: 2_500,
  village: 2_500,
  quarter: 1_800,
};

/** Beyond this even a short form (⛽) hides: from over Metro Manila they are only clutter. */
const FAR_TEXT_MAX_M = 12_000;

export function Labels({
  labels,
  hidden = false,
}: {
  labels: readonly SceneLabel[];
  /** Hide all labels (e.g. inside a jeepney, where they would float through walls). */
  hidden?: boolean;
}) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  const container = useMemo(() => {
    const div = document.createElement('div');
    div.className = 'scene-labels';
    return div;
  }, []);

  useEffect(() => {
    gl.domElement.parentElement?.appendChild(container);
    return () => container.remove();
  }, [gl, container]);

  const nodes = useMemo(
    () =>
      labels.map((l) => {
        const el = document.createElement('span');
        el.className = `scene-label scene-label--${l.kind}`;
        el.textContent = l.text;
        el.hidden = true;
        if (l.tone) el.style.background = l.tone;
        return el;
      }),
    [labels],
  );

  useEffect(() => container.replaceChildren(...nodes), [container, nodes]);
  useEffect(() => {
    container.hidden = hidden;
  }, [container, hidden]);

  const v = useMemo(() => new Vector3(), []);

  useFrame((state) => {
    camera.updateMatrixWorld();
    const k = viewScale(state);
    for (let i = 0; i < labels.length; i++) {
      const l = labels[i]!;
      const el = nodes[i]!;
      v.set(l.x, l.scaleWithView ? l.y * k : l.y, l.z);
      const distance = v.distanceTo(camera.position);
      const far = distance > (MAX_DISTANCE[l.kind] ?? 3_000);
      const gone = far && (!l.farText || distance > FAR_TEXT_MAX_M);
      // Far away, a label with a short form shrinks to it instead of vanishing.
      if (l.farText) {
        const text = far ? l.farText : l.text;
        if (el.textContent !== text) el.textContent = text;
      }
      v.project(camera);
      // z > 1: behind the camera. |x|,|y| > 1: off screen.
      const hidden = gone || v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05;
      if (el.hidden !== hidden) el.hidden = hidden;
      if (hidden) continue;
      const px = (v.x * 0.5 + 0.5) * size.width;
      const py = (-v.y * 0.5 + 0.5) * size.height;
      el.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) translate(-50%, -100%)`;
    }
  });

  return null;
}
