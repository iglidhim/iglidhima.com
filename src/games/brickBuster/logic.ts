// src/games/brickBuster/logic.ts
// Pure game logic for Brick Buster — an original, non-trademarked paddle-and-ball
// brick-breaking game (brick-breaker genre). This module contains NO canvas or
// DOM code; the renderer and the `GameDefinition` export live in `index.ts`
// (a separate task). Everything here is a pure function of its inputs so the
// rules can be exercised directly under Vitest/fast-check (Requirements 4.3, 5.1).

// ---------------------------------------------------------------------------
// Field & object dimensions
// ---------------------------------------------------------------------------

/** Playfield width in logical units. */
export const FIELD_WIDTH = 400;
/** Playfield height in logical units. */
export const FIELD_HEIGHT = 500;

/** Ball radius. */
export const BALL_RADIUS = 6;

/** Paddle height and its fixed vertical position (near the bottom of the field). */
export const PADDLE_HEIGHT = 12;
export const PADDLE_WIDTH = 80;
export const PADDLE_Y = FIELD_HEIGHT - 32;
/** Horizontal paddle movement applied per `left`/`right` action. */
export const PADDLE_SPEED = 24;

/** Brick grid layout. */
export const BRICK_ROWS = 5;
export const BRICK_COLS = 8;
export const BRICK_GAP = 4;
export const BRICK_TOP = 40;
export const BRICK_HEIGHT = 18;

/** Lives the Visitor begins a session with. */
export const INITIAL_LIVES = 3;

/** Points awarded for each brick broken. */
export const POINTS_PER_BRICK = 10;

/** Initial ball velocity magnitude components (logical units per millisecond). */
const LAUNCH_VX = 0.18;
const LAUNCH_VY = -0.28;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A 2D vector / point (x horizontal, y vertical). */
export interface Vec2 {
  x: number;
  y: number;
}

/** An axis-aligned rectangle in field coordinates. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A single brick and whether it is still standing. */
export interface Brick {
  rect: Rect;
  alive: boolean;
}

/** The full runtime state advanced by `step`. Not persisted. */
export interface BrickState {
  paddle: { x: number; width: number };
  ball: { pos: Vec2; vel: Vec2 };
  bricks: Brick[];
  score: number;
  lives: number;
  over: boolean;
  launched: boolean; // false while the ball rests on the paddle awaiting launch
}

/** The player/simulation actions Brick Buster understands. */
export type BrickBusterAction = "left" | "right" | "launch" | "tick";

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Clamp `value` into the inclusive range [min, max]. */
function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Whether the ball (a circle at `pos` with radius `radius`) intersects `rect`.
 * Uses the closest-point-on-rectangle test: the circle overlaps the rectangle
 * when the nearest point of the rectangle to the circle's centre is within the
 * radius. Exported so tests can compute the expected struck set independently.
 */
export function ballIntersectsRect(pos: Vec2, radius: number, rect: Rect): boolean {
  const nearestX = clamp(pos.x, rect.x, rect.x + rect.width);
  const nearestY = clamp(pos.y, rect.y, rect.y + rect.height);
  const dx = pos.x - nearestX;
  const dy = pos.y - nearestY;
  return dx * dx + dy * dy <= radius * radius;
}

/** The paddle's rectangle for the given paddle model. */
export function paddleRect(paddle: { x: number; width: number }): Rect {
  return { x: paddle.x, y: PADDLE_Y, width: paddle.width, height: PADDLE_HEIGHT };
}

