import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  advanceSnake,
  COLS,
  ROWS,
  type Direction,
  type Point,
  type SerpentState,
} from "./logic";

describe("advanceSnake", () => {
  const DELTA: Readonly<Record<Direction, Point>> = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };

  const key = (p: Point): string => `${p.x},${p.y}`;
  const outOfBounds = (p: Point): boolean =>
    p.x < 0 || p.x >= COLS || p.y < 0 || p.y >= ROWS;

  // Feature: personal-website, Property 14: Serpent grows on food and ends on collision
  it("grows and scores on food, holds length on empty cells, and ends on collision", () => {
    // A smart generator: an in-bounds head, a body of distinct in-bounds cells
    // (head-first, not overlapping the head), a heading, and a food placement
    // choice that either sits directly ahead of the head (to exercise eating) or
    // on an arbitrary other cell (to exercise the empty-move / collision paths).
    const scenarioArb = fc
      .record({
        head: fc.record({
          x: fc.integer({ min: 0, max: COLS - 1 }),
          y: fc.integer({ min: 0, max: ROWS - 1 }),
        }),
        bodyLen: fc.integer({ min: 0, max: 8 }),
        bodyCells: fc.array(
          fc.record({
            x: fc.integer({ min: 0, max: COLS - 1 }),
            y: fc.integer({ min: 0, max: ROWS - 1 }),
          }),
          { minLength: 0, maxLength: 8 },
        ),
        direction: fc.constantFrom<Direction>("up", "down", "left", "right"),
        foodAtHead: fc.boolean(),
        foodCell: fc.record({
          x: fc.integer({ min: 0, max: COLS - 1 }),
          y: fc.integer({ min: 0, max: ROWS - 1 }),
        }),
        score: fc.integer({ min: 0, max: 10_000 }),
      })
      .map((raw) => {
        // Build a snake with distinct cells: head first, then unique body cells
        // that exclude the head, capped at bodyLen.
        const seen = new Set<string>([key(raw.head)]);
        const body: Point[] = [];
        for (const c of raw.bodyCells) {
          if (body.length >= raw.bodyLen) break;
          if (!seen.has(key(c))) {
            seen.add(key(c));
            body.push(c);
          }
        }
        const snake: Point[] = [raw.head, ...body];

        const delta = DELTA[raw.direction];
        const newHead: Point = {
          x: raw.head.x + delta.x,
          y: raw.head.y + delta.y,
        };

        // Decide food: only place it at the head's next cell when that cell is a
        // legal landing spot (in-bounds and not on the snake), otherwise fall
        // back to the arbitrary food cell.
        const landingIsFree =
          !outOfBounds(newHead) && !seen.has(key(newHead));
        const food: Point =
          raw.foodAtHead && landingIsFree ? newHead : raw.foodCell;

        const state: SerpentState = {
          snake,
          direction: raw.direction,
          food,
          score: raw.score,
          over: false,
          seed: 12345,
          moveTimerMs: 0,
        };
        return { state, newHead };
      });

    fc.assert(
      fc.property(scenarioArb, ({ state, newHead }) => {
        const result = advanceSnake(state);

        // Expectation mirrors the rules: wall first, then self-collision
        // (against the body the snake will still occupy), then eat vs move.
        const eating =
          newHead.x === state.food.x && newHead.y === state.food.y;
        const bodyToCheck = eating ? state.snake : state.snake.slice(0, -1);
        const hitsSelf = bodyToCheck.some(
          (p) => p.x === newHead.x && p.y === newHead.y,
        );

        if (outOfBounds(newHead) || hitsSelf) {
          // Advancing into a wall or the snake's own body ends the game.
          expect(result.over).toBe(true);
          return;
        }

        expect(result.over).toBe(false);

        if (eating) {
          // Reaching food grows the snake by exactly one and raises the Score.
          expect(result.snake.length).toBe(state.snake.length + 1);
          expect(result.score).toBeGreaterThan(state.score);
        } else {
          // Advancing onto a non-food cell keeps the length and Score constant.
          expect(result.snake.length).toBe(state.snake.length);
          expect(result.score).toBe(state.score);
        }
      }),
      { numRuns: 100 },
    );
  });
});
