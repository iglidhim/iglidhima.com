// src/games/mazeMuncher/index.ts
// Maze Muncher — canvas renderer + the shared `GameDefinition` export.
//
// This module is the game's public surface: it pairs the pure rules from
// `logic.ts` (which contain no DOM/canvas code) with a `render` function and
// the metadata the engine and hub need to run the game uniformly (Req 1.2,
// 2.x). The renderer is the ONLY part of the game that touches the canvas; all
// rules stay pure and testable in `logic.ts`.

import type { GameDefinition, Viewport } from "../../engine/types";
import {
  EMPTY,
  PELLET,
  WALL,
  createInitialState,
  getScore,
  isGameOver,
  step,
  type MazeMuncherAction,
  type MazeState,
} from "./logic";

// ---------------------------------------------------------------------------
// Retro palette (mirrors the CSS design tokens in src/styles/global.css so the
// game field reads as part of the same neon-on-deep-space arcade theme).
// ---------------------------------------------------------------------------

const COLOR_BG = "#0a0e1a"; // --color-bg: deep space background
const COLOR_WALL = "#2c3557"; // --color-border: maze walls
const COLOR_WALL_EDGE = "#35e0f2"; // --color-accent-cyan: wall glow edge
const COLOR_PELLET = "#ffe14d"; // --color-accent-yellow: pellets
const COLOR_PLAYER = "#4ade80"; // --color-accent-green: the muncher
const COLOR_PURSUER = "#ff6ec7"; // --color-accent-pink: pursuers

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/**
 * Draw the current maze state onto the 2D canvas.
 *
 * Board dimensions are derived from the state itself (rows = `board.length`,
 * cols = `board[0].length`), so the renderer needs no external knowledge of the
 * maze size. Cells are square: the cell size is the largest that fits the
 * viewport in both dimensions, and the board is centred in any leftover space.
 */
function render(ctx: CanvasRenderingContext2D, state: MazeState, viewport: Viewport): void {
  const { width, height } = viewport;
  const rows = state.board.length;
  const cols = state.board[0]?.length ?? 0;

  // Clear the field to the background colour first.
  ctx.fillStyle = COLOR_BG;
  ctx.fillRect(0, 0, width, height);
  if (rows === 0 || cols === 0) return;

  // Square cells sized to fit, with the board centred in the viewport.
  const cell = Math.max(0, Math.floor(Math.min(width / cols, height / rows)));
  if (cell === 0) return;
  const boardW = cell * cols;
  const boardH = cell * rows;
  const originX = Math.floor((width - boardW) / 2);
  const originY = Math.floor((height - boardH) / 2);

  // Walls and pellets.
  for (let y = 0; y < rows; y++) {
    const row = state.board[y]!;
    for (let x = 0; x < cols; x++) {
      const px = originX + x * cell;
      const py = originY + y * cell;
      const kind = row[x];

      if (kind === WALL) {
        ctx.fillStyle = COLOR_WALL;
        ctx.fillRect(px, py, cell, cell);
        // Thin neon edge for the retro glow.
        ctx.strokeStyle = COLOR_WALL_EDGE;
        ctx.lineWidth = Math.max(1, cell * 0.06);
        ctx.strokeRect(px + 0.5, py + 0.5, cell - 1, cell - 1);
      } else if (kind === PELLET) {
        ctx.fillStyle = COLOR_PELLET;
        ctx.beginPath();
        ctx.arc(px + cell / 2, py + cell / 2, Math.max(1, cell * 0.14), 0, Math.PI * 2);
        ctx.fill();
      } else if (kind === EMPTY) {
        // No drawing needed for empty walkable cells.
      }
    }
  }

  // Player — a filled circle in the accent green.
  const playerR = cell * 0.38;
  ctx.fillStyle = COLOR_PLAYER;
  ctx.beginPath();
  ctx.arc(
    originX + state.player.x * cell + cell / 2,
    originY + state.player.y * cell + cell / 2,
    playerR,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Pursuers — filled circles in the accent pink.
  const pursuerR = cell * 0.34;
  ctx.fillStyle = COLOR_PURSUER;
  for (const pursuer of state.pursuers) {
    ctx.beginPath();
    ctx.arc(
      originX + pursuer.x * cell + cell / 2,
      originY + pursuer.y * cell + cell / 2,
      pursuerR,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// GameDefinition export
// ---------------------------------------------------------------------------

/**
 * Aspect ratio derived from the maze board (cols / rows) so the responsive
 * canvas-fit keeps square cells regardless of container size (Req 8.3).
 */
const initialBoard = createInitialState().board;
const BOARD_COLS = initialBoard[0]?.length ?? 1;
const BOARD_ROWS = initialBoard.length || 1;

/**
 * The Maze Muncher game: pure logic from `logic.ts` + the renderer above,
 * bundled with the metadata the hub and engine consume.
 */
export const mazeMuncher: GameDefinition<MazeState, MazeMuncherAction> = {
  id: "maze-muncher",
  name: "Pac-Man",
  instructions:
    "Use the arrow keys or WASD to navigate the maze. Collect every pellet to win, but don't let the pursuers catch you.",
  aspectRatio: BOARD_COLS / BOARD_ROWS,

  // Arrow keys and WASD (both cases) map to the four directions (Req 3.1).
  keyMap: {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
    w: "up",
    a: "left",
    s: "down",
    d: "right",
    W: "up",
    A: "left",
    S: "down",
    D: "right",
  },

  // Arrow keys scroll the page by default; suppress that while playing (Req 3.5).
  scrollKeys: ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"],

  // On-screen directional pad for touch devices (Req 3.2).
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

export default mazeMuncher;
