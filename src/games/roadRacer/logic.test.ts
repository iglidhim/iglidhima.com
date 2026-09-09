import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  CAR_WIDTH,
  FIELD_HEIGHT,
  FIELD_WIDTH,
  LANES,
  MAX_SPEED,
  OVERTAKE_BONUS,
  PLAYER_Y,
  STEER_SPEED,
  TICK_MS,
  TRAFFIC_HEIGHT,
  TRAFFIC_WIDTH,
  createInitialState,
  getScore,
  isGameOver,
  laneCenter,
  step,
  type RoadRacerAction,
  type RoadRacerState,
} from "./logic";

/** A hand-built state for scenario tests (spawning pushed far away). */
function makeState(overrides: Partial<RoadRacerState>): RoadRacerState {
  return {
    ...createInitialState(),
    nextSpawnAt: 1_000_000,
    ...overrides,
  };
}

/** Frames arbitrary: buffered steering actions + a frame delta, as the runner drains them. */
const framesArb = fc.array(
  fc.record({
    actions: fc.array(fc.constantFrom<RoadRacerAction>("left", "right"), { maxLength: 5 }),
    dtMs: fc.integer({ min: 0, max: 1200 }),
  }),
  { maxLength: 60 },
);

describe("createInitialState", () => {
  it("starts centred on an empty road with Score zero and play live", () => {
    const state = createInitialState();
    expect(getScore(state)).toBe(0);
    expect(isGameOver(state)).toBe(false);
    expect(state.traffic).toEqual([]);
    expect(state.carX).toBe((FIELD_WIDTH - CAR_WIDTH) / 2);
  });
});

describe("step — steering", () => {
  it("moves exactly one steer-step per buffered action before time advances", () => {
    const state = makeState({});
    const left = step(state, ["left"], 0);
    const right = step(state, ["right"], 0);
    expect(left.carX).toBe(state.carX - STEER_SPEED);
    expect(right.carX).toBe(state.carX + STEER_SPEED);
  });

  // Feature: personal-website — the Beetle can never leave the paved field.
  it("keeps the car within the field under any action sequence", () => {
    fc.assert(
      fc.property(framesArb, (frames) => {
        let state = createInitialState();
        for (const frame of frames) {
          state = step(state, frame.actions, frame.dtMs);
          expect(state.carX).toBeGreaterThanOrEqual(0);
          expect(state.carX).toBeLessThanOrEqual(FIELD_WIDTH - CAR_WIDTH);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe("step — road physics and spawning", () => {
  it("ramps the speed monotonically and caps it at MAX_SPEED", () => {
    fc.assert(
      fc.property(framesArb, (frames) => {
        let state = createInitialState();
        let prevSpeed = state.speed;
        for (const frame of frames) {
          state = step(state, frame.actions, frame.dtMs);
          expect(state.speed).toBeGreaterThanOrEqual(prevSpeed);
          expect(state.speed).toBeLessThanOrEqual(MAX_SPEED);
          prevSpeed = state.speed;
        }
      }),
      { numRuns: 100 },
    );
  });

  it("spawns lane-centred traffic once the road has rolled far enough", () => {
    let state = createInitialState();
    // Drive (no steering) until past the first spawn distance.
    for (let i = 0; i < 200 && state.traffic.length === 0; i++) {
      state = step(state, [], 250);
    }
    expect(state.traffic.length).toBeGreaterThan(0);
    for (const car of state.traffic) {
      expect(car.lane).toBeGreaterThanOrEqual(0);
      expect(car.lane).toBeLessThan(LANES);
      expect(car.x).toBe(laneCenter(car.lane) - TRAFFIC_WIDTH / 2);
    }
  });

  // The fairness invariant: cars sharing a lane never stack into each other,
  // so a gap the player can weave through always exists somewhere.
  it("never lets two same-lane cars overlap in any reachable state", () => {
    fc.assert(
      fc.property(framesArb, (frames) => {
        let state = createInitialState();
        for (const frame of frames) {
          state = step(state, frame.actions, frame.dtMs);
          for (const a of state.traffic) {
            for (const b of state.traffic) {
              if (a === b || a.lane !== b.lane) continue;
              expect(Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(TRAFFIC_HEIGHT);
            }
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it("awards the overtake bonus when a car exits the bottom edge", () => {
    const state = makeState({
      carX: laneCenter(2) - CAR_WIDTH / 2, // player far right
      traffic: [{ x: laneCenter(0) - TRAFFIC_WIDTH / 2, y: FIELD_HEIGHT - 1, lane: 0, kind: 0 }],
    });
    const next = step(state, [], TICK_MS); // one fixed tick pushes it out
    expect(next.traffic).toEqual([]);
    expect(next.bonus).toBe(state.bonus + OVERTAKE_BONUS);
    expect(isGameOver(next)).toBe(false);
  });
});

describe("step — collisions end the run", () => {
  it("ends the session when traffic reaches the Beetle", () => {
    const state = makeState({
      carX: laneCenter(1) - CAR_WIDTH / 2,
      traffic: [{ x: laneCenter(1) - TRAFFIC_WIDTH / 2, y: PLAYER_Y, lane: 1, kind: 1 }],
    });
    const next = step(state, [], TICK_MS);
    expect(isGameOver(next)).toBe(true);
  });

  it("ends the session on a sideswipe (steering into a car) before any tick", () => {
    const state = makeState({
      carX: laneCenter(1) - CAR_WIDTH / 2,
      traffic: [{ x: 50, y: PLAYER_Y, lane: 0, kind: 2 }],
    });
    const next = step(state, ["left", "left"], 0);
    expect(isGameOver(next)).toBe(true);
  });

  // Feature: personal-website, Property 8 (game-local): a finished run is frozen.
  it("returns a game-over state unchanged, preserving the Score", () => {
    const overState = makeState({
      over: true,
      distance: 1234,
      bonus: 50,
    });
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<RoadRacerAction>("left", "right"), { maxLength: 8 }),
        fc.integer({ min: 0, max: 5000 }),
        (actions, dtMs) => {
          const next = step(overState, actions, dtMs);
          expect(next).toEqual(overState);
          expect(getScore(next)).toBe(getScore(overState));
        },
      ),
      { numRuns: 100 },
    );
  });

  it("reaches the end condition under sustained full-throttle action spam", () => {
    let state = createInitialState();
    let steps = 0;
    while (!isGameOver(state) && steps < 500) {
      state = step(state, ["left", "right"], 5000);
      steps++;
    }
    expect(isGameOver(state)).toBe(true);
  });
});

describe("scoring and purity", () => {
  // Feature: personal-website, Property 7 (game-local): Score never decreases.
  it("never decreases the Score across a restart-free session", () => {
    fc.assert(
      fc.property(framesArb, (frames) => {
        let state = createInitialState();
        let prev = getScore(state);
        for (const frame of frames) {
          state = step(state, frame.actions, frame.dtMs);
          const score = getScore(state);
          expect(score).toBeGreaterThanOrEqual(prev);
          prev = score;
        }
      }),
      { numRuns: 100 },
    );
  });

  it("is deterministic: identical inputs produce identical states", () => {
    fc.assert(
      fc.property(framesArb, (frames) => {
        let a = createInitialState();
        let b = createInitialState();
        for (const frame of frames) {
          a = step(a, frame.actions, frame.dtMs);
          b = step(b, frame.actions, frame.dtMs);
        }
        expect(a).toEqual(b);
      }),
      { numRuns: 100 },
    );
  });
});
