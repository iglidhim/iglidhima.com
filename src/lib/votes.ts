// src/lib/votes.ts
// Client-side vote module for the global Like/Love voting system.
//
// This layer talks to the same-origin Worker API (see src/worker/index.ts):
//   - `fetchAllVotes()` GETs the aggregate counts for all four games.
//   - `sendVote()` POSTs a +1/-1 delta for one game's like|love reaction.
// Both are written to be UI-safe: network / parse failures never throw to the
// caller. `fetchAllVotes` resolves to all-zero counts so the hub still renders,
// and `sendVote` resolves to `null` so the caller can revert an optimistic
// update.
//
// A per-browser "have I voted?" flag lives in `localStorage` (one key per game
// + reaction), wrapped in try/catch so disabled/unavailable storage never
// throws — matching the fail-safe style of scoreStore.ts / theme.ts.
//
// `voteDelta` is a tiny PURE helper (toggle direction) kept separate so it is
// directly unit-testable without any DOM or network.

import type { GameId } from "../engine/types";

/**
 * A votable target: any of the four canvas games plus the Chess destination.
 *
 * Chess is not a `GameId` (it is not part of the canvas-game contract), but it
 * gets its own global Like/Love counts alongside the games, so the vote system
 * is keyed by this wider id. New `chess` counts default to 0, so this is fully
 * backward compatible with the existing game counts.
 */
export type VoteTargetId = GameId | "chess";

/** The two reactions, each with its own independent global count. */
export type Reaction = "like" | "love";

/** Per-target vote counts. */
export interface VoteCounts {
  like: number;
  love: number;
}

/** Aggregate counts for every votable target, keyed by VoteTargetId. */
export type AllVotes = Record<VoteTargetId, VoteCounts>;

/** The votable targets: the four games in registry order, then Chess last. */
const VOTE_TARGET_IDS: readonly VoteTargetId[] = [
  "block-cascade",
  "serpent",
  "maze-muncher",
  "brick-buster",
  "chess",
];

/** Coerce an unknown value into a safe, non-negative integer count. */
function normalizeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

/** A fresh all-zero vote map, used as the fail-safe default. */
export function zeroVotes(): AllVotes {
  const out = {} as AllVotes;
  for (const id of VOTE_TARGET_IDS) {
    out[id] = { like: 0, love: 0 };
  }
  return out;
}

/**
 * GET the aggregate counts for every votable target (the four games + Chess).
 *
 * On any failure (network error, non-2xx, bad JSON) this resolves to an
 * all-zero map rather than throwing, so the hub always has something to render.
 */
export async function fetchAllVotes(): Promise<AllVotes> {
  try {
    const res = await fetch("/api/votes", {
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      return zeroVotes();
    }
    const data = (await res.json()) as Partial<
      Record<VoteTargetId, Partial<VoteCounts>>
    >;
    const out = zeroVotes();
    for (const id of VOTE_TARGET_IDS) {
      const counts = data?.[id];
      if (counts) {
        out[id] = {
          like: normalizeCount(counts.like),
          love: normalizeCount(counts.love),
        };
      }
    }
    return out;
  } catch {
    return zeroVotes();
  }
}

/**
 * POST a vote delta for one game + reaction. Returns the server's updated
 * counts for that game, or `null` on any failure so the caller can revert an
 * optimistic UI update.
 */
export async function sendVote(
  gameId: VoteTargetId,
  reaction: Reaction,
  delta: 1 | -1,
): Promise<VoteCounts | null> {
  try {
    const res = await fetch("/api/vote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ gameId, reaction, delta }),
    });
    if (!res.ok) {
      return null;
    }
    const data = (await res.json()) as Partial<VoteCounts>;
    return {
      like: normalizeCount(data?.like),
      love: normalizeCount(data?.love),
    };
  } catch {
    return null;
  }
}

/** The Local_Store key for one browser's vote flag on a target + reaction. */
export const VOTE_KEY = (gameId: VoteTargetId, reaction: Reaction): string =>
  `iglidhima.arcade.vote.${gameId}.${reaction}`;

/**
 * Has this browser recorded a vote for the given target + reaction?
 * Returns `false` if storage is unavailable; never throws.
 */
export function hasVoted(gameId: VoteTargetId, reaction: Reaction): boolean {
  try {
    return localStorage.getItem(VOTE_KEY(gameId, reaction)) === "1";
  } catch {
    return false;
  }
}

/**
 * Record (or clear) this browser's vote flag for a game + reaction. Silently
 * skipped if storage is unavailable; never throws.
 */
export function setVoted(
  gameId: VoteTargetId,
  reaction: Reaction,
  voted: boolean,
): void {
  try {
    if (voted) {
      localStorage.setItem(VOTE_KEY(gameId, reaction), "1");
    } else {
      localStorage.removeItem(VOTE_KEY(gameId, reaction));
    }
  } catch {
    // Storage disabled/unavailable: skip; the visitor can still vote this session.
  }
}

/**
 * The delta to apply when a visitor toggles a reaction (PURE).
 *
 * If they have already voted, toggling removes the vote (-1); otherwise it adds
 * one (+1). Kept pure and side-effect free for direct unit testing.
 */
export function voteDelta(currentlyVoted: boolean): 1 | -1 {
  return currentlyVoted ? -1 : 1;
}
