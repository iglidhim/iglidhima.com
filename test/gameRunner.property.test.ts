// Property-based tests for the GameRunner lifecycle/status machine
// (`src/engine/gameRunner.ts`), covering design Properties 3, 4, and 5.
//
// The runner is driven with an injectable clock and a manual frame scheduler so
// simulation stepping is fully deterministic without a real `requestAnimationFrame`
// or canvas. A simple fake `GameDefinition` stands in for a real game; its
// `step` advances a Score by one per tick and it never renders, so the tests
// exercise lifecycle behavior in isolation from any game logic or the DOM.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { GameRunner } from "../src/engine/gameRunner.ts";
import type { FrameScheduler } from "../src/engine/gameLoop.ts";
import type { GameDefinition } from "../src/engine/types.ts";

// --- test doubles ----------------------------------------------------------

interface FakeState {
  score: number;
  steps: number;
  over: boolean;
}

type FakeAction = "noop";

/**
 * A minimal deterministic game. `step` advances Score/steps by one each tick;
 * `isGameOver` is true once Score reaches `gameOverAt` (or never, when omitted).
 * `createInitialState` is pure and constant so restart equality is testable.
 */
function createFakeGame(gameOverAt?: number): GameDefinition<FakeState, FakeAction> {
  return {
    id: "serpent",
    name: "Fake Game",
    instructions: "",
    aspectRatio: 1,
    keyMap: { " ": "noop" },
    scrollKeys: [],
    touchControls: [],
    createInitialState: (): FakeState => ({ score: 0, steps: 0, over: false }),
    step: (state: FakeState): FakeState => ({
      score: state.score + 1,
      steps: state.steps + 1,
      over: false,
    }),
    isGameOver: (state: FakeState): boolean =>
      state.over || (gameOverAt !== undefined && state.score >= gameOverAt),
    getScore: (state: FakeState): number => state.score,
    render: (): void => {},
  };
}

/** A manual frame scheduler: fires scheduled callbacks on demand. */
function createManualScheduler() {
  let nextHandle = 1;
  const pending = new Map<number, () => void>();
  const scheduler: FrameScheduler = {
    requestFrame(callback: () => void): number {
      const handle = nextHandle++;
      pending.set(handle, callback);
      return handle;
    },
    cancelFrame(handle: number): void {
      pending.delete(handle);
    },
  };
  return {
    scheduler,
    flush(): void {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const cb of callbacks) cb();
    },
  };
}

/** A controllable monotonic clock. */
function createClock() {
  let time = 0;
  return {
    now: (): number => time,
    advance(ms: number): void {
      time += ms;
    },
  };
}

const FIXED_STEP = 10;

/** Build a runner wired to a fresh fake game, clock, and manual scheduler. */
function buildRunner(gameOverAt?: number) {
  const clock = createClock();
  const sched = createManualScheduler();
  const definition = createFakeGame(gameOverAt);
  const runner = new GameRunner<FakeState, FakeAction>({
    definition,
    loopOptions: { fixedStepMs: FIXED_STEP, now: clock.now, scheduler: sched.scheduler },
    commitScore: () => 0, // isolate from the real localStorage-backed ScoreStore
  });
  /** Advance one fixed step and fire the pending frame (one tick). */
  const tickOnce = (): void => {
    clock.advance(FIXED_STEP);
    sched.flush();
  };
  return { definition, runner, tickOnce };
}

// --- properties ------------------------------------------------------------

describe("GameRunner lifecycle", () => {
  // Feature: personal-website, Property 3: Start begins play
  it("start() transitions any idle game to running", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100_000 }), (gameOverAt) => {
        const { runner } = buildRunner(gameOverAt);

        // A freshly constructed runner is idle.
        expect(runner.status).toBe("idle");

        runner.start();

        expect(runner.status).toBe("running");
      }),
      { numRuns: 100 },
    );
  });

  // Feature: personal-website, Property 4: Pause then resume preserves score and game state
  it("pause() preserves state and Score; resume() continues from the same state", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 50 }), (steps) => {
        // gameOverAt above steps so the game never ends while we drive it.
        const { runner, tickOnce } = buildRunner(steps + 1);
        runner.start();

        for (let i = 0; i < steps; i++) tickOnce();

        // Snapshot the running state and Score before pausing.
        const stateBeforePause = structuredClone(runner.state);
        const scoreBeforePause = runner.score;

        runner.pause();

        // pause() leaves state and Score unchanged and sets status paused.
        expect(runner.status).toBe("paused");
        expect(runner.state).toEqual(stateBeforePause);
        expect(runner.score).toBe(scoreBeforePause);

        runner.resume();

        // resume() returns to running with the same preserved state and Score.
        expect(runner.status).toBe("running");
        expect(runner.state).toEqual(stateBeforePause);
        expect(runner.score).toBe(scoreBeforePause);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: personal-website, Property 5: Restart and play-again reset to the initial state with Score zero
  it("restart() resets to the initial state with Score zero and begins running from any reachable state", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("running", "paused", "gameover"),
        fc.integer({ min: 0, max: 30 }),
        (phase, steps) => {
          // For the gameover phase, end quickly; otherwise never end while driving.
          const gameOverAt = phase === "gameover" ? 3 : steps + 1;
          const { definition, runner, tickOnce } = buildRunner(gameOverAt);

          runner.start();

          if (phase === "running") {
            for (let i = 0; i < steps; i++) tickOnce();
            expect(runner.status).toBe("running");
          } else if (phase === "paused") {
            for (let i = 0; i < steps; i++) tickOnce();
            runner.pause();
            expect(runner.status).toBe("paused");
          } else {
            let guard = 0;
            while (runner.status !== "gameover" && guard++ < 100) tickOnce();
            expect(runner.status).toBe("gameover");
          }

          runner.restart();

          // Reset to createInitialState(), Score 0, and a fresh running session.
          expect(runner.status).toBe("running");
          expect(runner.score).toBe(0);
          expect(runner.state).toEqual(definition.createInitialState());
        },
      ),
      { numRuns: 100 },
    );
  });
});
