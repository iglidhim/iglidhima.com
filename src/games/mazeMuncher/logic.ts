// src/games/mazeMuncher/logic.ts
// Pure game logic for Maze Muncher — an original, non-trademarked maze-chase
// game (maze-chase genre). The player navigates a maze grid collecting pellets
// while avoiding pursuers. This module contains NO canvas or DOM code; the
// renderer and the `GameDefinition` export live in `index.ts` (a separate
// task). Everything here is a pure function of its inputs so the rules can be
// exercised directly under Vitest/fast-check (Requirements 4.3, 5.1).

// ---------------------------------------------------------------------------
// Cell kinds
// ---------------------------------------------------------------------------

/** A maze cell: 0 = empty (walkable, no pellet), 1 = wall, 2 = pellet. */
export type MazeCell = 0 | 1 | 2;

/** Walkable empty cell. */
export const EMPTY: MazeCell = 0;
/** Impassable wall cell. */
export const WALL: MazeCell = 1;
/** Walkable cell containing a collectible pellet. */
export const PELLET: MazeCell = 2;

/** Points awarded for collecting a single pellet. */
export const PELLET_SCORE = 10;

/** A pursuer takes one step every this many ms of simulated time. */
export const PURSUER_INTERVAL_MS = 400;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A 2D integer coordinate (x = column, y = row). */
export interface Point {
  x: number;
  y: number;
}

/** The player/simulation actions Maze Muncher understands. */
export type MazeMuncherAction = "up" | "down" | "left" | "right";

/** The full runtime state advanced by `step`. Not persisted. */
export interface MazeState {
  board: MazeCell[][]; // rows x cols; board[row][col]
  player: Point;
  pursuers: Point[];
  score: number; // current Score (>= 0, starts at 0)
  over: boolean; // Game_Over_State flag (pursuer contact OR maze cleared)
  won: boolean; // true when the maze was cleared of pellets
  moveTimerMs: number; // accumulated time toward the next pursuer step
}

// ---------------------------------------------------------------------------
// Maze template
// ---------------------------------------------------------------------------

// A compact, fully walled-in maze. Legend:
//   '#' wall, '.' pellet, ' ' empty, 'P' player start, 'G' pursuer start.
// Player and pursuer start cells are laid down as EMPTY (no pellet beneath).
const MAZE_TEMPLATE: readonly string[] = [
  "#############",
  "#P..........#",
  "#.###.###.#.#",
  "#...........#",
  "#.#.#####.#.#",
  "#.#...G...#.#",
  "#.#.#####.#.#",
  "#...........#",
  "#.###.###.#.#",
  "#..........G#",
  "#############",
];

// ---------------------------------------------------------------------------
// Board helpers
// ---------------------------------------------------------------------------

/** Number of rows in a board. */
function rowCount(board: readonly MazeCell[][]): number {
  return board.length;
}

/** Number of columns in a board (0 for an empty board). */
function colCount(board: readonly MazeCell[][]): number {
  return board[0]?.length ?? 0;
}

/** Whether a coordinate lies inside the board bounds. */
function inBounds(board: readonly MazeCell[][], p: Point): boolean {
  return p.y >= 0 && p.y < rowCount(board) && p.x >= 0 && p.x < colCount(board);
}

/** Whether a coordinate is walkable (in bounds and not a wall). */
function isWalkable(board: readonly MazeCell[][], p: Point): boolean {
  return inBounds(board, p) && board[p.y]![p.x] !== WALL;
}

/** A deep copy of a board so mutations never leak across states. */
function cloneBoard(board: readonly MazeCell[][]): MazeCell[][] {
  return board.map((row) => [...row]);
}

/**
 * The number of pellets still on the board (design Property 15).
 */
