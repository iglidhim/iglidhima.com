import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { Chess, type Move } from "chess.js";
import { chooseMove, type AiMove } from "./chessAi";
import { ChessGame } from "./chessGame";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// True when `move` is legal in `fen`, applied on a throwaway instance.
function isLegal(fen: string, move: AiMove): boolean {
  const chess = new Chess(fen);
  return chess.move({ from: move.from, to: move.to, promotion: "q" }) !== null;
}

// Mirror of the adapter's preference test: a capture, or a move that gives check.
function isCaptureOrCheck(fen: string, move: Move): boolean {
  if (move.flags.includes("c") || move.flags.includes("e")) {
    return true;
  }
  const probe = new Chess(fen);
  probe.move({ from: move.from, to: move.to, promotion: "q" });
  return probe.in_check();
}

// A fixed-in-[0,1) RNG that replays the given sequence, then holds the last one.
function seededRng(values: readonly number[]): () => number {
  let i = 0;
  return () => {
    const v = values[Math.min(i, values.length - 1)] ?? 0;
    i += 1;
    return v;
  };
}

describe("chessAi.chooseMove", () => {
  it("easy always returns a legal move across seeded RNG values", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 0.999999, noNaN: true, noDefaultInfinity: true }),
        (r) => {
          const move = chooseMove(START_FEN, "easy", () => r);
          expect(move).not.toBeNull();
          expect(isLegal(START_FEN, move as AiMove)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("easy does not mutate the caller's game instance", () => {
    const game = new ChessGame();
    chooseMove(game, "easy", seededRng([0.42]));
    expect(game.fen()).toBe(START_FEN);
  });

  it("medium chooses a capture-or-check when a capture (and check) is available", () => {
    // White queen on e2; Black pawn on e6 can be captured (Qxe6+, both capture
    // and check) and Qb5+ gives check — so the capture-or-check set is non-empty
    // and medium must always pick from it.
    const fen = "4k3/8/4p3/8/8/8/4Q3/4K3 w - - 0 1";

    // Precondition: at least one capture AND at least one checking move exist.
    const legal = new Chess(fen).moves({ verbose: true });
    expect(legal.some((m) => m.flags.includes("c") || m.flags.includes("e"))).toBe(true);
    expect(
      legal.some((m) => {
        const probe = new Chess(fen);
        probe.move({ from: m.from, to: m.to, promotion: "q" });
        return probe.in_check();
      }),
    ).toBe(true);

    // Whatever the RNG, medium must pick a capture-or-check move.
    for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
      const move = chooseMove(fen, "medium", () => r);
      expect(move).not.toBeNull();
      const verbose = legal.find(
        (m) => m.from === move?.from && m.to === move?.to,
      );
      expect(verbose).toBeDefined();
      expect(isCaptureOrCheck(fen, verbose as Move)).toBe(true);
    }
  });

  it("medium always picks from the capture-or-check set when one exists", () => {
    // Ruy Lopez-style middlegame with several captures available.
    const fen =
      "r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1";
    const legal = new Chess(fen).moves({ verbose: true });
    const hasPreferred = legal.some((m) => isCaptureOrCheck(fen, m));
    expect(hasPreferred).toBe(true);

    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 0.999999, noNaN: true, noDefaultInfinity: true }),
        (r) => {
          const move = chooseMove(fen, "medium", () => r);
          expect(move).not.toBeNull();
          const verbose = legal.find(
            (m) => m.from === move?.from && m.to === move?.to,
          );
          expect(verbose).toBeDefined();
          expect(isCaptureOrCheck(fen, verbose as Move)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("medium still returns a legal move when no captures or checks exist", () => {
    // The opening position has no captures and no checking moves available.
    const legal = new Chess(START_FEN).moves({ verbose: true });
    expect(legal.every((m) => !isCaptureOrCheck(START_FEN, m))).toBe(true);

    for (const r of [0, 0.3, 0.6, 0.99]) {
      const move = chooseMove(START_FEN, "medium", () => r);
      expect(move).not.toBeNull();
      expect(isLegal(START_FEN, move as AiMove)).toBe(true);
    }
  });

  it("returns null at checkmate (no legal moves)", () => {
    // Reach fool's mate, then ask the mated side for a move.
    const game = new ChessGame();
    game.makeMove("f2", "f3");
    game.makeMove("e7", "e5");
    game.makeMove("g2", "g4");
    game.makeMove("d8", "h4");

    expect(chooseMove(game, "easy", seededRng([0.5]))).toBeNull();
    expect(chooseMove(game, "medium", seededRng([0.5]))).toBeNull();
  });

  it("returns null at stalemate (no legal moves)", () => {
    const fen = "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1";
    expect(chooseMove(fen, "easy", seededRng([0.5]))).toBeNull();
    expect(chooseMove(fen, "medium", seededRng([0.5]))).toBeNull();
  });
});
