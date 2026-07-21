// Property-based test for the High_Score localStorage adapter in
// `src/scores/scoreStore.ts`. Runs under jsdom (via the `*.dom.test.ts` glob in
// vite.config.ts) so `localStorage` is available.
import { beforeEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  HIGH_SCORE_KEY,
  commitScore,
  readHighScore,
} from "../src/scores/scoreStore.ts";
import type { GameId } from "../src/engine/types.ts";

const GAME_IDS: readonly GameId[] = [
  "block-cascade",
  "serpent",
  "maze-muncher",
  "brick-buster",
];

const gameIdArb = fc.constantFrom<GameId>(...GAME_IDS);
const highScoreArb = fc.integer({ min: 0, max: 1_000_000 });

describe("scoreStore localStorage persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // Feature: personal-website, Property 10: High_Score persistence round-trips per game and is isolated across games
  it("round-trips a High_Score per game and keeps games isolated", () => {
    fc.assert(
      fc.property(
        gameIdArb,
        highScoreArb,
        gameIdArb,
        highScoreArb,
        (idA, scoreA, idB, scoreB) => {
          localStorage.clear();

          // Round-trip: seed the store directly so we test the read path against
          // an exact value (commitScore only writes when it beats the stored
          // value, so a direct seed exercises the round-trip cleanly).
          localStorage.setItem(HIGH_SCORE_KEY(idA), String(scoreA));
          expect(readHighScore(idA)).toBe(scoreA);

          // Isolation: writing another game's High_Score must not change the
          // value read for a different game. Commit an ascending value for idB
          // (from 0) so the write actually lands, then re-check idA when the
          // two ids differ.
          commitScore(idB, scoreB);

          if (idA !== idB) {
            expect(readHighScore(idA)).toBe(scoreA);
          }

          // idB reads back the greater of its seeded (none => 0) and committed
          // value, i.e. scoreB when idA !== idB, or max(scoreA, scoreB) when the
          // ids collide (idA was seeded first).
          const expectedB = idA === idB ? Math.max(scoreA, scoreB) : scoreB;
          expect(readHighScore(idB)).toBe(expectedB);
        },
      ),
      { numRuns: 100 },
    );
  });
});
