/**
 * The commuter's phone: which jeepney comes next and whether it has a seat,
 * which one takes you (first come, first served), when you get there, and
 * the fare. Plan a trip (where you are, where you are going: TripPlanner),
 * or be someone already in the twin; then the phone follows that rider.
 */

import { useRuntimes } from '@/app/runtimeContext';
import { useApp } from '@/app/store';
import { twinState } from '@/app/twinState';
import { commuterView, type CommuterView } from '@/core/advisory/commuter';
import { dispatch } from '@/core/advisory/dispatch';
import { plannerRequest } from '@/core/advisory/plannerSnapshot';
import { commuterScreen, voiceKeywords } from '@/core/advisory/screen';
import { stopsAhead, type Route } from '@/core/geo/routes';
import { PASSENGER_PHASE, passengerName } from '../PassengerPanel';
import { useTicker } from '../useTicker';
import { AskBox } from './AskBox';
import { clockIn, metres, minutes, peso } from './format';
import { PhoneFrame } from './PhoneFrame';
import { TripPlanner } from '../network/TripPlanner';
import { focusRoute, getNetwork, routeIndex, tripSummary } from '@/app/network';
import { useEffect, useState } from 'react';
import { discountedKind, RIDER_KIND_LABEL, type RiderKind } from '@/core/fare';
import { KIND_NAME } from '@/core/vehicles/specs';
import { kindOf } from '@/core/people/passengerSystem';

const SUGGESTIONS = ['When does my jeepney come?', 'Will it have a seat for me?'];
/** Riders offered in the "follow" list: those whose trip is still ahead. */
const arrivalTime = (s: number) => (s < 60 ? `${Math.max(1, Math.ceil(s))} sec` : minutes(s));

/** Who pays what: a discount group's fare, or the regular one. */
function fareLine(kind: RiderKind, fare: number, discounted: number): string {
  if (discountedKind(kind))
    return `${peso(discounted)} · ${RIDER_KIND_LABEL[kind].toLowerCase()}, 20% off (regular ${peso(fare)})`;
  if (kind === 'pregnant') return `${peso(fare)} · regular fare; ask for a priority seat`;
  return `${peso(fare)} · regular fare`;
}

/** Where you can ride to from `stop`: every stop up to the next terminal. */
function destinations(route: Route, stop: number): number[] {
  if (route.loop) return stopsAhead(route, stop, 1);
  return route.stops.map((_, i) => i).filter((i) => i !== stop);
}

/** Riders offered to be at once. */
const BE_LIST = 8;
/** Who to offer first: people at a stop, then on their way to one, then riding. */
const BE_ORDER = ['waiting', 'approaching', 'boarding', 'seated', 'alighting'];

/**
 * Someone already in the twin to be: every rider has an ID; pick one (or
 * find them by it) and this phone shows their trip, the camera on them.
 */
