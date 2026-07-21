// Deterministic computer-opponent move picker for the Chess game.
//
// The chooser is pure with respect to an injected RNG: given the same position
// and the same sequence of `rng()` values it always returns the same move, so
// tests drive it with a seeded generator and assert exact behaviour. It never
// mutates the caller's game — every look-ahead runs on a fresh chess.js
// instance loaded from the position's FEN.
//
// Two difficulty levels are supported:
//   - "easy":   a uniformly random legal move.
//   - "medium": prefers "active" moves — captures or moves that give check —
//               and falls back to a uniformly random legal move when none of
//               those exist.
//
// Uses no DOM or Workers globals (client tsconfig program only).

import { Chess, type Move, type Square } from "chess.js";
import { ChessGame } from "./chessGame";

/** The supported computer-opponent strengths. */
export type Difficulty = "easy" | "medium";

/** A chosen move: the origin and destination squares. Promotion is implicit (queen). */
export interface AiMove {
  readonly from: Square;
  readonly to: Square;
}

/**
 * A random-number source returning a value in `[0, 1)`, matching `Math.random`.
 * Injected so callers/tests control determinism.
 */
export type Rng = () => number;

/**
 * Choose a move for the side to move in `source`.
 *
 * @param source     the current position, as a {@link ChessGame} or a FEN string.
 * @param difficulty `"easy"` (uniform random) or `"medium"` (prefers captures/checks).
 * @param rng        an injected RNG in `[0, 1)` (deterministic in tests).
 * @returns the chosen `{ from, to }`, or `null` when there are no legal moves
 *          (checkmate or stalemate).
 */
export function chooseMove(
  source: ChessGame | string,
  difficulty: Difficulty,
  rng: Rng,
): AiMove | null {
  const fen = typeof source === "string" ? source : source.fen();
  // A private instance so we never touch the caller's game.
  const chess = new Chess(fen);
  const legal = chess.moves({ verbose: true });
  if (legal.length === 0) {
    return null;
  }

  if (difficulty === "medium") {
    // Prefer captures (flags 'c' standard / 'e' en passant) or moves that give
    // check. A random pick among the preferred set keeps this simple and still
    // deterministic under the injected RNG; capture-value weighting is a
    // possible future refinement but is intentionally not done here.
    const preferred = legal.filter((move) => isCaptureOrCheck(fen, move));
    return toAiMove(pickFrom(preferred.length > 0 ? preferred : legal, rng));
  }

  // "easy": a uniformly random legal move.
  return toAiMove(pickFrom(legal, rng));
}

/** True when `move` is a capture or, applied to the position, delivers check. */
function isCaptureOrCheck(fen: string, move: Move): boolean {
  if (move.flags.includes("c") || move.flags.includes("e")) {
    return true;
  }
  // Look ahead on a clone: after applying the move the turn flips, so in_check()
  // then reports whether the move we just made put the opponent in check.
  const probe = new Chess(fen);
  probe.move({ from: move.from, to: move.to, promotion: "q" });
  return probe.in_check();
}

/** Pick one element from a non-empty list using the injected RNG. */
function pickFrom(moves: readonly Move[], rng: Rng): Move | undefined {
  // Clamp guards against an RNG that (incorrectly) returns exactly 1.
  const index = Math.min(moves.length - 1, Math.floor(rng() * moves.length));
  return moves[index];
}

/** Narrow a verbose move to the `{ from, to }` shape, or `null` if absent. */
function toAiMove(move: Move | undefined): AiMove | null {
  return move === undefined ? null : { from: move.from, to: move.to };
}
