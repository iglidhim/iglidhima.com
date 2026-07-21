// src/engine/gameRunner.ts
// The lifecycle owner for the arcade hub.
//
// A `GameRunner` binds one `GameDefinition` to the game-agnostic engine layer
// (the `GameLoop` and the `InputManager`) and drives it through the shared
// status machine so the hub's controls behave identically for every game
// (Requirement 2):
//
//     idle --start()--> running
//     running --pause()--> paused        (state + Score preserved)
//     paused --resume()--> running       (continue from preserved state)
//     running --end condition--> gameover (stop play, commit High_Score)
//     any     --restart()--> running     (reset to initial state, Score 0)
//     any     --destroy()--> (terminal)  (stop loop, remove listeners, clear canvas)
//
// The runner holds the current `GameDefinition`, the live game state, and the
// `GameStatus`. Each fixed simulation step it drains buffered input, advances
// the pure `step`, checks the end condition, renders (when a canvas context is
// present), and reports Score/status changes through optional callbacks so the
// scoreboard and lifecycle controls can react (Requirements 4.1, 4.2, 5.2).
//
// On the end condition it transitions to `gameover`, stops the simulation, and
// commits the final Score to the ScoreStore (Requirements 5.1, 6.2).
//
// Both the `GameLoop` and the `InputManager` are injectable. Callers may pass an
// already-constructed loop/manager, or supply `loopOptions` whose `now` and
// `scheduler` are forwarded to a loop the runner builds itself. This lets tests
// drive the runner deterministically with a fake clock and a manual frame
// scheduler, without a real `requestAnimationFrame` or canvas.

import { GameLoop, type GameLoopOptions } from "./gameLoop.ts";
import { InputManager } from "./input.ts";
import type { GameDefinition, GameId, GameInstance, GameStatus, Viewport } from "./types.ts";
import { commitScore as defaultCommitScore } from "../scores/scoreStore.ts";

/** Notified whenever the runner's status transitions. */
export type StatusListener = (status: GameStatus) => void;

/** Notified whenever the current Score changes. */
export type ScoreListener = (score: number) => void;

/** Signature of the ScoreStore commit hook (injectable for tests). */
export type CommitScoreFn = (id: GameId, finalScore: number) => number;

export interface GameRunnerOptions<S, A extends string> {
  /** The game to run. */
  definition: GameDefinition<S, A>;
  /**
   * An already-constructed loop to drive. When omitted, the runner builds its
   * own `GameLoop` from `loopOptions` (so `now`/`scheduler` stay injectable).
   */
  loop?: GameLoop;
  /** Options forwarded to the loop the runner constructs when `loop` is absent. */
  loopOptions?: GameLoopOptions;
  /**
   * An already-constructed input manager. When omitted, the runner builds one
   * from the definition's `keyMap`, `scrollKeys`, and `touchControls`.
   */
  input?: InputManager<A>;
  /** Canvas context to render into. When absent (e.g. under test), rendering is skipped. */
  ctx?: CanvasRenderingContext2D | null;
  /** Explicit render viewport. Defaults to the canvas dimensions when a `ctx` is given. */
  viewport?: Viewport;
  /** ScoreStore commit hook. Defaults to the real `commitScore` adapter. */
  commitScore?: CommitScoreFn;
  /** Invoked on every status transition. */
  onStatusChange?: StatusListener;
  /** Invoked whenever the Score changes (including the reset to 0 on restart). */
  onScoreChange?: ScoreListener;
}

export class GameRunner<S, A extends string> implements GameInstance {
  private readonly definition: GameDefinition<S, A>;
  private readonly loop: GameLoop;
  private readonly input: InputManager<A>;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly explicitViewport: Viewport | null;
  private readonly commitScoreFn: CommitScoreFn;
  private readonly onStatusChange: StatusListener | null;
  private readonly onScoreChange: ScoreListener | null;

  private currentState: S;
  private currentStatus: GameStatus = "idle";
  private lastScore: number;
  private destroyed = false;

  constructor(options: GameRunnerOptions<S, A>) {
    this.definition = options.definition;

    // Build the loop from injectable options when one isn't supplied, so the
    // clock and frame scheduler remain controllable in tests.
    this.loop = options.loop ?? new GameLoop(options.loopOptions ?? {});

    // Build an input manager bound to this game's key/touch maps when absent.
    this.input =
      options.input ??
      new InputManager<A>({
        keyMap: this.definition.keyMap,
        scrollKeys: this.definition.scrollKeys,
        touchControls: this.definition.touchControls,
      });

    this.ctx = options.ctx ?? null;
    this.explicitViewport = options.viewport ?? null;
    this.commitScoreFn = options.commitScore ?? defaultCommitScore;
    this.onStatusChange = options.onStatusChange ?? null;
    this.onScoreChange = options.onScoreChange ?? null;

    this.currentState = this.definition.createInitialState();
    this.lastScore = this.definition.getScore(this.currentState);
  }

