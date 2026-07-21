// Chrome integration render tests (task 9.6).
//
// The individual chrome components already have focused render tests
// (src/ui/*.test.ts): the Hub's four entries + labels (1.1, 1.2) and Back-to-Hub
// while playing (1.4); Start in idle (2.1) and Play-Again only in gameover (5.3);
// instructions + current Score + stored High_Score bindings (3.4, 4.1, 6.3); the
// touch overlay gated on reported touch capability (3.2); and every interactive
// control exposing an accessible name (9.5).
//
// This file covers the one EXAMPLE-classified assertion those tests leave open:
// the *wiring* that binds a live GameRunner's Score/status changes into the real
// Scoreboard and LifecycleControls, and in particular the final Score shown on
// game over (Requirement 5.2). It mirrors exactly how src/ui/playArea.ts binds
// `onScoreChange -> scoreboard.setScore` and `onStatusChange -> controls.setStatus`,
// but drives the runner with an injectable clock + manual frame scheduler so the
// simulation is fully deterministic (no real requestAnimationFrame or canvas).
//
// Runs under jsdom via the `.dom.test.ts` suffix (see vite.config.ts).
// _Requirements: 4.1, 5.2, 5.3, 6.3_
import { describe, it, expect, beforeEach } from "vitest";
import { GameRunner } from "../src/engine/gameRunner.ts";
import type { FrameScheduler } from "../src/engine/gameLoop.ts";
import type { GameDefinition } from "../src/engine/types.ts";
import { createScoreboard, type Scoreboard } from "../src/ui/scoreboard.ts";
import { createLifecycleControls, type LifecycleControls } from "../src/ui/controls.ts";

// --- test doubles ----------------------------------------------------------

interface FakeState {
  score: number;
  over: boolean;
}

type FakeAction = "noop";

/**
 * A minimal deterministic game whose Score advances by `perStep` each tick and
 * whose end condition trips once the Score reaches `gameOverAt`. Pure and
 * canvas-free, so the test exercises only the Score/status binding.
 */
function createScoringGame(gameOverAt: number, perStep = 10): GameDefinition<FakeState, FakeAction> {
  return {
    id: "serpent",
    name: "Fake Game",
    instructions: "",
    aspectRatio: 1,
    keyMap: { " ": "noop" },
    scrollKeys: [],
    touchControls: [],
    createInitialState: (): FakeState => ({ score: 0, over: false }),
    step: (state: FakeState): FakeState => {
      const score = state.score + perStep;
      return { score, over: score >= gameOverAt };
    },
    isGameOver: (state: FakeState): boolean => state.over || state.score >= gameOverAt,
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

/**
 * Wire a real Scoreboard + LifecycleControls to a GameRunner exactly as the
 * PlayArea does, but with a deterministic clock/scheduler. Returns the mounted
 * chrome plus a `tickOnce` that advances the simulation by one fixed step.
 */
function buildBoundChrome(host: HTMLElement, gameOverAt: number, storedHigh = 0) {
  const clock = createClock();
  const sched = createManualScheduler();
  const definition = createScoringGame(gameOverAt);

  const scoreboard: Scoreboard = createScoreboard();
  // Seed the stored High_Score the way PlayArea does when a game becomes active.
  scoreboard.setHighScore(storedHigh);

  let controls!: LifecycleControls;

  const runner = new GameRunner<FakeState, FakeAction>({
    definition,
    loopOptions: { fixedStepMs: FIXED_STEP, now: clock.now, scheduler: sched.scheduler },
    commitScore: () => 0, // isolate from the real localStorage-backed ScoreStore
    // Same bindings PlayArea establishes between the runner and the chrome.
    onScoreChange: (score) => scoreboard.setScore(score),
    onStatusChange: (status) => controls.setStatus(status),
  });

  controls = createLifecycleControls({ instance: runner, onBackToHub: () => {} });

  scoreboard.mount(host);
  controls.mount(host);
  controls.setStatus(runner.status);

  const tickOnce = (): void => {
    clock.advance(FIXED_STEP);
    sched.flush();
  };

  return { runner, scoreboard, controls, tickOnce };
}

/** Read the current Score text from the mounted scoreboard. */
function scoreText(host: HTMLElement): string | null | undefined {
  return host.querySelector(".scoreboard__score")?.textContent;
}

/** Labels of the currently visible (non-hidden) lifecycle buttons. */
function visibleControlLabels(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll<HTMLButtonElement>(".controls .btn"))
    .filter((btn) => !btn.hidden)
    .map((btn) => btn.textContent ?? "");
}

// --- tests -----------------------------------------------------------------

describe("chrome integration: runner-bound Scoreboard and LifecycleControls", () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  it("updates the Scoreboard current Score as the runner scores during play (Req 4.1)", () => {
    const { runner, tickOnce } = buildBoundChrome(host, /* gameOverAt */ 1000);

    // Before play the Scoreboard shows 0.
    expect(scoreText(host)).toBe("0");

    runner.start();
    tickOnce();
    expect(scoreText(host)).toBe("10");

    tickOnce();
    tickOnce();
    // Three fixed steps at +10 each -> the binding reflects the live Score.
    expect(scoreText(host)).toBe("30");
    expect(runner.status).toBe("running");
  });

  it("shows the final Score on game over and preserves it after play stops (Req 5.2)", () => {
    // Ends on the third step: 10 -> 20 -> 30 (>= 30 trips the end condition).
    const { runner, tickOnce } = buildBoundChrome(host, /* gameOverAt */ 30);

    runner.start();

    let guard = 0;
    while (runner.status !== "gameover" && guard++ < 100) {
      tickOnce();
    }

    // The end condition halted play and the Scoreboard reflects the final Score.
    expect(runner.status).toBe("gameover");
    expect(runner.score).toBe(30);
    expect(scoreText(host)).toBe("30");

    // The final Score remains displayed after the loop has stopped (no drift).
    tickOnce();
    tickOnce();
    expect(scoreText(host)).toBe("30");
  });

  it("reveals only Play-Again (and Back-to-Hub) once the bound runner reaches gameover (Req 5.3)", () => {
    const { runner, tickOnce } = buildBoundChrome(host, /* gameOverAt */ 20);

    runner.start();
    // While running, Play-Again is not among the visible controls.
    expect(visibleControlLabels(host)).not.toContain("Play Again");

    let guard = 0;
    while (runner.status !== "gameover" && guard++ < 100) {
      tickOnce();
    }
    expect(runner.status).toBe("gameover");

    // The status binding flipped the controls to the gameover set.
    expect(visibleControlLabels(host).sort()).toEqual(["Back to Hub", "Play Again"]);
  });

  it("keeps the seeded stored High_Score visible alongside the live Score (Req 6.3)", () => {
    const { runner, tickOnce } = buildBoundChrome(host, /* gameOverAt */ 1000, /* storedHigh */ 4200);

    // High_Score seeded from the store is shown from the start.
    expect(host.querySelector(".scoreboard__high-score")?.textContent).toBe("4200");

    runner.start();
    tickOnce();

    // Scoring during play does not disturb the displayed stored High_Score.
    expect(scoreText(host)).toBe("10");
    expect(host.querySelector(".scoreboard__high-score")?.textContent).toBe("4200");
  });
});
