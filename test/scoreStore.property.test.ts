// Property-based tests for the pure High_Score logic in `src/scores/scoreStore.ts`.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { nextHighScore, parseHighScore } from "../src/scores/scoreStore.ts";

describe("scoreStore pure high-score logic", () => {
  // Feature: personal-website, Property 9: High_Score update stores the greater value and records a new best iff it is exceeded
  it("nextHighScore stores the greater value and records a new best iff exceeded", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (finalScore, storedHigh) => {
          const result = nextHighScore(finalScore, storedHigh);

          // Stores the greater value.
          expect(result).toBe(Math.max(finalScore, storedHigh));

          // A new best is recorded (value strictly increases) iff final > stored.
          const strictlyIncreased = result > storedHigh;
          expect(strictlyIncreased).toBe(finalScore > storedHigh);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: personal-website, Property 11: High_Score reads are always a safe non-negative number
  it("parseHighScore returns a finite non-negative integer for any raw value", () => {
    // Mix arbitrary strings with targeted edge cases: garbage, NaN, Infinity,
    // negatives, empty, and null (missing).
    const rawArb = fc.oneof(
      fc.string(),
      fc.constantFrom(
        "NaN",
        "Infinity",
        "-Infinity",
        "1e309", // overflows to Infinity
        "",
        "   ",
        "-1",
        "-42.5",
        "abc",
        "12.9",
        "3.14",
        "007",
        null,
      ),
      fc.integer().map((n) => String(n)),
      fc.double().map((n) => String(n)),
      fc.constant(null),
    );

    fc.assert(
      fc.property(rawArb, (raw) => {
        const result = parseHighScore(raw);

        // Always a finite, non-negative integer.
        expect(Number.isInteger(result)).toBe(true);
        expect(Number.isFinite(result)).toBe(true);
        expect(result).toBeGreaterThanOrEqual(0);

        // Any missing/unreadable value yields 0.
        const numeric = raw === null ? NaN : Number(raw);
        if (raw === null || !Number.isFinite(numeric) || numeric < 0) {
          expect(result).toBe(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});
