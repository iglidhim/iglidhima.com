// src/games/serpent/index.ts
// Serpent renderer + `GameDefinition` assembly (Task 11.3).
//
// This module is the only part of Serpent allowed to touch the canvas. It
// imports the pure rules from `logic.ts` and wires them into the shared
// `GameDefinition<SerpentState, SerpentAction>` contract so the engine can
// drive Serpent uniformly (Requirements 1.2, 3.1, 3.2, 3.4, 3.5).

import type { GameDefinition, Viewport } from "../../engine/types";
import {
  COLS,
  ROWS,
  createInitialState,
  step,
  isGameOver,
  getScore,
  type SerpentState,
  type SerpentAction,
} from "./logic";

// ---------------------------------------------------------------------------
// Retro palette (mirrors the neon-arcade tokens in src/styles/global.css)
// ---------------------------------------------------------------------------

const COLOR_BG = "#0a0e1a"; // deep-space background
const COLOR_GRID = "#1d2540"; // subtle grid lines
const COLOR_SNAKE_HEAD = "#35e0f2"; // neon cyan — the head stands out
const COLOR_SNAKE_BODY = "#4ade80"; // neon green — the body
const COLOR_FOOD = "#ff6ec7"; // neon pink — the food

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/**
 * Draw the Serpent playfield: a COLS×ROWS grid with the snake and food scaled
 * to the current viewport. Pure with respect to state — only paints, never
 * mutates. The head is drawn in a distinct colour from the body so movement
 * direction reads clearly.
 */
function render(
  ctx: CanvasRenderingContext2D,
  state: SerpentState,
  viewport: Viewport,
): void {
  const { width, height } = viewport;
  const cellW = width / COLS;
  const cellH = height / ROWS;

  // Background.
  ctx.fillStyle = COLOR_BG;
  ctx.fillRect(0, 0, width, height);

  // Grid lines.
  ctx.strokeStyle = COLOR_GRID;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let c = 0; c <= COLS; c++) {
    const x = Math.round(c * cellW) + 0.5;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let r = 0; r <= ROWS; r++) {
    const y = Math.round(r * cellH) + 0.5;
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();

  // Food.
  ctx.fillStyle = COLOR_FOOD;
  fillCell(ctx, state.food.x, state.food.y, cellW, cellH);

  // Snake — body first, then the head on top so it always reads clearly.
  for (let i = state.snake.length - 1; i >= 0; i--) {
    const seg = state.snake[i]!;
    ctx.fillStyle = i === 0 ? COLOR_SNAKE_HEAD : COLOR_SNAKE_BODY;
    fillCell(ctx, seg.x, seg.y, cellW, cellH);
  }
}

/** Fill a single grid cell, inset slightly so cells read as distinct tiles. */
function fillCell(
  ctx: CanvasRenderingContext2D,
  gx: number,
  gy: number,
  cellW: number,
  cellH: number,
): void {
  const pad = Math.max(1, Math.min(cellW, cellH) * 0.08);
  ctx.fillRect(
    gx * cellW + pad,
    gy * cellH + pad,
    cellW - pad * 2,
    cellH - pad * 2,
  );
}

// ---------------------------------------------------------------------------
// GameDefinition assembly
// ---------------------------------------------------------------------------

/**
 * The Serpent `GameDefinition`. Arrow keys and WASD both steer; the arrow keys
 * are also declared as scroll keys so gameplay never scrolls the page while
 * running (Requirement 3.5). Touch controls provide a d-pad for touch devices
 * (Requirement 3.2). The board is square, so the aspect ratio is COLS/ROWS = 1
 * (Requirement 8.3).
 */
export const serpent: GameDefinition<SerpentState, SerpentAction> = {
  id: "serpent",
  name: "Serpent",
  instructions:
    "Steer the serpent with the arrow keys or WASD. Eat the food to grow and score. Avoid the walls and your own tail.",
  aspectRatio: COLS / ROWS,
  keyMap: {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
    w: "up",
    s: "down",
    a: "left",
    d: "right",
    W: "up",
    S: "down",
    A: "left",
    D: "right",
  },
  scrollKeys: ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"],
  touchControls: [
    { action: "up", label: "Move up", position: "up" },
    { action: "down", label: "Move down", position: "down" },
    { action: "left", label: "Move left", position: "left" },
    { action: "right", label: "Move right", position: "right" },
  ],
  createInitialState,
  step,
  isGameOver,
  getScore,
  render,
};

export default serpent;
