// src/games/blockCascade/logic.ts
// Pure game logic for Block Cascade — an original, non-trademarked falling-block
// stacking puzzle (block-stacking genre). This module contains NO canvas or DOM
// code; the renderer and the `GameDefinition` export live in `index.ts`
// (a separate task). Everything here is a pure function of its inputs so the
// rules can be exercised directly under Vitest/fast-check (Requirements 4.3, 5.1).

// ---------------------------------------------------------------------------
// Board dimensions
// ---------------------------------------------------------------------------

/** Number of columns in the playfield. */
export const COLS = 10;
/** Number of rows in the playfield. */
export const ROWS = 20;

/** Gravity interval: the falling piece drops one row every this many ms. */
export const GRAVITY_INTERVAL_MS = 800;

/** Points awarded for clearing 0..4 lines in a single lock. */
export const LINE_SCORES: readonly number[] = [0, 100, 300, 500, 800];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A grid cell: 0 = empty, 1..7 = a filled cell tinted by piece color id. */
export type Cell = number;

/** A 2D integer coordinate (x = column, y = row). */
export interface Point {
  x: number;
  y: number;
}

/** The seven tetromino-like shapes (original names, standard geometry). */
export type ShapeKind = "I" | "O" | "T" | "S" | "Z" | "J" | "L";

/**
 * A falling piece. Its occupied cells are derived on demand from the shape
 * table, its rotation index, and its (x, y) board offset — see `pieceCells`.
 */
export interface Piece {
  kind: ShapeKind;
  color: number;    // 1..7, used only by the renderer
  rotation: number; // rotation index; occupied cells = base rotated `rotation` quarter-turns
  x: number;        // column offset of the piece origin
  y: number;        // row offset of the piece origin (may be negative near spawn)
}

/** The full runtime state advanced by `step`. Not persisted. */
export interface BlockCascadeState {
  grid: Cell[][];      // ROWS x COLS; grid[row][col]
  active: Piece;       // the currently falling piece
  next: Piece;         // the piece that spawns after the active one locks
  score: number;       // current Score (>= 0, starts at 0)
  over: boolean;       // Game_Over_State flag
  seed: number;        // PRNG seed for deterministic piece generation
  dropTimerMs: number; // accumulated time toward the next gravity step
}

/** The player/simulation actions Block Cascade understands. */
export type BlockCascadeAction =
  | "left"
  | "right"
  | "rotate"
  | "softDrop"
  | "hardDrop"
  | "tick";

// ---------------------------------------------------------------------------
// Shape geometry
// ---------------------------------------------------------------------------

