// Unit tests for the shared GameLoop (task 5.2).
//
// The loop is driven with an injectable clock and a manual frame scheduler so
// stepping is fully deterministic without a real browser or wall clock.
// _Requirements: 10.2_
import { describe, it, expect, vi } from "vitest";
import { GameLoop, createGameLoop, type FrameScheduler } from "../src/engine/gameLoop";

/**
 * A manual frame scheduler: captures the scheduled callback so the test can
 * "render" frames on demand, and tracks cancellation for assertions.
 */
function createManualScheduler() {
  let nextHandle = 1;
  const pending = new Map<number, () => void>();
  const cancelled: number[] = [];

  const scheduler: FrameScheduler = {
    requestFrame(callback: () => void): number {
      const handle = nextHandle++;
      pending.set(handle, callback);
      return handle;
    },
    cancelFrame(handle: number): void {
      cancelled.push(handle);
      pending.delete(handle);
    },
  };

  return {
    scheduler,
    /** Fire every currently-pending frame callback exactly once. */
    flush(): void {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const cb of callbacks) cb();
    },
    pendingCount(): number {
      return pending.size;
    },
    cancelled,
  };
}

/** A controllable clock. */
function createClock(start = 0) {
  let time = start;
  return {
    now: () => time,
    advance(ms: number): void {
      time += ms;
    },
    set(ms: number): void {
      time = ms;
    },
  };
}

describe("GameLoop", () => {
  it("advances the simulation in fixed increments", () => {
    const clock = createClock();
    const sched = createManualScheduler();
    const tick = vi.fn((_ms: number): void => {});
    const loop = new GameLoop({
      fixedStepMs: 10,
      now: clock.now,
      scheduler: sched.scheduler,
    });

    loop.start(tick);
    expect(sched.pendingCount()).toBe(1); // one frame queued

    // 35 ms elapse before the next frame -> 3 whole steps, 5 ms remainder.
    clock.advance(35);
    sched.flush();

    expect(tick).toHaveBeenCalledTimes(3);
    for (const call of tick.mock.calls) {
      expect(call[0]).toBe(10); // every step is the exact fixed size
    }

    // 6 more ms (accumulated remainder 5 + 6 = 11) -> exactly 1 more step.
    tick.mockClear();
    clock.advance(6);
    sched.flush();
    expect(tick).toHaveBeenCalledTimes(1);
    expect(tick.mock.calls[0]?.[0]).toBe(10);
  });

  it("is deterministic: equal elapsed time yields equal step counts", () => {
    const runSteps = (schedule: number[]): number => {
      const clock = createClock();
      const sched = createManualScheduler();
      const tick = vi.fn((_ms: number): void => {});
      const loop = createGameLoop({ fixedStepMs: 16, now: clock.now, scheduler: sched.scheduler });
      loop.start(tick);
      for (const delta of schedule) {
        clock.advance(delta);
        sched.flush();
      }
      return tick.mock.calls.length;
    };

    // Same total time (160 ms), different frame pacing -> same number of steps
    // because stepping is decoupled from render cadence.
    expect(runSteps([16, 16, 16, 16, 16, 16, 16, 16, 16, 16])).toBe(10);
    expect(runSteps([32, 48, 80])).toBe(10);
  });

  it("clamps the accumulator on long frames to avoid a spiral of death", () => {
    const clock = createClock();
    const sched = createManualScheduler();
    const tick = vi.fn((_ms: number): void => {});
    // maxAccumulatedMs defaults to 5 * fixedStep = 50 ms here.
    const loop = new GameLoop({ fixedStepMs: 10, now: clock.now, scheduler: sched.scheduler });

    loop.start(tick);

    // A single enormous frame (10 seconds) must not produce ~1000 steps.
    clock.advance(10_000);
    sched.flush();

    expect(tick.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it("stop() cancels the pending frame handle and halts stepping", () => {
    const clock = createClock();
    const sched = createManualScheduler();
    const tick = vi.fn((_ms: number): void => {});
    const loop = new GameLoop({ fixedStepMs: 10, now: clock.now, scheduler: sched.scheduler });

    loop.start(tick);
    expect(loop.isRunning).toBe(true);
    const pendingHandleCount = sched.pendingCount();
    expect(pendingHandleCount).toBe(1);

    loop.stop();

    expect(loop.isRunning).toBe(false);
    expect(sched.cancelled.length).toBe(1); // the queued frame was cancelled
    expect(sched.pendingCount()).toBe(0);

    // Even if a stale frame somehow fires, no ticks occur after stop.
    clock.advance(100);
    sched.flush();
    expect(tick).not.toHaveBeenCalled();
  });

  it("start() is idempotent and does not queue duplicate frames", () => {
    const clock = createClock();
    const sched = createManualScheduler();
    const tick = vi.fn((_ms: number): void => {});
    const loop = new GameLoop({ fixedStepMs: 10, now: clock.now, scheduler: sched.scheduler });

    loop.start(tick);
    loop.start(tick); // second call is a no-op

    expect(sched.pendingCount()).toBe(1);
  });
});
