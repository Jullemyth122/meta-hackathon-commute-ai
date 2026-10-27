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
}

/** Hide a label beyond this camera distance (metres). */
const MAX_DISTANCE: Record<string, number> = {
  'passenger-area': 100,
  terminal: Infinity,
  city: 12_000,
  town: 9_000,
  suburb: 6_000,
  stop: 2_500,
  village: 2_500,
  quarter: 1_800,
};

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
      const far = v.distanceTo(camera.position) > (MAX_DISTANCE[l.kind] ?? 3_000);
      v.project(camera);
      // z > 1: behind the camera. |x|,|y| > 1: off screen.
      const hidden = far || v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05;
      if (el.hidden !== hidden) el.hidden = hidden;
      if (hidden) continue;
      const px = (v.x * 0.5 + 0.5) * size.width;
      const py = (-v.y * 0.5 + 0.5) * size.height;
      el.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) translate(-50%, -100%)`;
    }
  });

  return null;
}
