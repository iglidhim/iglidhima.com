// src/scores/scoreStore.ts
// High_Score persistence for the arcade hub (Requirement 6).
//
// This module is split into two parts:
//   1. PURE logic (this file): `nextHighScore` and `parseHighScore`. These
//      contain no DOM or `localStorage` access and are the focus of
//      property-based testing (design Properties 9 and 11).
//   2. A thin `localStorage` adapter (added in a later task) that reads/writes
//      per-game keys, routing reads through `parseHighScore` and writes through
//      `nextHighScore`, with all storage access wrapped in try/catch.
//
// The pure functions are exported independently so the adapter can be layered
// on top without reworking this logic.

/**
 * The new High_Score after a completed play session.
 *
 * Returns the greater of the final Score and the stored High_Score, so a new
 * record is recorded if and only if `finalScore > storedHigh` (Requirement 6.2,
 * design Property 9).
 */
export function nextHighScore(finalScore: number, storedHigh: number): number {
  return Math.max(finalScore, storedHigh);
}

/**
 * Safely parse a raw stored High_Score value into a usable number.
 *
 * Reads always yield a finite, non-negative integer. Any missing, non-numeric,
 * `NaN`, infinite, or negative value degrades to `0` so the affected High_Score
 * displays as zero and play continues (Requirements 6.4, 6.6, design Property 11).
 *
 * - `null` (missing)                -> 0
 * - non-numeric / `NaN` / `Infinity` -> 0
 * - negative                         -> 0
 * - otherwise                        -> the value floored to an integer
 */
export function parseHighScore(raw: string | null): number {
  if (raw === null) {
    return 0;
  }

  const value = Number(raw);

  // Number("") is 0 and Number("   ") is 0; those are harmless (yield 0).
  // Reject NaN and +/-Infinity, which are not safe scores.
  if (!Number.isFinite(value)) {
    return 0;
  }

  // Negative scores are invalid; clamp to 0.
  if (value < 0) {
    return 0;
  }

  // Normalize to a non-negative integer.
  return Math.floor(value);
}

// ---------------------------------------------------------------------------
// localStorage adapter (Requirements 6.1, 6.2, 6.3, 6.5, 6.6, 7.2, 7.4)
//
// A thin, per-game keyed wrapper over `localStorage`, layered on top of the
// pure functions above. Reads route through `parseHighScore` (safe, non-negative
// integer with a 0 fallback); writes route through `nextHighScore` so a value is
// only persisted when it beats the stored High_Score.
//
// All storage access is wrapped in try/catch: if `localStorage` is unavailable
// (disabled storage, private-mode quota errors) reads yield `0` and writes are
// silently skipped, so play always continues (Requirement 6.6).
// ---------------------------------------------------------------------------

import type { GameId } from "../engine/types.ts";

/**
 * The Local_Store key for a given game's High_Score. One entry per game keeps
 * each game's High_Score isolated (Requirements 6.1, 7.4, design Property 10).
 */
export const HIGH_SCORE_KEY = (id: GameId): string =>
  `iglidhima.arcade.highscore.${id}`;

/**
 * Read the stored High_Score for a game (Requirements 6.3, 6.5).
 *
 * Routes the raw stored value through `parseHighScore`, so a missing, corrupt,
 * or non-numeric entry yields `0`. If `localStorage` itself is unavailable, the
 * read degrades to `0` rather than throwing (Requirement 6.6).
 */
export function readHighScore(id: GameId): number {
  try {
    const raw = localStorage.getItem(HIGH_SCORE_KEY(id));
    return parseHighScore(raw);
  } catch {
    // Storage disabled/unavailable: degrade to zero and continue play.
    return 0;
  }
}

/**
 * Commit a completed play session's final Score as the game's High_Score
 * (Requirements 6.1, 6.2). The stored value is updated only when `finalScore`
 * beats the currently stored High_Score (`nextHighScore`), and the write is a
 * no-op otherwise, so an existing best is never lowered.
 *
 * Returns the resulting High_Score for the game (the greater of the final and
 * stored values), which is the value that will be read back on the next visit.
 * If `localStorage` is unavailable, the write is silently skipped and play
 * continues (Requirement 6.6).
 */
export function commitScore(id: GameId, finalScore: number): number {
  const stored = readHighScore(id);
  const next = nextHighScore(finalScore, stored);

  // Only touch storage when there is a new record to persist.
  if (next > stored) {
    try {
      localStorage.setItem(HIGH_SCORE_KEY(id), String(next));
    } catch {
      // Storage unavailable/quota exceeded: skip the write, continue play.
    }
  }

  return next;
}
