// src/games/registry.test.ts
// Shared-contract property tests exercised across ALL four registered games
// (Properties 6, 7, 8). Each game's `GameDefinition` is loaded through the
// registry's own lazy `loader()`, so these tests also prove every registry
// entry resolves to a working definition. Every property runs a minimum of 100
// iterations (the global fast-check floor).

import { describe, it, beforeAll, expect } from "vitest";
import fc from "fast-check";
import { GAME_REGISTRY } from "./registry";
import type { GameDefinition, GameId } from "../engine/types";

type AnyGameDefinition = GameDefinition<unknown, string>;

interface LoadedGame {
  id: GameId;
  def: AnyGameDefinition;
  /** The distinct action values declared in the game's keyMap. */
  actions: string[];
}

let games: LoadedGame[] = [];

beforeAll(async () => {
  const ids = Object.keys(GAME_REGISTRY) as GameId[];
  games = await Promise.all(
    ids.map(async (id): Promise<LoadedGame> => {
      const def = await GAME_REGISTRY[id].loader();
      const actions = Array.from(new Set(Object.values(def.keyMap)));
      return { id, def, actions };
    }),
  );
});

describe("shared game contract across all registered games", () => {
  // Feature: personal-website, Property 6: A new game session starts at Score zero
  it("starts every new game session at Score zero", () => {
    for (const game of games) {
      fc.assert(
        fc.property(fc.constant(game), (g) => {
          expect(g.def.getScore(g.def.createInitialState())).toBe(0);
        }),
        { numRuns: 100 },
      );
    }
  });

  // Feature: personal-website, Property 7: Score never decreases within a session
  it("never decreases the Score across a restart-free action sequence", () => {
    for (const game of games) {
      const actionArb = fc.constantFrom(...game.actions);
      // A restart-free session: a sequence of frames, each a buffer of buffered
      // actions plus the elapsed time applied through `step`.
      const framesArb = fc.array(
        fc.record({
          actions: fc.array(actionArb, { maxLength: 5 }),
          dtMs: fc.integer({ min: 0, max: 1200 }),
        }),
        { maxLength: 60 },
      );

      fc.assert(
        fc.property(framesArb, (frames) => {
          let state = game.def.createInitialState();
          let prevScore = game.def.getScore(state);
          for (const frame of frames) {
            state = game.def.step(state, frame.actions, frame.dtMs);
            const score = game.def.getScore(state);
            expect(score).toBeGreaterThanOrEqual(prevScore);
            prevScore = score;
          }
        }),
        { numRuns: 100 },
      );
    }
  });

  // Feature: personal-website, Property 8: Meeting the end condition halts play
  it("halts play once the end condition is met, preserving the Score", () => {
    for (const game of games) {
      // Applying every declared action each frame with a large time step drives
      // any of the games to its end condition within a few steps.
      const allActions = game.actions;
      const afterArb = fc.array(fc.constantFrom(...game.actions), { maxLength: 8 });
      const afterDtArb = fc.integer({ min: 0, max: 5000 });

      fc.assert(
        fc.property(afterArb, afterDtArb, (afterActions, afterDt) => {
          // Drive the game to its end condition.
          let state = game.def.createInitialState();
          let steps = 0;
          while (!game.def.isGameOver(state) && steps < 500) {
            state = game.def.step(state, allActions, 5000);
            steps++;
          }

          // A state satisfying the end condition reports game-over.
          expect(game.def.isGameOver(state)).toBe(true);

          // Stepping an already game-over state halts play: it stays game-over
          // and the Score is unchanged, regardless of the actions applied.
          const scoreBefore = game.def.getScore(state);
          const next = game.def.step(state, afterActions, afterDt);
          expect(game.def.isGameOver(next)).toBe(true);
          expect(game.def.getScore(next)).toBe(scoreBefore);
        }),
        { numRuns: 100 },
      );
    }
  });
});
