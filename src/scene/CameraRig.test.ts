import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import type { RootState } from '@react-three/fiber';
import { Object3D, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { RuntimeContext } from '@/app/runtimeContext';
import { TwinRuntime } from '@/app/twinRuntime';
import { DoorwayRuntime } from '@/app/doorwayRuntime';
import { useApp } from '@/app/store';
import { syntheticDemoRoute } from '@/core/geo/routes';
import { CameraRig } from './CameraRig';
import { INSIDE_EYE, INSIDE_LOOK } from './cabinViews';
import { createCabinCamera } from './doorway/cabinCamera';
import { FRAME_ORDER } from './frameOrder';
import { fleetPose } from './world/lanes';

const harness = vi.hoisted(() => ({
  state: null as unknown as RootState,
  frames: [] as { priority: number; run: (state: RootState, dt: number) => void }[],
}));

vi.mock('@react-three/fiber', () => ({
  useThree: (selector: (state: RootState) => unknown) => selector(harness.state),
  useFrame: (run: (state: RootState, dt: number) => void, priority = 0) => {
    harness.frames.push({ run, priority });
  },
}));

// Server rendering registers the real rig callback without needing a GPU.
vi.mock('@/app/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/store')>();
  return {
    ...actual,
    useApp: Object.assign(
      (selector: (state: ReturnType<typeof actual.useApp.getState>) => unknown) =>
        selector(actual.useApp.getState()),
      actual.useApp,
    ),
  };
});

describe('moving cabin camera', () => {
  it.each([false, true])(
    'keeps cabin points fixed regardless of subscription order (%s)',
    (reverse) => {
      const twin = new TwinRuntime(syntheticDemoRoute());
      const camera = createCabinCamera();
      const controls = {
        target: new Vector3(),
        // Residual orbit motion must never be applied after the cabin mount.
        update: vi.fn(() => camera.position.addScalar(0.1)),
      };
      harness.state = { camera, controls } as unknown as RootState;
      harness.frames = [];
      useApp.setState({ follow: { kind: 'sim', index: 0, view: 'inside' } });
      renderToString(
        createElement(RuntimeContext.Provider, {
          value: { twin, doorway: new DoorwayRuntime() },
          children: createElement(CameraRig),
        }),
      );

      const points = [new Vector3(-3, 1.4, 0.7), new Vector3(-1, 2, -0.8)];
      // Where they appear from the inside-view eye on a jeepney at the origin.
      const eye = createCabinCamera();
      eye.position.copy(INSIDE_EYE);
      eye.lookAt(INSIDE_LOOK);
      eye.updateMatrixWorld();
      const expected = points.map((p) => p.clone().project(eye));
      const vehicle = new Object3D();
      const pose = { x: 0, z: 0, heading: 0 };
      let time = 0;
      harness.frames.push(
        { priority: FRAME_ORDER.simulation, run: (_, dt) => twin.step(dt, (time += dt * 1000)) },
        { priority: -1, run: () => controls.update() },
        {
          priority: 0,
          run: () => {
            fleetPose(twin.fleet, 0, pose);
            vehicle.position.set(pose.x, 0, pose.z);
            vehicle.rotation.set(0, pose.heading, 0);
            vehicle.updateMatrix();
          },
        },
      );
      if (reverse) harness.frames.reverse();
      harness.frames.sort((a, b) => a.priority - b.priority);

      // Variable 60/24/10/40 fps, including turns and stops on a winding route.
      for (let frame = 0; frame < 2400; frame++) {
        const dt = [1 / 60, 1 / 24, 0.1, 1 / 40][frame % 4]!;
        for (const callback of harness.frames) callback.run(harness.state, dt);
        for (const [i, point] of points.entries()) {
          const screen = point.clone().applyMatrix4(vehicle.matrix).project(camera);
          expect(Math.abs(screen.x - expected[i]!.x)).toBeLessThan(1e-7);
          expect(Math.abs(screen.y - expected[i]!.y)).toBeLessThan(1e-7);
        }
      }
      expect(controls.update).toHaveBeenCalledTimes(2400);
      useApp.setState({ follow: null });
    },
  );

  it('locks onto the cabin in outside view with zero velocity lag and preserves user orbit/zoom', () => {
    const twin = new TwinRuntime(syntheticDemoRoute());
    const camera = createCabinCamera();
    const controls = {
      target: new Vector3(),
      update: vi.fn(),
    };
    harness.state = { camera, controls } as unknown as RootState;
    harness.frames = [];
    useApp.setState({ follow: { kind: 'sim', index: 0, view: 'chase' } });
    renderToString(
      createElement(RuntimeContext.Provider, {
        value: { twin, doorway: new DoorwayRuntime() },
        children: createElement(CameraRig),
      }),
    );

    const pose = { x: 0, z: 0, heading: 0 };
    let time = 0;
    harness.frames.push(
      { priority: FRAME_ORDER.simulation, run: (_, dt) => twin.step(dt, (time += dt * 1000)) },
      { priority: -1, run: () => controls.update() },
    );
    harness.frames.sort((a, b) => a.priority - a.priority + (a.priority - b.priority));

    // Settle initial fly-in onto the jeepney cabin.
    for (let frame = 0; frame < 180; frame++) {
      for (const callback of harness.frames) callback.run(harness.state, 1 / 60);
    }

    // Place the camera at a custom close side-window inspection angle (2.2 m away).
    fleetPose(twin.fleet, 0, pose);
    const c0 = Math.cos(pose.heading);
    const s0 = Math.sin(pose.heading);
    const cabinX0 = pose.x - 0.5 * c0;
    const cabinZ0 = pose.z + 0.5 * s0;
    expect(Math.hypot(controls.target.x - cabinX0, controls.target.z - cabinZ0)).toBeLessThan(1e-3);
    expect(controls.target.y).toBeCloseTo(1.2, 3);

    camera.position.set(cabinX0 + s0 * 2.2, 1.35, cabinZ0 + c0 * 2.2);

    // Drive through stops and turns: distance to the cabin must stay exact (no velocity lag).
    for (let frame = 0; frame < 600; frame++) {
      for (const callback of harness.frames) callback.run(harness.state, 1 / 60);
      fleetPose(twin.fleet, 0, pose);
      const c = Math.cos(pose.heading);
      const s = Math.sin(pose.heading);
      const cabinX = pose.x - 0.5 * c;
      const cabinZ = pose.z + 0.5 * s;
      expect(Math.hypot(controls.target.x - cabinX, controls.target.z - cabinZ)).toBeLessThan(1e-5);
      expect(camera.position.distanceTo(controls.target)).toBeCloseTo(
        Math.hypot(2.2, 1.35 - 1.2),
        4,
      );
    }
    useApp.setState({ follow: null });
  });
});
