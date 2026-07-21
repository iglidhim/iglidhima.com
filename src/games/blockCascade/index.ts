// src/games/blockCascade/index.ts
// Block Cascade — the canvas renderer plus the assembled `GameDefinition` that
// binds the pure logic (logic.ts) to the shared engine contract. This is the
// only module in the game that touches the canvas; the rules stay pure and
// separately testable (design: "clean split between pure logic and rendering").

import type { GameDefinition, Viewport } from "../../engine/types";
import {
  COLS,
  ROWS,
  createInitialState,
  getScore,
  isGameOver,
  pieceCells,
  step,
  type BlockCascadeAction,
  type BlockCascadeState,
} from "./logic";

// ---------------------------------------------------------------------------
// Retro palette
// ---------------------------------------------------------------------------

/** Deep-space field background (matches the site's --color-bg family). */
const FIELD_BG = "#0a0e1a";
/** Subtle grid line colour drawn between cells. */
const GRID_LINE = "#2c3557";

/**
 * Neon tints for cell colour ids 1..7 (index 0 is the empty cell and is never
 * drawn as a block). Ordered to mirror the seven shapes in `logic.ts`.
 */
const CELL_COLORS: readonly string[] = [
  "transparent", // 0 — empty
  "#35e0f2",     // 1 — cyan   (I)
  "#ffe14d",     // 2 — yellow (O)
  "#c77dff",     // 3 — violet (T)
  "#4ade80",     // 4 — green  (S)
  "#ff6ec7",     // 5 — pink   (Z)
  "#5b8cff",     // 6 — blue   (J)
  "#ff9f45",     // 7 — orange (L)
];

/** Fallback tint for any out-of-range colour id. */
const DEFAULT_CELL = "#35e0f2";

function cellColor(id: number): string {
  return CELL_COLORS[id] ?? DEFAULT_CELL;
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/**
 * Draw a single filled block at board coordinate (col, row) with a bright fill
 * and an inset highlight for a chunky, retro look.
 */
function drawBlock(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
  cell: number,
  originX: number,
  originY: number,
  cellSize: number,
): void {
  const x = originX + col * cellSize;
  const y = originY + row * cellSize;
  const color = cellColor(cell);

  ctx.fillStyle = color;
  ctx.fillRect(x, y, cellSize, cellSize);

  // Inset highlight for a beveled, arcade feel.
  const inset = Math.max(1, cellSize * 0.12);
  ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
  ctx.fillRect(x + inset, y + inset, cellSize - inset * 2, Math.max(1, inset));

  // Border to separate adjacent blocks.
  ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1);
}

/**
 * Render the playfield and the active piece into the fitted viewport. The board
 * is centred within the viewport and every cell is a square, so the display
 * preserves the COLS:ROWS aspect ratio regardless of the canvas size.
 */
function render(
  ctx: CanvasRenderingContext2D,
  state: BlockCascadeState,
  viewport: Viewport,
): void {
  const { width, height } = viewport;

  // Clear the whole viewport to the field background.
  ctx.fillStyle = FIELD_BG;
  ctx.fillRect(0, 0, width, height);

  // Largest square cell that fits both dimensions; centre the board.
  const cellSize = Math.max(0, Math.min(width / COLS, height / ROWS));
  const boardW = cellSize * COLS;
  const boardH = cellSize * ROWS;
  const originX = (width - boardW) / 2;
  const originY = (height - boardH) / 2;

  if (cellSize <= 0) return;

  // Grid lines.
  ctx.strokeStyle = GRID_LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let c = 0; c <= COLS; c++) {
    const x = originX + c * cellSize;
    ctx.moveTo(x, originY);
    ctx.lineTo(x, originY + boardH);
  }
  for (let r = 0; r <= ROWS; r++) {
    const y = originY + r * cellSize;
    ctx.moveTo(originX, y);
    ctx.lineTo(originX + boardW, y);
  }
  ctx.stroke();

  // Locked cells.
  for (let r = 0; r < state.grid.length; r++) {
    const row = state.grid[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (cell && cell !== 0) {
        drawBlock(ctx, c, r, cell, originX, originY, cellSize);
      }
    }
  }

  // Active falling piece (skip cells above the top edge).
  for (const p of pieceCells(state.active)) {
    if (p.y >= 0 && p.y < ROWS && p.x >= 0 && p.x < COLS) {
      drawBlock(ctx, p.x, p.y, state.active.color, originX, originY, cellSize);
    }
  }

  // Dim the field when the game is over.
  if (state.over) {
    ctx.fillStyle = "rgba(10, 14, 26, 0.6)";
    ctx.fillRect(originX, originY, boardW, boardH);
  }
}

// ---------------------------------------------------------------------------
// GameDefinition
// ---------------------------------------------------------------------------

/**
 * The assembled Block Cascade game: pure logic from `logic.ts` plus the canvas
 * renderer above, wired to the shared engine contract (Requirements 1.2, 3.1,
 * 3.2, 3.4, 3.5).
 */
export const blockCascade: GameDefinition<BlockCascadeState, BlockCascadeAction> = {
  id: "block-cascade",
  name: "Tetris",
  instructions:
    "Stack the falling blocks to complete full rows. Left/Right arrows move, " +
    "Up rotates, Down soft-drops, and Space hard-drops. Clear lines to score; " +
    "the game ends when the stack reaches the top.",
  aspectRatio: COLS / ROWS,

  // Keyboard → action (Requirement 3.1).
  keyMap: {
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowUp: "rotate",
    ArrowDown: "softDrop",
    " ": "hardDrop",
  },

  // Keys whose default browser scrolling is prevented while playing (Req 3.5).
  scrollKeys: ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "],

  // On-screen controls for touch devices (Requirement 3.2).
  touchControls: [
    { action: "left", label: "Move left", position: "left" },
    { action: "right", label: "Move right", position: "right" },
    { action: "rotate", label: "Rotate", position: "up" },
    { action: "hardDrop", label: "Drop", position: "primary" },
  ],

  createInitialState,
  step,
  isGameOver,
  getScore,
  render,
};

export default blockCascade;
