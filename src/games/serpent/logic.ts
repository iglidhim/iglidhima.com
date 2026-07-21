// src/games/serpent/logic.ts
// Pure game logic for Serpent — an original, non-trademarked growing-snake game
// (snake genre). This module contains NO canvas or DOM code; the renderer and
// the `GameDefinition` export live in `index.ts` (a separate task). Everything
// here is a pure function of its inputs so the rules can be exercised directly
// under Vitest/fast-check (Requirements 4.3, 5.1).

// ---------------------------------------------------------------------------
// Board dimensions
// ---------------------------------------------------------------------------

/** Number of columns in the playfield. */
export const COLS = 20;
/** Number of rows in the playfield. */
export const ROWS = 20;

/** Move interval: the snake advances one cell every this many ms. */
export const MOVE_INTERVAL_MS = 120;

/** Points awarded each time the snake eats a food cell. */
export const SCORE_PER_FOOD = 10;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A 2D integer coordinate (x = column, y = row). */
export interface Point {
  x: number;
  y: number;
}

/** The four cardinal directions the snake can travel / be steered toward. */
export type Direction = "up" | "down" | "left" | "right";

/**
 * The player/simulation actions Serpent understands: a direction change.
 * A 180° reversal relative to the snake's current heading is ignored.
 */
export type SerpentAction = Direction;

/** The full runtime state advanced by `step`. Not persisted. */
export interface SerpentState {
  snake: Point[];       // head-first ordered body cells (snake[0] is the head)
  direction: Direction; // current heading
  food: Point;          // the current food cell
  score: number;        // current Score (>= 0, starts at 0)
  over: boolean;        // Game_Over_State flag
  seed: number;         // PRNG seed for deterministic food placement
  moveTimerMs: number;  // accumulated time toward the next move step
}

// ---------------------------------------------------------------------------
// Direction helpers
// ---------------------------------------------------------------------------

/** The opposite of each direction — used to forbid 180° reversals. */
const OPPOSITE: Readonly<Record<Direction, Direction>> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

/** The unit (dx, dy) step vector for each direction. */
const DELTA: Readonly<Record<Direction, Point>> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

// ---------------------------------------------------------------------------
// Food placement (deterministic PRNG so `step` stays pure)
// ---------------------------------------------------------------------------

/** A tiny linear-congruential generator; returns a value in [0, 1) and a new seed. */
function nextRandom(seed: number): { value: number; seed: number } {
  const next = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
  return { value: next / 0x7fffffff, seed: next };
}

/**
 * Choose a food cell on a random empty square (not occupied by the snake) using
 * the deterministic PRNG, returning the food and the advanced seed. When the
 * board is completely full the previous-style fallback places food on the head.
 */
function placeFood(snake: readonly Point[], seed: number): { food: Point; seed: number } {
  const occupied = new Set<string>(snake.map((p) => `${p.x},${p.y}`));
  const empty: Point[] = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (!occupied.has(`${x},${y}`)) empty.push({ x, y });
    }
  }
  if (empty.length === 0) {
    const head = snake[0] ?? { x: 0, y: 0 };
    return { food: { x: head.x, y: head.y }, seed };
  }
  const { value, seed: nextSeed } = nextRandom(seed);
  const idx = Math.min(empty.length - 1, Math.floor(value * empty.length));
  return { food: empty[idx]!, seed: nextSeed };
}

// ---------------------------------------------------------------------------
// Lifecycle + advance
// ---------------------------------------------------------------------------

/**
 * A new session: a short snake centered on the board heading right, food placed
 * on a deterministic empty cell, Score 0 (Requirement 4.3).
 */
export function createInitialState(): SerpentState {
  const cx = Math.floor(COLS / 2);
  const cy = Math.floor(ROWS / 2);
  // Head-first: head is right-most so the initial "right" heading is not a reversal.
  const snake: Point[] = [
    { x: cx, y: cy },
    { x: cx - 1, y: cy },
    { x: cx - 2, y: cy },
  ];
  const { food, seed } = placeFood(snake, 987654321);
  return {
    snake,
    direction: "right",
    food,
    score: 0,
    over: false,
    seed,
    moveTimerMs: 0,
  };
}

/** Whether a point lies outside the playfield. */
function outOfBounds(p: Point): boolean {
  return p.x < 0 || p.x >= COLS || p.y < 0 || p.y >= ROWS;
}

/**
 * Advance the snake one cell in its current direction:
 *  - moving into a wall or the snake's own body sets the Game_Over_State;
 *  - reaching the food grows the snake by exactly one cell, increases the Score,
 *    and respawns the food on a new empty cell;
 *  - otherwise the snake moves forward, keeping its length constant.
 *
 * Pure. A game already in the Game_Over_State is returned unchanged
 * (design Property 8, Property 14).
 */
export function advanceSnake(state: SerpentState): SerpentState {
  if (state.over) return state;

  const head = state.snake[0];
  if (!head) return { ...state, over: true };

  const delta = DELTA[state.direction];
  const newHead: Point = { x: head.x + delta.x, y: head.y + delta.y };

  // Wall collision ends play (Requirement 5.1).
  if (outOfBounds(newHead)) {
    return { ...state, over: true };
  }

  const eating = newHead.x === state.food.x && newHead.y === state.food.y;

  // When not eating, the tail vacates its cell this move, so it may be entered.
  const bodyToCheck = eating ? state.snake : state.snake.slice(0, -1);
  const hitsSelf = bodyToCheck.some((p) => p.x === newHead.x && p.y === newHead.y);
  if (hitsSelf) {
    return { ...state, over: true };
  }

  if (eating) {
    const grown: Point[] = [newHead, ...state.snake];
    const { food, seed } = placeFood(grown, state.seed);
    return {
      ...state,
      snake: grown,
      food,
      score: state.score + SCORE_PER_FOOD,
      seed,
    };
  }

  const moved: Point[] = [newHead, ...state.snake.slice(0, -1)];
  return { ...state, snake: moved };
}

/**
 * Advance the state by applying the buffered direction `actions` (a 180° reversal
 * relative to the snake's heading at the start of this step is ignored, and the
 * last valid direction wins), then stepping the snake once per elapsed move
 * interval in `dtMs`. Pure. A game already in the Game_Over_State is returned
 * unchanged, so play is halted and the Score is preserved (design Property 8).
 */
export function step(
  state: SerpentState,
  actions: readonly SerpentAction[],
  dtMs: number,
): SerpentState {
  if (state.over) return state;

  // Resolve the heading against the direction the snake is actually moving, so a
  // pair of turns within one step can never fold the snake back onto its neck.
  const movingDir = state.direction;
  let direction = state.direction;
  for (const action of actions) {
    if (action !== OPPOSITE[movingDir]) direction = action;
  }

  let current: SerpentState = { ...state, direction };
  let timer = current.moveTimerMs + Math.max(0, dtMs);
  while (timer >= MOVE_INTERVAL_MS) {
    timer -= MOVE_INTERVAL_MS;
    current = advanceSnake(current);
    if (current.over) {
      return { ...current, moveTimerMs: 0 };
    }
  }
  return { ...current, moveTimerMs: timer };
}

/** The end condition: the snake hit a wall or itself (Requirement 5.1). */
export function isGameOver(state: SerpentState): boolean {
  return state.over;
}

/** The current Score (Requirement 4.1); non-negative, starts at 0. */
export function getScore(state: SerpentState): number {
  return state.score;
}