export function pelletsRemaining(state: MazeState): number {
  let count = 0;
  for (const row of state.board) {
    for (const cell of row) {
      if (cell === PELLET) count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Pellet collection
// ---------------------------------------------------------------------------

/**
 * Eat the pellet at the player's current cell, if any.
 *
 * When the player's cell holds a pellet, that cell becomes empty and the Score
 * increases by `PELLET_SCORE` — so the remaining pellet count drops by exactly
 * one. When the player's cell holds no pellet, the state is returned unchanged,
 * leaving both the pellet count and the Score untouched (design Property 15).
 */
export function collectPellet(state: MazeState): MazeState {
  const { player, board } = state;
  if (!inBounds(board, player) || board[player.y]![player.x] !== PELLET) {
    return state;
  }
  const nextBoard = cloneBoard(board);
  nextBoard[player.y]![player.x] = EMPTY;
  return { ...state, board: nextBoard, score: state.score + PELLET_SCORE };
}

// ---------------------------------------------------------------------------
// Player movement
// ---------------------------------------------------------------------------

const DELTAS: Readonly<Record<MazeMuncherAction, Point>> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/**
 * Move the player one cell in `dir`, blocked by walls and the board edge, then
 * collect any pellet on the destination cell. A blocked move leaves the state
 * unchanged.
 */
function movePlayer(state: MazeState, dir: MazeMuncherAction): MazeState {
  const delta = DELTAS[dir];
  const target: Point = { x: state.player.x + delta.x, y: state.player.y + delta.y };
  if (!isWalkable(state.board, target)) {
    return state;
  }
  return collectPellet({ ...state, player: target });
}

// ---------------------------------------------------------------------------
// Pursuers
// ---------------------------------------------------------------------------

/** True when any pursuer occupies the player's cell. */
function pursuerCaughtPlayer(state: MazeState): boolean {
  return state.pursuers.some((p) => p.x === state.player.x && p.y === state.player.y);
}

/**
 * Advance one pursuer one step. It greedily chases the player: it prefers the
 * axis with the greater remaining distance, falling back to the other axis, and
 * stays put when both candidate cells are walls. Deterministic and pure.
 */
function stepPursuer(board: readonly MazeCell[][], pursuer: Point, player: Point): Point {
  const dx = player.x - pursuer.x;
  const dy = player.y - pursuer.y;

  const horizontal: Point = { x: pursuer.x + Math.sign(dx), y: pursuer.y };
  const vertical: Point = { x: pursuer.x, y: pursuer.y + Math.sign(dy) };

  // Order the two candidate moves by which axis is farther from the player.
  const candidates =
    Math.abs(dx) >= Math.abs(dy) ? [horizontal, vertical] : [vertical, horizontal];

  for (const candidate of candidates) {
    if ((candidate.x !== pursuer.x || candidate.y !== pursuer.y) && isWalkable(board, candidate)) {
      return candidate;
    }
  }
  return pursuer;
}

/** Advance every pursuer one step toward the player. */
function stepPursuers(state: MazeState): MazeState {
  const pursuers = state.pursuers.map((p) => stepPursuer(state.board, p, state.player));
  return { ...state, pursuers };
}

// ---------------------------------------------------------------------------
// Lifecycle + advance
// ---------------------------------------------------------------------------

/**
 * A new session parsed from the maze template: pellets laid out, player and
 * pursuers at their start cells, Score 0 (Requirement 4.3).
 */
export function createInitialState(): MazeState {
  const board: MazeCell[][] = [];
  let player: Point = { x: 1, y: 1 };
  const pursuers: Point[] = [];

  MAZE_TEMPLATE.forEach((line, y) => {
    const row: MazeCell[] = [];
    for (let x = 0; x < line.length; x++) {
      const ch = line[x];
      switch (ch) {
        case "#":
          row.push(WALL);
          break;
        case ".":
          row.push(PELLET);
          break;
        case "P":
          player = { x, y };
          row.push(EMPTY);
          break;
        case "G":
          pursuers.push({ x, y });
          row.push(EMPTY);
          break;
        default:
          row.push(EMPTY);
          break;
      }
    }
    board.push(row);
  });

  return {
    board,
    player,
    pursuers,
    score: 0,
    over: false,
    won: false,
    moveTimerMs: 0,
  };
}

/**
 * Advance the state by applying the buffered `actions` in order, then advancing
 * the pursuers for the elapsed `dtMs`. Pure. A game already in the
 * Game_Over_State is returned unchanged, so play is halted and the Score is
 * preserved (design Property 8).
 */
export function step(
  state: MazeState,
  actions: readonly MazeMuncherAction[],
  dtMs: number,
): MazeState {
  if (state.over) return state;

  let current = state;

  // Apply each directional action; each may move the player and eat a pellet.
  for (const action of actions) {
    current = movePlayer(current, action);
    if (pursuerCaughtPlayer(current)) {
      return { ...current, over: true };
    }
    if (pelletsRemaining(current) === 0) {
      return { ...current, over: true, won: true };
    }
  }

  // Advance pursuers on a fixed cadence driven by elapsed time.
  let timer = current.moveTimerMs + Math.max(0, dtMs);
  while (timer >= PURSUER_INTERVAL_MS) {
    timer -= PURSUER_INTERVAL_MS;
    current = stepPursuers(current);
    if (pursuerCaughtPlayer(current)) {
      return { ...current, over: true, moveTimerMs: 0 };
    }
  }

  return { ...current, moveTimerMs: timer };
}

/** The end condition: caught by a pursuer or the maze is cleared (Requirement 5.1). */
export function isGameOver(state: MazeState): boolean {
  return state.over;
}

/** The current Score (Requirement 4.1); non-negative, starts at 0. */
export function getScore(state: MazeState): number {
  return state.score;
}