// Base (rotation 0) occupied cells for each shape, in a small bounding box.
const BASE_SHAPES: Readonly<Record<ShapeKind, readonly Point[]>> = {
  I: [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }],
  O: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
  T: [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
  S: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
  Z: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
  J: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
  L: [{ x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
};

const KINDS: readonly ShapeKind[] = ["I", "O", "T", "S", "Z", "J", "L"];

/**
 * Rotate a set of cells 90 degrees clockwise `times` quarter-turns and
 * re-normalize into a non-negative bounding box. Pure; used to derive each
 * rotation from the base shape.
 */
function rotateCells(cells: readonly Point[], times: number): Point[] {
  let result = cells.map((c) => ({ x: c.x, y: c.y }));
  const turns = ((times % 4) + 4) % 4;
  for (let t = 0; t < turns; t++) {
    // 90 deg clockwise: (x, y) -> (y, -x), then shift back to the origin.
    result = result.map((c) => ({ x: c.y, y: -c.x }));
    let minX = Infinity;
    let minY = Infinity;
    for (const c of result) {
      if (c.x < minX) minX = c.x;
      if (c.y < minY) minY = c.y;
    }
    result = result.map((c) => ({ x: c.x - minX, y: c.y - minY }));
  }
  return result;
}

/** Absolute board coordinates occupied by a piece in its current rotation. */
export function pieceCells(piece: Piece): Point[] {
  return rotateCells(BASE_SHAPES[piece.kind], piece.rotation).map((c) => ({
    x: c.x + piece.x,
    y: c.y + piece.y,
  }));
}

// ---------------------------------------------------------------------------
// Grid helpers
// ---------------------------------------------------------------------------

/** A fresh empty ROWS x COLS grid of zeros. */
export function createEmptyGrid(): Cell[][] {
  const grid: Cell[][] = [];
  for (let r = 0; r < ROWS; r++) {
    grid.push(new Array<Cell>(COLS).fill(0));
  }
  return grid;
}

/** True when a row is completely filled (has width and no empty cell). */
function isRowFull(row: readonly Cell[]): boolean {
  return row.length > 0 && row.every((cell) => cell !== 0);
}

/**
 * Whether `piece` overlaps a filled cell or lies outside the playfield.
 *
 * Cells above the top edge (y < 0) are permitted — a piece may spawn or rotate
 * partly above the visible field — but horizontal bounds and the floor are
 * always enforced, as is overlap with any already-filled cell.
 */
export function collides(grid: Cell[][], piece: Piece): boolean {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  for (const cell of pieceCells(piece)) {
    if (cell.x < 0 || cell.x >= cols) return true;
    if (cell.y >= rows) return true;
    if (cell.y >= 0) {
      const row = grid[cell.y];
      if (row && row[cell.x] !== 0) return true;
    }
  }
  return false;
}

/** Merge a locked piece into a copy of the grid, tinting cells by its color. */
function mergePiece(grid: Cell[][], piece: Piece): Cell[][] {
  const next = grid.map((row) => [...row]);
  const rows = next.length;
  const cols = next[0]?.length ?? 0;
  for (const cell of pieceCells(piece)) {
    if (cell.y >= 0 && cell.y < rows && cell.x >= 0 && cell.x < cols) {
      next[cell.y]![cell.x] = piece.color;
    }
  }
  return next;
}

/**
 * Remove every fully filled row, preserving the surviving rows in their
 * original order shifted down, and prepending empty rows so the grid keeps its
 * exact column width and row height.
 *
 * @returns the new grid and the number of rows cleared (design Property 13).
 */
export function clearLines(grid: Cell[][]): { grid: Cell[][]; cleared: number } {
  const cols = grid[0]?.length ?? 0;
  const surviving = grid.filter((row) => !isRowFull(row));
  const cleared = grid.length - surviving.length;

  const emptyRows: Cell[][] = [];
  for (let i = 0; i < cleared; i++) {
    emptyRows.push(new Array<Cell>(cols).fill(0));
  }
  return { grid: [...emptyRows, ...surviving], cleared };
}

// ---------------------------------------------------------------------------
// Piece generation (deterministic PRNG so `step` stays pure)
// ---------------------------------------------------------------------------

/** A tiny linear-congruential generator; returns a value in [0, 1) and a new seed. */
function nextRandom(seed: number): { value: number; seed: number } {
  const next = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
  return { value: next / 0x7fffffff, seed: next };
}

/** Create a spawn-positioned piece and the advanced seed. */
function spawnPiece(seed: number): { piece: Piece; seed: number } {
  const { value, seed: nextSeed } = nextRandom(seed);
  const idx = Math.min(KINDS.length - 1, Math.floor(value * KINDS.length));
  const kind = KINDS[idx] ?? "T";
  const color = idx + 1;

  const cells = rotateCells(BASE_SHAPES[kind], 0);
  let width = 0;
  for (const c of cells) {
    if (c.x + 1 > width) width = c.x + 1;
  }
  const x = Math.floor((COLS - width) / 2);

  return { piece: { kind, color, rotation: 0, x, y: 0 }, seed: nextSeed };
}

// ---------------------------------------------------------------------------
// Lifecycle + advance
// ---------------------------------------------------------------------------

/** A new session: empty grid, first two pieces spawned, Score 0 (Requirement 4.3). */
export function createInitialState(): BlockCascadeState {
  const seed0 = 123456789;
  const first = spawnPiece(seed0);
  const second = spawnPiece(first.seed);
  return {
    grid: createEmptyGrid(),
    active: first.piece,
    next: second.piece,
    score: 0,
    over: false,
    seed: second.seed,
    dropTimerMs: 0,
  };
}

/** Lock the active piece into the grid, clear lines, score, and spawn the next. */
function lockAndSpawn(state: BlockCascadeState): BlockCascadeState {
  const merged = mergePiece(state.grid, state.active);
  const { grid, cleared } = clearLines(merged);
  const gained = LINE_SCORES[cleared] ?? 0;
  const score = state.score + gained;

  const active = state.next;
  const { piece: next, seed } = spawnPiece(state.seed);

  // Game over when the incoming piece has nowhere to spawn (Requirement 5.1).
  if (collides(grid, active)) {
    return { ...state, grid, score, active, next, seed, over: true, dropTimerMs: 0 };
  }

  return { grid, active, next, score, over: false, seed, dropTimerMs: state.dropTimerMs };
}

/** Move the active piece down one row, or lock it if it cannot descend. */
function stepDownOrLock(state: BlockCascadeState): BlockCascadeState {
  const moved: Piece = { ...state.active, y: state.active.y + 1 };
  if (!collides(state.grid, moved)) {
    return { ...state, active: moved };
  }
  return lockAndSpawn(state);
}

/** Apply a single discrete action. */
function applyAction(state: BlockCascadeState, action: BlockCascadeAction): BlockCascadeState {
  switch (action) {
    case "left": {
      const moved: Piece = { ...state.active, x: state.active.x - 1 };
      return collides(state.grid, moved) ? state : { ...state, active: moved };
    }
    case "right": {
      const moved: Piece = { ...state.active, x: state.active.x + 1 };
      return collides(state.grid, moved) ? state : { ...state, active: moved };
    }
    case "rotate": {
      const rotated: Piece = { ...state.active, rotation: (state.active.rotation + 1) % 4 };
      return collides(state.grid, rotated) ? state : { ...state, active: rotated };
    }
    case "softDrop":
    case "tick":
      return stepDownOrLock(state);
    case "hardDrop": {
      let piece = state.active;
      while (!collides(state.grid, { ...piece, y: piece.y + 1 })) {
        piece = { ...piece, y: piece.y + 1 };
      }
      return lockAndSpawn({ ...state, active: piece });
    }
    default:
      return state;
  }
}

/** Advance gravity by the elapsed frame time, dropping/locking as needed. */
function applyGravity(state: BlockCascadeState, dtMs: number): BlockCascadeState {
  let timer = state.dropTimerMs + Math.max(0, dtMs);
  let current = state;
  while (timer >= GRAVITY_INTERVAL_MS) {
    timer -= GRAVITY_INTERVAL_MS;
    current = stepDownOrLock(current);
    if (current.over) {
      return { ...current, dropTimerMs: 0 };
    }
  }
  return { ...current, dropTimerMs: timer };
}

/**
 * Advance the state by applying the buffered `actions` in order, then applying
 * gravity for the elapsed `dtMs`. Pure. A game already in the Game_Over_State
 * is returned unchanged, so play is halted and the Score is preserved
 * (design Property 8).
 */
export function step(
  state: BlockCascadeState,
  actions: readonly BlockCascadeAction[],
  dtMs: number,
): BlockCascadeState {
  if (state.over) return state;

  let current = state;
  for (const action of actions) {
    current = applyAction(current, action);
    if (current.over) return current;
  }
  return applyGravity(current, dtMs);
}

/** The end condition: the piece could not spawn (Requirement 5.1). */
export function isGameOver(state: BlockCascadeState): boolean {
  return state.over;
}

/** The current Score (Requirement 4.1); non-negative, starts at 0. */
export function getScore(state: BlockCascadeState): number {
  return state.score;
}