/** Count of bricks still standing. */
export function aliveBrickCount(state: BrickState): number {
  return state.bricks.reduce((n, brick) => (brick.alive ? n + 1 : n), 0);
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** Build the initial full brick grid (all alive), evenly spaced across the field. */
function createBricks(): Brick[] {
  const bricks: Brick[] = [];
  const usableWidth = FIELD_WIDTH - BRICK_GAP * (BRICK_COLS + 1);
  const brickWidth = usableWidth / BRICK_COLS;
  for (let row = 0; row < BRICK_ROWS; row++) {
    for (let col = 0; col < BRICK_COLS; col++) {
      bricks.push({
        rect: {
          x: BRICK_GAP + col * (brickWidth + BRICK_GAP),
          y: BRICK_TOP + row * (BRICK_HEIGHT + BRICK_GAP),
          width: brickWidth,
          height: BRICK_HEIGHT,
        },
        alive: true,
      });
    }
  }
  return bricks;
}

/** Rest the ball centred on top of the paddle, awaiting launch. */
function ballOnPaddle(paddle: { x: number; width: number }): Vec2 {
  return { x: paddle.x + paddle.width / 2, y: PADDLE_Y - BALL_RADIUS };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/** A new session: full brick wall, centred paddle, resting ball, Score 0 (Requirement 4.3). */
export function createInitialState(): BrickState {
  const paddle = { x: (FIELD_WIDTH - PADDLE_WIDTH) / 2, width: PADDLE_WIDTH };
  return {
    paddle,
    ball: { pos: ballOnPaddle(paddle), vel: { x: 0, y: 0 } },
    bricks: createBricks(),
    score: 0,
    lives: INITIAL_LIVES,
    over: false,
    launched: false,
  };
}

// ---------------------------------------------------------------------------
// Collision resolution
// ---------------------------------------------------------------------------

/**
 * Reflect the ball off the walls, the paddle, and any bricks it intersects;
 * remove every struck brick (each at most once) and award points for them.
 *
 * Brick intersection is evaluated against the ball's current position, so the
 * set of removed bricks is exactly the alive bricks the ball overlaps. The
 * alive-brick count never increases and the Score increases by the number of
 * bricks broken times `POINTS_PER_BRICK` (design Property 16).
 */
export function resolveBallCollisions(state: BrickState): BrickState {
  const r = BALL_RADIUS;
  const origin = state.ball.pos;

  // Break every alive brick the ball currently overlaps (each exactly once).
  let broken = 0;
  const bricks = state.bricks.map((brick) => {
    if (brick.alive && ballIntersectsRect(origin, r, brick.rect)) {
      broken += 1;
      return { rect: brick.rect, alive: false };
    }
    return brick;
  });

  // Compute the reflected ball position/velocity off walls, paddle, and bricks.
  let x = origin.x;
  let y = origin.y;
  let vx = state.ball.vel.x;
  let vy = state.ball.vel.y;

  // Left / right walls.
  if (x - r < 0) {
    x = r;
    vx = Math.abs(vx);
  } else if (x + r > FIELD_WIDTH) {
    x = FIELD_WIDTH - r;
    vx = -Math.abs(vx);
  }

  // Top wall.
  if (y - r < 0) {
    y = r;
    vy = Math.abs(vy);
  }

  // Paddle: reflect upward only when descending and overlapping the paddle.
  if (vy > 0 && ballIntersectsRect({ x, y }, r, paddleRect(state.paddle))) {
    y = PADDLE_Y - r;
    vy = -Math.abs(vy);
  }

  // Any brick hit reflects the ball vertically.
  if (broken > 0) {
    vy = -vy;
  }

  return {
    ...state,
    ball: { pos: { x, y }, vel: { x: vx, y: vy } },
    bricks,
    score: state.score + broken * POINTS_PER_BRICK,
  };
}

// ---------------------------------------------------------------------------
// Advance
// ---------------------------------------------------------------------------

/** Apply a single discrete action (paddle movement / launch). */
function applyAction(state: BrickState, action: BrickBusterAction): BrickState {
  switch (action) {
    case "left": {
      const x = clamp(state.paddle.x - PADDLE_SPEED, 0, FIELD_WIDTH - state.paddle.width);
      const paddle = { ...state.paddle, x };
      // While resting, the ball tracks the paddle.
      const pos = state.launched ? state.ball.pos : ballOnPaddle(paddle);
      return { ...state, paddle, ball: { ...state.ball, pos } };
    }
    case "right": {
      const x = clamp(state.paddle.x + PADDLE_SPEED, 0, FIELD_WIDTH - state.paddle.width);
      const paddle = { ...state.paddle, x };
      const pos = state.launched ? state.ball.pos : ballOnPaddle(paddle);
      return { ...state, paddle, ball: { ...state.ball, pos } };
    }
    case "launch": {
      if (state.launched) return state;
      return {
        ...state,
        launched: true,
        ball: { pos: state.ball.pos, vel: { x: LAUNCH_VX, y: LAUNCH_VY } },
      };
    }
    default:
      return state;
  }
}

/** Reset the ball to rest on the paddle after a life is lost. */
function resetBall(state: BrickState): BrickState {
  return {
    ...state,
    launched: false,
    ball: { pos: ballOnPaddle(state.paddle), vel: { x: 0, y: 0 } },
  };
}

/** Advance the ball by the elapsed frame time, resolving collisions and life loss. */
function advanceBall(state: BrickState, dtMs: number): BrickState {
  if (!state.launched) {
    // The ball waits on the paddle; nothing to simulate yet.
    return state;
  }

  const dt = Math.max(0, dtMs);
  const moved: BrickState = {
    ...state,
    ball: {
      pos: {
        x: state.ball.pos.x + state.ball.vel.x * dt,
        y: state.ball.pos.y + state.ball.vel.y * dt,
      },
      vel: state.ball.vel,
    },
  };

  let next = resolveBallCollisions(moved);

  // Ball lost past the bottom edge: lose a life (Requirement 5.1 end condition).
  if (next.ball.pos.y - BALL_RADIUS > FIELD_HEIGHT) {
    const lives = next.lives - 1;
    if (lives <= 0) {
      return { ...next, lives: 0, over: true };
    }
    next = resetBall({ ...next, lives });
  }

  // All bricks cleared: the session ends victorious.
  if (aliveBrickCount(next) === 0) {
    return { ...next, over: true };
  }

  return next;
}

/**
 * Advance the state by applying the buffered `actions` in order, then advancing
 * the ball for the elapsed `dtMs`. Pure. A game already in the Game_Over_State
 * is returned unchanged, so play is halted and the Score is preserved
 * (design Property 8).
 */
export function step(
  state: BrickState,
  actions: readonly BrickBusterAction[],
  dtMs: number,
): BrickState {
  if (state.over) return state;

  let current = state;
  for (const action of actions) {
    current = applyAction(current, action);
    if (current.over) return current;
  }
  return advanceBall(current, dtMs);
}

/** The end condition: the ball was lost with no lives left, or all bricks cleared (Requirement 5.1). */
export function isGameOver(state: BrickState): boolean {
  return state.over;
}

/** The current Score (Requirement 4.1); non-negative, starts at 0. */
export function getScore(state: BrickState): number {
  return state.score;
}
