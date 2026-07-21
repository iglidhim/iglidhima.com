// src/engine/types.ts
// Shared engine contract: the type shapes every game and the engine layer agree on.

export type GameId = "block-cascade" | "serpent" | "maze-muncher" | "brick-buster";

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

// A game is defined by PURE logic + a renderer. S = state type, A = action type.
export interface GameDefinition<S, A extends string> {
  readonly id: GameId;
  readonly name: string;                 // Req 1.2
  readonly instructions: string;         // Req 3.4
  readonly aspectRatio: number;          // used for responsive canvas fit (Req 8.3)
  readonly keyMap: Readonly<Record<string, A>>;   // key -> action (Req 3.1)
  readonly scrollKeys: readonly string[];         // keys whose default scroll is prevented (Req 3.5)
  readonly touchControls: readonly TouchControlSpec[]; // Req 3.2

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
