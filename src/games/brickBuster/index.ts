// src/games/brickBuster/index.ts
// Brick Buster — the canvas renderer plus the assembled `GameDefinition` that
// binds the pure logic (logic.ts) to the shared engine contract. This is the
// only module in the game that touches the canvas; the rules stay pure and
// separately testable (design: "clean split between pure logic and rendering").

import type { GameDefinition, Viewport } from "../../engine/types";
import {
  BALL_RADIUS,
  FIELD_HEIGHT,
  FIELD_WIDTH,
  createInitialState,
  getScore,
  isGameOver,
  paddleRect,
  step,
  type BrickBusterAction,
  type BrickState,
} from "./logic";

// ---------------------------------------------------------------------------
// Retro palette (mirrors the neon-arcade tokens in src/styles/global.css)
// ---------------------------------------------------------------------------

const COLOR_BG = "#0a0e1a"; // deep-space field background
const COLOR_BRICK = "#ff6ec7"; // neon pink — the brick wall
const COLOR_BRICK_HIGHLIGHT = "rgba(255, 255, 255, 0.22)"; // inset bevel
const COLOR_PADDLE = "#35e0f2"; // neon cyan — the paddle
const COLOR_BALL = "#ffe14d"; // neon yellow — the ball

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/**
 * Draw the Brick Buster playfield: the standing bricks, the paddle, and the
 * ball, scaling the FIELD_WIDTH×FIELD_HEIGHT logical field to fill the fitted
 * viewport. Pure with respect to state — only paints, never mutates. Only
 * alive bricks are drawn; broken ones vanish from the wall.
 */
function render(
  ctx: CanvasRenderingContext2D,
  state: BrickState,
  viewport: Viewport,
): void {
  const { width, height } = viewport;

  // Clear the whole viewport to the field background.
  ctx.fillStyle = COLOR_BG;
  ctx.fillRect(0, 0, width, height);

  if (width <= 0 || height <= 0) return;

  // Scale logical field units to viewport pixels on each axis.
  const scaleX = width / FIELD_WIDTH;
  const scaleY = height / FIELD_HEIGHT;

  // Bricks — alive only.
  for (const brick of state.bricks) {
    if (!brick.alive) continue;
    const x = brick.rect.x * scaleX;
    const y = brick.rect.y * scaleY;
    const w = brick.rect.width * scaleX;
    const h = brick.rect.height * scaleY;

    ctx.fillStyle = COLOR_BRICK;
    ctx.fillRect(x, y, w, h);

    // Inset highlight for a chunky, arcade feel.
    const inset = Math.max(1, Math.min(w, h) * 0.12);
    ctx.fillStyle = COLOR_BRICK_HIGHLIGHT;
    ctx.fillRect(x + inset, y + inset, w - inset * 2, Math.max(1, inset));
  }

  // Paddle.
  const paddle = paddleRect(state.paddle);
  ctx.fillStyle = COLOR_PADDLE;
  ctx.fillRect(
    paddle.x * scaleX,
    paddle.y * scaleY,
    paddle.width * scaleX,
    paddle.height * scaleY,
  );

  // Ball — an ellipse so the radius scales correctly on both axes.
  ctx.fillStyle = COLOR_BALL;
  ctx.beginPath();
  ctx.ellipse(
    state.ball.pos.x * scaleX,
    state.ball.pos.y * scaleY,
    BALL_RADIUS * scaleX,
    BALL_RADIUS * scaleY,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Dim the field when the game is over.
  if (state.over) {
    ctx.fillStyle = "rgba(10, 14, 26, 0.6)";
    ctx.fillRect(0, 0, width, height);
  }
}

// ---------------------------------------------------------------------------
// GameDefinition
// ---------------------------------------------------------------------------

/**
 * The assembled Brick Buster game: pure logic from `logic.ts` plus the canvas
 * renderer above, wired to the shared engine contract (Requirements 1.2, 3.1,
 * 3.2, 3.4, 3.5). Left/Right arrows and A/D move the paddle; Space launches the
 * resting ball. Those keys are declared as scroll keys so gameplay never
 * scrolls the page while running (Requirement 3.5). Touch controls provide
 * left/right movement plus a launch button (Requirement 3.2).
 */
export const brickBuster: GameDefinition<BrickState, BrickBusterAction> = {
  id: "brick-buster",
  name: "Brick Buster",
  instructions:
    "Move the paddle with the Left/Right arrow keys or A/D. Press Space to " +
    "launch the ball. Bounce it off the paddle to break every brick without " +
    "letting it fall past the bottom.",
  aspectRatio: FIELD_WIDTH / FIELD_HEIGHT,

  // Keyboard → action (Requirement 3.1).
  keyMap: {
    ArrowLeft: "left",
    ArrowRight: "right",
    a: "left",
    d: "right",
    A: "left",
    D: "right",
    " ": "launch",
  },

  // Keys whose default browser scrolling is prevented while playing (Req 3.5).
  scrollKeys: ["ArrowLeft", "ArrowRight", " "],

  // On-screen controls for touch devices (Requirement 3.2).
  touchControls: [
    { action: "left", label: "Move left", position: "left" },
    { action: "right", label: "Move right", position: "right" },
    { action: "launch", label: "Launch ball", position: "primary" },
  ],

  createInitialState,
  step,
  isGameOver,
  getScore,
  render,
};

export default brickBuster;
