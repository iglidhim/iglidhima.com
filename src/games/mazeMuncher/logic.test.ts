import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  collectPellet,
  pelletsRemaining,
  EMPTY,
  WALL,
  PELLET,
  type MazeCell,
  type MazeState,
} from "./logic";

describe("collectPellet", () => {
  // Build a MazeState from an arbitrary rectangular board plus a player cell.
  // Pursuers are irrelevant to pellet collection, so they stay empty.
  const stateArb = fc
    .integer({ min: 1, max: 10 }) // columns
    .chain((cols) =>
      fc
        .integer({ min: 1, max: 10 }) // rows
        .chain((rows) =>
          fc.record({
            board: fc.array(
              fc.array(fc.constantFrom<MazeCell>(EMPTY, WALL, PELLET), {
                minLength: cols,
                maxLength: cols,
              }),
              { minLength: rows, maxLength: rows },
            ),
            px: fc.integer({ min: 0, max: cols - 1 }),
            py: fc.integer({ min: 0, max: rows - 1 }),
            score: fc.integer({ min: 0, max: 1_000_000 }),
          }),
        ),
    )
    .map(
      ({ board, px, py, score }): MazeState => ({
        board,
        player: { x: px, y: py },
        pursuers: [],
        score,
        over: false,
        won: false,
        moveTimerMs: 0,
      }),
    );

  // Feature: personal-website, Property 15: Maze Muncher pellet collection decrements remaining pellets by one
  it("eating a pellet drops the remaining count by one and raises the Score; a non-pellet cell changes nothing", () => {
    fc.assert(
      fc.property(stateArb, (state) => {
        const before = pelletsRemaining(state);
        const hadPellet = state.board[state.player.y]![state.player.x] === PELLET;

        const result = collectPellet(state);
        const after = pelletsRemaining(result);

        if (hadPellet) {
          // Exactly one pellet consumed and the Score strictly increased.
          expect(after).toBe(before - 1);
          expect(result.score).toBeGreaterThan(state.score);
        } else {
          // Landing on a non-pellet cell leaves pellet count and Score unchanged.
          expect(after).toBe(before);
          expect(result.score).toBe(state.score);
        }
      }),
      { numRuns: 100 },
    );
  });
});
