// src/engine/gameLoop.ts
// Shared, game-agnostic frame driver.
//
// The GameLoop wraps `requestAnimationFrame` with a fixed-timestep accumulator:
// simulation advances in fixed increments (default 1/60 s) that are decoupled
// from render frames, so game speed is deterministic regardless of the display
// refresh rate. On slow frames the accumulator is clamped so the loop degrades
// gracefully (>=30 fps target) instead of entering a "spiral of death" where
// each frame schedules ever more catch-up steps (Requirement 10.2).
//
// Time and the frame scheduler are injectable so the loop can be driven
// deterministically under test without a real browser rAF or wall clock.

/** Called once per fixed simulation step with the (constant) step size in ms. */
export type TickFn = (fixedStepMs: number) => void;

/** Called once per rendered frame; `alpha` is the interpolation fraction
 *  (leftover accumulator / step) for smoothing renders between sim steps. */
export type RenderFn = (alpha: number) => void;

/** Abstraction over the frame scheduler so rAF can be swapped in tests. */
export interface FrameScheduler {
  requestFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
}

export interface GameLoopOptions {
  /** Fixed simulation step in ms. Defaults to 1000/60 (~16.667 ms). */
  fixedStepMs?: number;
  /**
   * Upper bound on the accumulator in ms. Long frames (tab backgrounded, GC
   * pauses, slow hardware) are clamped to this value so a single slow frame
   * can never trigger an unbounded burst of catch-up steps. Defaults to
   * 5 fixed steps (~83 ms), which keeps effective sim pacing at >=30 fps.
   */
  maxAccumulatedMs?: number;
  /** Injectable monotonic time source in ms. Defaults to `performance.now`. */
  now?: () => number;
  /** Injectable frame scheduler. Defaults to `requestAnimationFrame`. */
  scheduler?: FrameScheduler;
  /** Optional per-frame render callback invoked after simulation stepping. */
  render?: RenderFn;
}

function defaultNow(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function defaultScheduler(): FrameScheduler {
  if (
    typeof requestAnimationFrame === "function" &&
    typeof cancelAnimationFrame === "function"
  ) {
    return {
      requestFrame: (cb) => requestAnimationFrame(() => cb()),
      cancelFrame: (handle) => cancelAnimationFrame(handle),
    };
  }
  // Fallback for non-browser environments: coarse timer-based scheduling.
  return {
    requestFrame: (cb) => setTimeout(cb, 16) as unknown as number,
    cancelFrame: (handle) => clearTimeout(handle as unknown as ReturnType<typeof setTimeout>),
  };
}

export class GameLoop {
  private readonly fixedStepMs: number;
  private readonly maxAccumulatedMs: number;
  private readonly now: () => number;
  private readonly scheduler: FrameScheduler;
  private readonly render: RenderFn | null;

  private running = false;
  private frameHandle: number | null = null;
  private accumulator = 0;
  private lastTime = 0;
  private tick: TickFn | null = null;

  constructor(options: GameLoopOptions = {}) {
    this.fixedStepMs = options.fixedStepMs ?? 1000 / 60;
    if (!(this.fixedStepMs > 0)) {
      throw new Error("GameLoop: fixedStepMs must be a positive number");
    }
    this.maxAccumulatedMs = options.maxAccumulatedMs ?? this.fixedStepMs * 5;
    this.now = options.now ?? defaultNow;
    this.scheduler = options.scheduler ?? defaultScheduler();
    this.render = options.render ?? null;
  }

  /** Whether the loop is currently scheduling frames. */
  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Begin the loop, invoking `tick` once per fixed simulation step. Calling
   * `start` while already running is a no-op so it is safe to call idempotently.
   */
  start(tick: TickFn): void {
    if (this.running) return;
    this.running = true;
    this.tick = tick;
    this.accumulator = 0;
    this.lastTime = this.now();
    this.scheduleNext();
  }

  /**
   * Stop the loop and cancel any pending frame handle. Idempotent: safe to call
   * when already stopped. After `stop`, no further ticks or renders occur until
   * `start` is called again (Requirement 1.5).
   */
  stop(): void {
    this.running = false;
    if (this.frameHandle !== null) {
      this.scheduler.cancelFrame(this.frameHandle);
      this.frameHandle = null;
    }
    this.tick = null;
    this.accumulator = 0;
  }

  private scheduleNext(): void {
    this.frameHandle = this.scheduler.requestFrame(this.frameCallback);
  }

  private readonly frameCallback = (): void => {
    // A frame may fire after stop() if it was already queued; guard against it.
    if (!this.running || this.tick === null) return;

    const current = this.now();
    let frameTime = current - this.lastTime;
    this.lastTime = current;

    // Non-monotonic or paused clocks must not rewind the accumulator.
    if (frameTime < 0) frameTime = 0;

    // Clamp the accumulator to bound catch-up work and avoid a spiral of death.
    this.accumulator = Math.min(this.accumulator + frameTime, this.maxAccumulatedMs);

    // Drain the accumulator in deterministic fixed increments.
    while (this.accumulator >= this.fixedStepMs) {
      this.tick(this.fixedStepMs);
      this.accumulator -= this.fixedStepMs;
    }

    if (this.render) {
      this.render(this.accumulator / this.fixedStepMs);
    }

    this.scheduleNext();
  };
}

/** Convenience factory mirroring the `GameLoop` constructor. */
export function createGameLoop(options: GameLoopOptions = {}): GameLoop {
  return new GameLoop(options);
}
