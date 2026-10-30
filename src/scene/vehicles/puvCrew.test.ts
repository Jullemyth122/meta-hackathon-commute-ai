import { describe, expect, it } from 'vitest';
import {
  newRiderPose,
  type RiderMotion,
  type RiderPose,
  type Seat,
} from '@/core/people/riderMotion';
import { VEHICLES, type VehicleKind } from '@/core/vehicles/specs';
import { WALL } from './bodyKit';
import { puvLayout } from './puvCrew';

const KINDS: VehicleKind[] = ['modern', 'uv', 'bus'];

/** Where a seat's cushion is (x0..x1, z0..z1), from where its sitter sits. */
function cushion(seat: Seat, halfW: number): [number, number, number, number] {
  if (seat.standX !== undefined)
    return [seat.x - 0.13, seat.x + 0.33, seat.z - 0.19, seat.z + 0.19];
  const inner = halfW - WALL;
  const z0 = Math.sign(seat.z) * (inner - 0.44);
  const z1 = Math.sign(seat.z) * inner;
  return [seat.x - 0.19, seat.x + 0.19, Math.min(z0, z1), Math.max(z0, z1)];
}

/** Every 1/30 s of a motion. */
function* poses(m: RiderMotion): Generator<RiderPose> {
  const p = newRiderPose();
  for (let t = 0; t <= m.duration + 1e-9; t += 1 / 30) yield m.poseAt(t, p);
  yield m.poseAt(m.duration, p);
}

describe('riders in a modern jeepney, UV Express and bus', () => {
  it.each(KINDS)('%s: every seat taken once, in an order that covers them all', (kind) => {
    const L = puvLayout(kind);
    expect(L.seats.length).toBe(VEHICLES[kind].seats);
    expect([...L.seatOrder].sort((a, b) => a - b)).toEqual(L.seats.map((_, i) => i));
  });

  it.each(KINDS)(
    '%s: in through the door to each seat and out again, never through a wall or another seat',
    { timeout: 60_000 },
    (kind) => {
      const S = VEHICLES[kind];
      const L = puvLayout(kind);
      const half = S.widthM / 2;
      const inner = half - WALL;
      const pads = L.seats.map((s) => cushion(s, half));
      const atDoor = (x: number) => S.doors.some((d) => x > d.x0 + 0.05 && x < d.x1 - 0.05);
      // Where the floor starts, in from the stairs (bodyKit: 0.28 m a step, 0.2 m rise at most).
      const floorEdge = Math.min(
        ...S.doors
          .filter((d) => d.opens !== 'hinged')
          .map((d) => inner - Math.max(1, Math.ceil((S.floorM - d.y0) / 0.2 - 0.01)) * 0.28),
      );
      const check = (m: RiderMotion, seat: number, what: string) => {
        let wasInside: boolean | null = null;
        for (const p of poses(m)) {
          const inside = L.isInside(p);
          // Into or out of the body only through a doorway.
          if (wasInside !== null && inside !== wasInside)
            expect(atDoor(p.x), `${what}: crossed the side at x ${p.x.toFixed(2)}`).toBe(true);
          wasInside = inside;
          // Never out through the other side, nor ahead of or behind the body.
          expect(p.z, what).toBeGreaterThan(-inner);
          if (inside) {
            expect(p.x, what).toBeGreaterThan(-S.lengthM / 2 + 0.2);
            expect(p.x, what).toBeLessThan(S.lengthM / 2 - 0.2);
          }
          // Walking inside, in from the stair wells: on the floor (never sunk
          // into it); and, on their feet, on no one's seat.
          if (inside && p.walk === 1 && Math.abs(p.z) < floorEdge - 0.05)
            expect(p.y, `${what}: below the floor`).toBeCloseTo(S.floorM, 3);
          if (inside && p.sit < 0.05)
            pads.forEach((c, k) => {
              if (k === seat) return;
              const on = p.x > c[0] && p.x < c[1] && p.z > c[2] && p.z < c[3];
              expect(
                on,
                `${what}: stood on seat ${k} at (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`,
              ).toBe(false);
            });
        }
      };
      L.seats.forEach((_, k) => {
        const door = S.doors[0]!;
        // From behind the door and from ahead of it, on the pavement.
        for (const start of [
          [door.x0 - 3, 0, half + 1.4],
          [door.x1 + 3, 0, half + 0.8],
        ] as const) {
          const board = L.board(k, start);
          check(board, k, `${kind} seat ${k} in`);
          const end = board.poseAt(board.duration, newRiderPose());
          const sat = L.seated(k, newRiderPose());
          expect(Math.hypot(end.x - sat.x, end.y - sat.y, end.z - sat.z)).toBeLessThan(0.01);
          expect(end.sit).toBe(1);
          expect(L.isInside(end)).toBe(true);
        }
        const off = L.alight(k);
        check(off, k, `${kind} seat ${k} out`);
        const first = off.poseAt(0, newRiderPose());
        const sat = L.seated(k, newRiderPose());
        expect(Math.hypot(first.x - sat.x, first.y - sat.y, first.z - sat.z)).toBeLessThan(0.01);
        const last = off.poseAt(off.duration, newRiderPose());
        expect(last.y).toBe(0);
        expect(last.z).toBeGreaterThan(half);
        expect(L.isInside(last)).toBe(false);
      });
    },
  );

  it('UV Express: getting in is a squeeze, harder and slower than a bus', () => {
    const uv = puvLayout('uv');
    const bus = puvLayout('bus');
    const crouch = (m: RiderMotion) => {
      let lowest = 1;
      let lean = 0;
      for (const p of poses(m)) {
        if (p.sit > 0.05) continue;
        lowest = Math.min(lowest, p.stoop);
        lean = Math.max(lean, p.lean);
      }
      return { lowest, lean };
    };
    const back = uv.seatOrder[0]!; // the back row, the far seat
    const van = crouch(uv.board(back, [-3, 0, 2]));
    const coach = crouch(bus.board(bus.seatOrder[0]!, [2, 0, 2.2]));
    expect(van.lowest).toBeLessThan(0.8);
    expect(van.lean).toBeGreaterThan(0.3);
    expect(coach.lowest).toBeGreaterThan(0.95);
    // Metres of cabin per second: a van's riders creep along.
    expect(VEHICLES.uv.lengthM / uv.board(back, [-3, 0, 2]).duration).toBeLessThan(
      VEHICLES.bus.lengthM / bus.board(bus.seatOrder[0]!, [2, 0, 2.2]).duration,
    );
  });
});