function BeSomeone() {
  const { twin } = useRuntimes();
  const setCommuter = useApp((s) => s.setCommuter);
  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();
  const stops = twin.route.stops;
  const people = [...twin.crew.passengers.values()]
    .filter((r) => BE_ORDER.includes(r.phase))
    .filter((r) => !q || passengerName(r.id).toLowerCase().includes(q))
    .sort((a, b) => BE_ORDER.indexOf(a.phase) - BE_ORDER.indexOf(b.phase) || a.id - b.id)
    .slice(0, BE_LIST);
  return (
    <div className="route-search">
      <p className="muted">
        Every rider in the twin has an ID. Pick one and this phone becomes theirs; the camera
        follows them.
      </p>
      <input
        type="search"
        className="input"
        aria-label="Find a rider by ID"
        placeholder="Rider ID, e.g. P0718"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {people.length === 0 ? (
        <p className="muted">
          {q
            ? 'No rider with that ID on this route right now.'
            : 'Nobody is out on this route yet.'}
        </p>
      ) : (
        <ul className="route-search__results">
          {people.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="route-search__item route-search__item--stack"
                onClick={() => setCommuter({ passenger: r.id, chosen: true })}
              >
                <span>
                  <b className="mono">{passengerName(r.id)}</b> · {RIDER_KIND_LABEL[kindOf(r)]} ·{' '}
                  {PASSENGER_PHASE[r.phase]}
                </span>
                <span className="mono">
                  {stops[r.originStop]?.name} → {stops[r.destinationStop]?.name}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Hero({ view, clockS }: { view: CommuterView; clockS: number }) {
  if (view.riding)
    return (
      <section className="hero hero--stop">
        <span className="hero__label">
          On {view.riding.plate}
          {view.riding.kind !== 'jeepney' && ` · ${KIND_NAME[view.riding.kind]}`}
        </span>
        <strong className="hero__title">{metres(view.riding.remainingM)} to go</strong>
        <span>
          {view.destination.name} in {minutes(view.riding.etaS)} · around{' '}
          {clockIn(view.riding.etaS, clockS)}
        </span>
      </section>
    );
  if (view.trip.arriveInS === 0)
    return (
      <section className="hero hero--stop">
        <strong className="hero__title">Arrived</strong>
        <span>{view.destination.name}</span>
      </section>
    );
  if (!view.pickup)
    return (
      <section className="hero hero--pass">
        <span className="hero__label">Boarding at {view.stop.name}</span>
        <strong className="hero__title">
          {view.approach ? 'Finding a jeepney you can catch' : 'No seat in sight yet'}
        </strong>
        <span>
          {view.arrivals.length > 0
            ? view.approach
              ? 'The current jeepneys may arrive before you or have no seats. We’ll update as you get closer.'
              : 'The jeepneys coming are full by the time they reach you.'
            : 'No jeepney is heading here right now.'}
        </span>
      </section>
    );
  return (
    <section className="hero hero--stop">
      <span className="hero__label">
        Suggested {KIND_NAME[view.pickup.kind].toLowerCase()} · {view.pickup.plate}
      </span>
      <strong className="hero__title">{minutes(view.pickup.etaS)}</strong>
      <span>
        {metres(view.pickup.distanceM)} away, {view.pickup.seatsForYou} seat
        {view.pickup.seatsForYou === 1 ? '' : 's'} left for you
      </span>
    </section>
  );
}

export function CommuterPanel() {
  useTicker(2);
  const { twin } = useRuntimes();
  const me = useApp((s) => s.me);
  const route = twin.route;
  const query = useApp((s) => s.commuter);
  const setCommuter = useApp((s) => s.setCommuter);
  const setFocus = useApp((s) => s.setFocus);
  const tripLegs = useApp((s) => s.tripLegs);
  const tripLeg = useApp((s) => s.tripLeg);
  const pendingJoin = useApp((s) => s.pendingJoin);
  const startLeg = useApp((s) => s.startLeg);
  const clearPendingJoin = useApp((s) => s.clearPendingJoin);

  // A planned trip: once its route is the focused one, "you" join the twin
  // as a rider walking to the stop, and the phone follows you.
  useEffect(() => {
    if (
      !pendingJoin ||
      useApp.getState().pendingJoin !== pendingJoin ||
      twin.route.id !== pendingJoin.routeId
    )
      return;
    const leg = useApp.getState().tripLegs?.[pendingJoin.leg];
    clearPendingJoin();
    if (leg)
      setCommuter({
        // From where the trip starts (the place chosen), to the stop the planner chose.
        passenger: twin.crew.join(leg.board, leg.alight, leg.walkM, leg.approachMode, {
          kind: useApp.getState().me.kind,
          ...(leg.from && { from: leg.from, keepStop: true }),
        }),
      });
  }, [pendingJoin, twin, clearPendingJoin, setCommuter]);

  const state = twinState(twin);
  const plan = dispatch(state);
  const following = 'passenger' in query;
  // The second jeepney of a planned trip, once the first ride is over.
  const planned = tripLegs?.[tripLeg + 1];
  const nextLegRoute = planned ? getNetwork()?.routes[planned.route]?.route : undefined;
  // Only with its route at hand (the network can be reloading).
  const nextLeg = nextLegRoute ? planned : undefined;
  const continueTrip = () => {
    if (!nextLeg || !nextLegRoute) return;
    if (routeIndex(twin.route.id) !== nextLeg.route)
      setFocus(focusRoute(nextLeg.route, twin), true);
    setCommuter({ stop: nextLeg.board, destination: nextLeg.alight });
    startLeg(tripLeg + 1, nextLegRoute.id);
  };
  // A rider whose trip is over has left the twin.
  if (following && !twin.crew.passengers.has(query.passenger))
    return (
      <div className="panel__body">
        <PhoneFrame app="Commuter" who="My trip">
          <section className="hero hero--stop">
            <strong className="hero__title">
              {nextLeg ? 'Change jeepneys here' : 'Trip finished'}
            </strong>
            <span>
              {nextLeg
                ? `Walk ${metres(nextLeg.walkM)} to ${nextLegRoute!.stops[nextLeg.board]!.name} for ${nextLegRoute!.name}.`
                : query.chosen
                  ? `${passengerName(query.passenger)} has reached where they were going.`
                  : 'Your demo trip has ended.'}
            </span>
          </section>
          {nextLeg && (
            <section className="section">
              <button type="button" className="btn btn--primary" onClick={continueTrip}>
                Continue: {nextLegRoute!.name}
              </button>
            </section>
          )}
          <section className="section">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() =>
                setCommuter({ stop: 0, destination: destinations(route, 0).at(-1) ?? 0 })
              }
            >
              Plan a trip
            </button>
          </section>
        </PhoneFrame>
      </div>
    );
  // Planning: one way in. Where you are and where you are going, on the map
  // or by name; the trip drawn on the map, then taken (TripPlanner).
  if (!following)
    return (
      <div className="panel__body">
        <PhoneFrame app="Commuter" who="My trip">
          <section className="section">
            <h3 className="section__title">Plan my trip</h3>
            <p className="muted">
              Click the map where you are and where you are going, or type a place. The app finds
              your waiting area and jeepney and draws the whole trip on the map. Take it, and you go
              to the waiting area on foot or by tricycle, as you choose.
            </p>
            <span className="chip">Simulation · individual commuter</span>
          </section>
          <TripPlanner />
          <details className="section">
            <summary className="section__title">Or be someone already on the map</summary>
            <BeSomeone />
          </details>
        </PhoneFrame>
      </div>
    );
  const view = commuterView(state, plan, query);
  const rider = twin.crew.passengers.get(query.passenger);
  const kind = rider ? kindOf(rider) : me.kind;
  const doing =
    rider?.phase === 'approaching' && rider.approachMode === 'tricycle'
      ? 'Riding a tricycle to the waiting area'
      : PASSENGER_PHASE[view.phase as keyof typeof PASSENGER_PHASE];
  // Back to planning (the rider, if someone else's, stays in the twin).
  const leave = () => setCommuter({ stop: view.stop.index, destination: view.destination.index });

  return (
    <div className="panel__body">
      <PhoneFrame app="Commuter" who="My trip">
        <section className="section">
          <h3 className="section__title">
            {query.chosen ? `Being ${passengerName(query.passenger)}` : 'My trip'}
          </h3>
          <p>
            <b className="mono">{passengerName(query.passenger)}</b> · {RIDER_KIND_LABEL[kind]} ·{' '}
            {doing}
          </p>
          <p className="muted">
            {route.name}: {view.stop.name} → {view.destination.name}
          </p>
        </section>
        <section className="section" aria-live="polite">
          <h3 className="section__title">My journey</h3>
          <ol className="journey-steps">
            <li aria-current={view.phase === 'approaching' ? 'step' : undefined}>
              Getting to the stop
            </li>
            <li aria-current={view.phase === 'waiting' ? 'step' : undefined}>
              Waiting for a jeepney
            </li>
            <li aria-current={view.riding ? 'step' : undefined}>On board</li>
            <li aria-current={view.trip.arriveInS === 0 ? 'step' : undefined}>Arrived</li>
          </ol>
          {view.approach && (
            <div className="hero hero--pass">
              <span className="hero__label">
                {view.approach.mode === 'tricycle' ? 'Riding a tricycle' : 'Walking'} to{' '}
                {view.stop.name}
              </span>
              <strong className="hero__title">
                {metres(view.approach.distanceM)} to your stop
              </strong>
              <span>Estimated arrival in {arrivalTime(view.approach.etaS)}</span>
              <span className="fine">
                {view.approach.distanceM <= 500
                  ? 'Shown as incoming to drivers and the Operational Twin. You are not in the queue yet.'
                  : 'You will appear in nearby incoming counts within 500 m of the stop.'}
              </span>
            </div>
          )}
          {view.phase === 'waiting' && (
            <p className="chip chip--good">
              You are at the stop · {view.queueAhead} ahead in the queue
            </p>
          )}
          {query.chosen ? (
            // Someone else's trip: leave them to it, they stay in the twin.
            <button type="button" className="btn" onClick={leave}>
              Stop being {passengerName(query.passenger)}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  // Not yet on a jeepney: gone from the twin. On one: rides on
                  // as anyone else would; the phone stops following.
                  twin.crew.cancel(query.passenger);
                  useApp.getState().setTripLegs(null);
                  leave();
                }}
              >
                Cancel my trip
              </button>
              <p className="fine">
                Your home, waiting area and destination stay as they are: change any of them, or
                take the trip again.
              </p>
            </>
          )}
        </section>

        <Hero view={view} clockS={twin.clockS} />

        {!view.riding && view.trip.arriveInS !== 0 && (
          <section className="section">
            <h3 className="section__title">Coming to {view.stop.name}</h3>
            {view.arrivals.length === 0 && <p className="muted">No jeepney on its way.</p>}
            <ul className="ahead-list">
              {view.arrivals.map((a) => (
                <li
                  key={a.vehicle}
                  className={`ahead ${a.vehicle === view.pickup?.vehicle ? 'ahead--stop' : ''}`}
                >
                  <div className="ahead__head">
                    <strong className="mono">
                      {a.plate}
                      {a.kind !== 'jeepney' && (
                        <span className="muted"> · {KIND_NAME[a.kind]}</span>
                      )}
                    </strong>
                    <span className="mono">
                      {minutes(a.etaS)} · {metres(a.distanceM)}
                    </span>
                  </div>
                  <div className="ahead__body">
                    <span
                      className={`chip ${a.catchable && a.seatsForYou > 0 ? 'chip--good' : 'chip--bad'}`}
                    >
                      {!a.catchable
                        ? 'Arrives before you reach the stop'
                        : a.seatsForYou > 0
                          ? `~${a.seatsForYou} seats available`
                          : 'Full for you'}
                    </span>
                    <span className="muted">{a.freeSeats} free on arrival</span>
                  </div>
                </li>
              ))}
            </ul>
            <p className="fine">
              {view.queueAhead} {view.queueAhead === 1 ? 'person' : 'people'} ahead of you in the
              queue board first. Seats are estimates, not reservations.
            </p>
          </section>
        )}

        <section className="section">
          <h3 className="section__title">Trip</h3>
          <div className="kv">
            <span>Distance</span>
            <span className="mono">{metres(view.trip.distanceM)}</span>
            <span>Fare</span>
            <span className="mono">
              {fareLine(kind, view.trip.fare, view.trip.fareDiscounted)}
              {view.trip.by !== 'jeepney' && ` · by ${KIND_NAME[view.trip.by].toLowerCase()}`}
            </span>
            <span>Arrive</span>
            <span className="mono">
              {view.trip.arriveInS === null
                ? 'once a jeepney has a seat'
                : view.trip.arriveInS === 0
                  ? 'arrived'
                  : `around ${clockIn(view.trip.arriveInS, twin.clockS)} (${minutes(view.trip.arriveInS)})`}
            </span>
          </div>
        </section>

        <section className="section">
          <h3 className="section__title">Ask</h3>
          <AskBox
            suggestions={SUGGESTIONS}
            keywords={voiceKeywords(twin.route)}
            request={() => {
              const now = twinState(twin);
              let shown: ReturnType<typeof commuterView> | null = null;
              try {
                shown = commuterView(now, dispatch(now), query);
              } catch {
                // A followed rider who just finished their trip: no screen, no jeepney.
              }
              const req = plannerRequest(now, {
                role: 'commuter',
                stop: view.stop.index,
                destination: view.destination.index,
                direction: route.loop
                  ? 1
                  : route.stops[view.destination.index]!.s >= route.stops[view.stop.index]!.s
                    ? 1
                    : -1,
                // Only the jeepneys on their screen: the one they ride, or
                // the ones coming. The rest of the fleet would only cost tokens.
                jeepneys: shown?.riding
                  ? [shown.riding.vehicle]
                  : (shown?.arrivals.map((a) => a.vehicle) ?? []),
              });
              const legs = useApp.getState().tripLegs;
              const trip = legs && legs.length > 1 ? tripSummary(legs, twin) : undefined;
              return shown
                ? {
                    ...req,
                    screen: {
                      ...commuterScreen(shown),
                      // Who is asking: their fare is the discounted one, or the regular one.
                      rider: RIDER_KIND_LABEL[kind],
                      yourFare: discountedKind(kind) ? shown.trip.fareDiscounted : shown.trip.fare,
                      ...(trip && { plannedTrip: trip }),
                    },
                  }
                : req;
            }}
          />
        </section>

        <p className="fine phone__note">
          Times are estimates from the vehicles’ positions now. Fares are by the vehicle that takes
          you, from the LTFRB matrix in force since 28 September 2026 (core/fare.ts): a UV Express
          loads only at its terminal.
        </p>
      </PhoneFrame>
    </div>
  );
}
