import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  resolveBallCollisions,
  ballIntersectsRect,
  BALL_RADIUS,
  POINTS_PER_BRICK,
  FIELD_WIDTH,
  FIELD_HEIGHT,
  type Brick,
  type BrickState,
} from "./logic";

describe("resolveBallCollisions", () => {
  // A brick with an arbitrary rectangle and alive flag, positioned within a
  // slightly padded field so the ball can overlap or miss it.
  const brickArb: fc.Arbitrary<Brick> = fc.record({
    rect: fc.record({
      x: fc.integer({ min: 0, max: FIELD_WIDTH }),
      y: fc.integer({ min: 0, max: FIELD_HEIGHT }),
      width: fc.integer({ min: 1, max: 60 }),
      height: fc.integer({ min: 1, max: 30 }),
    }),
    alive: fc.boolean(),
  });

  const stateArb: fc.Arbitrary<BrickState> = fc.record({
    paddle: fc.record({
      x: fc.integer({ min: 0, max: FIELD_WIDTH }),
      width: fc.integer({ min: 20, max: 120 }),
    }),
    ball: fc.record({
      pos: fc.record({
        x: fc.integer({ min: 0, max: FIELD_WIDTH }),
        y: fc.integer({ min: 0, max: FIELD_HEIGHT }),
      }),
      vel: fc.record({
        x: fc.double({ min: -0.5, max: 0.5, noNaN: true }),
        y: fc.double({ min: -0.5, max: 0.5, noNaN: true }),
      }),
    }),
    bricks: fc.array(brickArb, { minLength: 0, maxLength: 40 }),
    score: fc.integer({ min: 0, max: 100000 }),
    lives: fc.integer({ min: 1, max: 3 }),
    over: fc.constant(false),
    launched: fc.constant(true),
  });

  // Feature: personal-website, Property 16: Brick Buster removes struck bricks and never increases the brick count
  it("removes exactly the intersecting bricks, scores them, and never grows the wall", () => {
    fc.assert(
      fc.property(stateArb, (state) => {
        // Independently compute the bricks the ball overlaps (alive + intersecting).
        const struck = new Set<number>();
        state.bricks.forEach((brick, i) => {
          if (brick.alive && ballIntersectsRect(state.ball.pos, BALL_RADIUS, brick.rect)) {
            struck.add(i);
          }
        });

        const aliveBefore = state.bricks.filter((b) => b.alive).length;
        const result = resolveBallCollisions(state);

        // Exactly the struck bricks are removed; every other brick keeps its status.
        result.bricks.forEach((brick, i) => {
          if (struck.has(i)) {
            expect(brick.alive).toBe(false);
          } else {
            expect(brick.alive).toBe(state.bricks[i]!.alive);
          }
        });

        // Brick geometry is preserved (only the alive flag may change).
        expect(result.bricks.length).toBe(state.bricks.length);
        result.bricks.forEach((brick, i) => {
          expect(brick.rect).toEqual(state.bricks[i]!.rect);
        });

        // Score increases by exactly the number of bricks broken.
        expect(result.score).toBe(state.score + struck.size * POINTS_PER_BRICK);

        // The remaining alive-brick count is no greater than before (and drops by
        // exactly the number struck — each brick removed at most once).
        const aliveAfter = result.bricks.filter((b) => b.alive).length;
        expect(aliveAfter).toBe(aliveBefore - struck.size);
        expect(aliveAfter).toBeLessThanOrEqual(aliveBefore);
      }),
      { numRuns: 100 },
    );
  });
});
