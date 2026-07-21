// src/lib/votes.test.ts
// Unit + property tests for the PURE `voteDelta` helper. Lives outside the
// jsdom globs so it runs in the fast `node` environment (no DOM needed).
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { voteDelta, zeroVotes } from "./votes";

describe("zeroVotes", () => {
  it("includes the four games plus the chess target, all zeroed", () => {
    const zero = zeroVotes();
    expect(Object.keys(zero).sort()).toEqual(
      [
        "block-cascade",
        "brick-buster",
        "chess",
        "maze-muncher",
        "serpent",
      ].sort(),
    );
    for (const counts of Object.values(zero)) {
      expect(counts).toEqual({ like: 0, love: 0 });
    }
  });

  it("keys chess like any other votable target", () => {
    expect(zeroVotes()["chess"]).toEqual({ like: 0, love: 0 });
  });
});

describe("voteDelta", () => {
  it("adds a vote (+1) when not currently voted", () => {
    expect(voteDelta(false)).toBe(1);
  });

  it("removes a vote (-1) when currently voted", () => {
    expect(voteDelta(true)).toBe(-1);
  });

  it("always yields exactly +1 or -1, opposite in sign to the toggle state", () => {
    fc.assert(
      fc.property(fc.boolean(), (voted) => {
        const delta = voteDelta(voted);
        expect(Math.abs(delta)).toBe(1);
        // Voted -> removing (-1); not voted -> adding (+1).
        expect(delta).toBe(voted ? -1 : 1);
      }),
      { numRuns: 100 },
    );
  });
});
