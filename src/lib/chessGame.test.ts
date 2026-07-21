import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import { ChessGame, type Square } from "./chessGame";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// Every algebraic square, file a→h across rank 1→8, for exhaustive iteration.
const ALL_SQUARES: Square[] = [];
for (const rank of ["1", "2", "3", "4", "5", "6", "7", "8"]) {
  for (const file of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
    ALL_SQUARES.push(`${file}${rank}` as Square);
  }
}

describe("ChessGame", () => {
  it("a fresh game reports the standard starting position and White to move", () => {
    const game = new ChessGame();
    expect(game.fen()).toBe(START_FEN);
    expect(game.turn()).toBe("w");
  });

  it("the starting position has exactly 20 legal moves in total", () => {
    const game = new ChessGame();
    // Summing per-square legal targets equals the total move count at the start
    // (no piece has two distinct moves to the same square there).
    const total = ALL_SQUARES.reduce(
      (sum, square) => sum + game.legalTargetsFrom(square).length,
      0,
    );
    expect(total).toBe(20);
    // Cross-check against chess.js's own move generation for the same position.
    expect(new Chess(game.fen()).moves()).toHaveLength(20);
  });

  it("reports the correct legal targets for e2 and g1 at the start", () => {
    const game = new ChessGame();
    expect(new Set(game.legalTargetsFrom("e2"))).toEqual(new Set(["e3", "e4"]));
    expect(new Set(game.legalTargetsFrom("g1"))).toEqual(new Set(["f3", "h3"]));
  });

  it("makeMove applies a legal move and rejects an illegal one", () => {
    const game = new ChessGame();

    // Illegal: a pawn cannot jump three squares; position must be unchanged.
    expect(game.makeMove("e2", "e5")).toBe(false);
    expect(game.fen()).toBe(START_FEN);
    expect(game.turn()).toBe("w");

    // Legal: e2-e4 applies and hands the turn to Black.
    expect(game.makeMove("e2", "e4")).toBe(true);
    expect(game.turn()).toBe("b");
    expect(game.legalTargetsFrom("e4")).toEqual([]);
  });

  it("auto-promotes a pawn reaching the last rank to a queen", () => {
    // White pawn on a7, one push from promotion; kings kept apart and safe.
    const game = new ChessGame("8/P6k/8/8/8/8/8/7K w - - 0 1");
    expect(game.makeMove("a7", "a8")).toBe(true);

    // a8 is board[0][0] (rank 8, file a) and must now hold a White queen.
    const board = game.board();
    expect(board[0]?.[0]).toEqual({ type: "q", color: "w" });
  });

  it("detects checkmate and names the winner (fool's mate)", () => {
    const game = new ChessGame();
    // 1. f3 e5 2. g4 Qh4#
    expect(game.makeMove("f2", "f3")).toBe(true);
    expect(game.makeMove("e7", "e5")).toBe(true);
    expect(game.makeMove("g2", "g4")).toBe(true);
    expect(game.makeMove("d8", "h4")).toBe(true);

    const status = game.status();
    expect(status.isCheckmate).toBe(true);
    expect(status.isGameOver).toBe(true);
    expect(status.inCheck).toBe(true);
    // White is to move and mated, so Black is the winner.
    expect(status.turn).toBe("w");
    expect(status.winner).toBe("b");
    expect(status.isDraw).toBe(false);
  });

  it("detects a stalemate as a draw with no winner", () => {
    // Classic K+Q vs K stalemate: Black to move, no legal move, not in check.
    const game = new ChessGame("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
    const status = game.status();
    expect(status.isStalemate).toBe(true);
    expect(status.isDraw).toBe(true);
    expect(status.isGameOver).toBe(true);
    expect(status.inCheck).toBe(false);
    expect(status.isCheckmate).toBe(false);
    expect(status.winner).toBeUndefined();
  });

  it("reset restores the starting position after moves are played", () => {
    const game = new ChessGame();
    game.makeMove("e2", "e4");
    game.makeMove("c7", "c5");
    expect(game.fen()).not.toBe(START_FEN);

    game.reset();
    expect(game.fen()).toBe(START_FEN);
    expect(game.turn()).toBe("w");

    // newGame() is an alias for reset().
    game.makeMove("d2", "d4");
    game.newGame();
    expect(game.fen()).toBe(START_FEN);
  });
});