  /** The current lifecycle status (Requirement 2). */
  get status(): GameStatus {
    return this.currentStatus;
  }

  /** The current Score derived from the live game state (Requirement 4.1). */
  get score(): number {
    return this.definition.getScore(this.currentState);
  }

  /** The live game state. Exposed read-only for binding renderers and tests. */
  get state(): S {
    return this.currentState;
  }

  /**
   * Begin play from the idle state (Requirement 2.2). No-op unless currently
   * `idle`, so it is safe against double-activation of the start control.
   */
  start(): void {
    if (this.destroyed || this.currentStatus !== "idle") return;
    this.beginRunning();
  }

  /**
   * Suspend play, preserving the current game state and Score (Requirement 2.3).
   * The loop stops advancing and input is no longer buffered, but the state is
   * left untouched so `resume()` can continue exactly where it left off. No-op
   * unless currently `running`.
   */
  pause(): void {
    if (this.destroyed || this.currentStatus !== "running") return;
    this.loop.stop();
    this.input.setRunning(false);
    this.setStatus("paused");
  }

  /**
   * Continue play from a paused state (Requirement 2.4). The preserved state and
   * Score are unchanged; only the simulation and input resume. No-op unless
   * currently `paused`.
   */
  resume(): void {
    if (this.destroyed || this.currentStatus !== "paused") return;
    this.input.setRunning(true);
    this.setStatus("running");
    this.loop.start(this.tick);
  }

  /**
   * Reset to the initial state with Score zero and begin a new running session
   * (Requirements 2.5, 2.6, 5.4). Serves both the restart control (from running
   * or paused) and the play-again control (from gameover). Idempotent-safe from
   * any non-destroyed status.
   */
  restart(): void {
    if (this.destroyed) return;
    // Stop any in-flight loop before rebuilding state so no stale tick lands on
    // the fresh state.
    this.loop.stop();
    this.currentState = this.definition.createInitialState();
    this.emitScoreIfChanged();
    this.beginRunning();
  }

  /**
   * Stop the loop, remove input listeners, and clear the canvas (Requirement
   * 1.5). Terminal: after `destroy()` all lifecycle calls are no-ops. Idempotent.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.loop.stop();
    this.input.destroy();
    this.clearCanvas();
  }

  // --- internal helpers ----------------------------------------------------

  /** Common path for start/resume-from-idle and restart: attach input, run loop. */
  private beginRunning(): void {
    this.input.attach();
    this.input.setRunning(true);
    this.setStatus("running");
    this.renderFrame();
    this.loop.start(this.tick);
  }

  private setStatus(status: GameStatus): void {
    if (this.currentStatus === status) return;
    this.currentStatus = status;
    this.onStatusChange?.(status);
  }

  private emitScoreIfChanged(): void {
    const score = this.definition.getScore(this.currentState);
    if (score !== this.lastScore) {
      this.lastScore = score;
      this.onScoreChange?.(score);
    }
  }

  /**
   * One fixed simulation step: drain buffered input, advance the pure `step`,
   * check the end condition, render, and report Score changes.
   */
  private readonly tick = (fixedStepMs: number): void => {
    if (this.currentStatus !== "running") return;

    const actions = this.input.drainActions();
    this.currentState = this.definition.step(this.currentState, actions, fixedStepMs);

    if (this.definition.isGameOver(this.currentState)) {
      this.enterGameOver();
      return;
    }

    this.emitScoreIfChanged();
    this.renderFrame();
  };

  /** Transition to gameover: stop play and commit the final Score (Req 5.1, 6.2). */
  private enterGameOver(): void {
    this.loop.stop();
    this.input.setRunning(false);
    this.emitScoreIfChanged();
    this.renderFrame();
    this.setStatus("gameover");
    const finalScore = this.definition.getScore(this.currentState);
    this.commitScoreFn(this.definition.id, finalScore);
  }

  private resolveViewport(): Viewport {
    if (this.explicitViewport) return this.explicitViewport;
    if (this.ctx) {
      return { width: this.ctx.canvas.width, height: this.ctx.canvas.height };
    }
    return { width: 0, height: 0 };
  }

  private renderFrame(): void {
    if (!this.ctx) return;
    this.definition.render(this.ctx, this.currentState, this.resolveViewport());
  }

  private clearCanvas(): void {
    if (!this.ctx) return;
    this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
  }
}

/** Convenience factory mirroring the `GameRunner` constructor. */
export function createGameRunner<S, A extends string>(
  options: GameRunnerOptions<S, A>,
): GameRunner<S, A> {
  return new GameRunner(options);
}
