// src/engine/types.ts
// Shared engine contract: the type shapes every game and the engine layer agree on.

export type GameId =
  | "block-cascade"
  | "serpent"
  | "maze-muncher"
  | "brick-buster"
  | "road-racer";

export type GameStatus = "idle" | "running" | "paused" | "gameover";

export interface Viewport {
  width: number;
  height: number;
}

export interface TouchControlSpec {
  action: string;          // maps to a game action
  label: string;           // accessible label (Req 9.5)
  position: "left" | "right" | "up" | "down" | "primary";
}

/**
 * One direction of an on-canvas drag gesture (Req 3.2, 8.4).
 *
 * Dragging along the direction's axis dispatches `action` once per `step`
 * of travel, where a step is `stepFraction` of the canvas's display size on
 * that axis (width for left/right, height for up/down). Marking a direction
 * `once` makes it fire a single time and then swallow the rest of that touch —
 * for committing actions like a hard drop, where repeats would spill onto the
 * next piece.
 */
export interface GestureDirectionSpec<A extends string = string> {
  action: A;
  /** Drag distance per dispatched action, as a fraction of the display axis (default 0.15). */
  stepFraction?: number;
  /** Fire at most once per touch, then ignore the touch until the finger lifts. */
  once?: boolean;
}

/**
 * Declarative mapping from on-canvas touch gestures to game actions
 * (Req 3.2, 8.4). Games that declare this get a gesture layer over the play
 * canvas: directional drags dispatch the per-direction actions (continuously —
 * the gesture re-arms as the finger keeps moving, so a held drag keeps
 * steering), and a tap (press + release with negligible movement) dispatches
 * `tap`. Purely additive: keyboard and on-screen Touch_Controls keep working.
 */
export interface GestureSpec<A extends string = string> {
  /** Action for a tap on the canvas (e.g. rotate, launch). */
  tap?: A;
  up?: GestureDirectionSpec<A>;
  down?: GestureDirectionSpec<A>;
  left?: GestureDirectionSpec<A>;
  right?: GestureDirectionSpec<A>;
}

// A game is defined by PURE logic + a renderer. S = state type, A = action type.
export interface GameDefinition<S, A extends string> {
  readonly id: GameId;
  readonly name: string;                 // Req 1.2
  readonly instructions: string;         // Req 3.4
  readonly aspectRatio: number;          // used for responsive canvas fit (Req 8.3)
  readonly keyMap: Readonly<Record<string, A>>;   // key -> action (Req 3.1)
  readonly scrollKeys: readonly string[];         // keys whose default scroll is prevented (Req 3.5)
  readonly touchControls: readonly TouchControlSpec[]; // Req 3.2
  /** Optional on-canvas gesture mapping for touch play (Req 3.2, 8.4). */
  readonly gestures?: GestureSpec<A>;

  createInitialState(): S;               // Score MUST be 0 (Req 4.3)
  step(state: S, actions: readonly A[], dtMs: number): S;  // pure advance
  isGameOver(state: S): boolean;         // end condition (Req 5.1)
  getScore(state: S): number;            // current Score (Req 4.1)
  render(ctx: CanvasRenderingContext2D, state: S, viewport: Viewport): void;
}

// The lifecycle contract the GameRunner implements so the hub controls every
// game uniformly (Req 2). Owned here so the engine and UI layers share it.
export interface GameInstance {
  readonly status: GameStatus;
  readonly score: number;
  start(): void;     // Req 2.2  (idle -> running)
  pause(): void;     // Req 2.3  (running -> paused, preserve state + score)
  resume(): void;    // Req 2.4  (paused -> running, continue)
  restart(): void;   // Req 2.5/2.6/5.4 (reset to initial, score = 0, begin)
  destroy(): void;   // Req 1.5 (stop, release loop + listeners, clear canvas)
}
