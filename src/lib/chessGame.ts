// Thin, well-documented adapter around chess.js (0.10.3) that exposes a clean,
// typed interface the Chess UI (wave 2) renders and drives.
//
// chess.js is kept as the single source of truth for the rules of chess — this
// module never reimplements move generation, check/mate detection, or draw
// rules. It only translates chess.js's snake_case predicates and verbose move
// objects into a small, render-friendly surface: an 8x8 board snapshot, whose
// turn it is, the legal destination squares for a given piece, a move applier
// that auto-promotes pawns to a queen, and a derived status object.
//
// It uses no DOM or Workers globals, so it stays pure logic and is unit- and
// property-testable independent of the canvas/DOM (it is part of the client
// tsconfig program; the Worker program excludes `src/lib`).

import { Chess, type ChessInstance, type Move, type PieceType, type Square } from "chess.js";

/** The side to move / a piece's color: `"w"` for White, `"b"` for Black. */
export type PieceColor = "w" | "b";

// Re-exported chess.js primitives so the UI can depend on this adapter alone
// rather than reaching into chess.js's own type surface.
export type { Move, PieceType, Square };

/** A single piece as rendered on the board: its `type` and `color`. */
export interface BoardPiece {
  readonly type: PieceType;
  readonly color: PieceColor;
}

/** One board square: a {@link BoardPiece}, or `null` when the square is empty. */
export type BoardSquare = BoardPiece | null;

/**
 * A read snapshot of the board as an 8x8 grid, in chess.js order: `board[0]` is
 * rank 8 (Black's back rank) and `board[7]` is rank 1 (White's back rank); each
 * inner array runs file a→h.
 */
export type Board = ReadonlyArray<ReadonlyArray<BoardSquare>>;

/**
 * The derived, render-friendly game status.
 *
 * `isDraw` covers every drawn outcome chess.js recognizes (stalemate, threefold
 * repetition, insufficient material, and the 50-move rule). `winner` is only
 * present on checkmate and names the side that delivered mate.
 */
export interface ChessStatus {
  /** The side to move. */
  readonly turn: PieceColor;
  /** True when the side to move is in check (but not necessarily mated). */
  readonly inCheck: boolean;
  /** True when the side to move has been checkmated. */
  readonly isCheckmate: boolean;
  /** True for any drawn position (stalemate, threefold, insufficient, 50-move). */
  readonly isDraw: boolean;
  /** True when the position is a stalemate specifically. */
  readonly isStalemate: boolean;
  /** True when the game has ended by any means (checkmate or draw). */
  readonly isGameOver: boolean;
  /** The winning side, present only when `isCheckmate` is true. */
  readonly winner?: PieceColor;
}

/**
 * A stateful adapter that wraps a single chess.js game.
 *
 * Construct a fresh game with `new ChessGame()` or load a position with
 * `new ChessGame(fen)` / {@link ChessGame.fromFen}. All rule questions delegate
 * to the wrapped chess.js instance.
 */
export class ChessGame {
  private readonly chess: ChessInstance;

  /**
   * Build a game. With no argument the standard starting position is used;
   * with a FEN string that position is loaded instead (handy for tests).
   */
  constructor(fen?: string) {
    this.chess = fen !== undefined ? new Chess(fen) : new Chess();
  }

  /** Construct a game from a FEN string. */
  static fromFen(fen: string): ChessGame {
    return new ChessGame(fen);
  }

  /**
   * The current board as an 8x8 grid for rendering.
   *
   * chess.js returns a freshly built array on every call, so the snapshot is
   * safe to hand to the renderer without further copying.
   */
  board(): Board {
    return this.chess.board();
  }

  /** Whose turn it is to move. */
  turn(): PieceColor {
    return this.chess.turn();
  }

  /**
   * The legal destination squares for the piece standing on `square`.
   *
   * Returns a de-duplicated list (a pawn one step from promotion generates one
   * verbose move per promotion piece to the same square; the UI only cares
   * about the destination). Empty when the square is empty, holds an enemy
   * piece, or the piece there has no legal move.
   */
  legalTargetsFrom(square: Square): Square[] {
    const moves = this.chess.moves({ square, verbose: true });
    const targets = new Set<Square>();
    for (const move of moves) {
      targets.add(move.to);
    }
    return [...targets];
  }

  /**
   * Attempt to move a piece from `from` to `to`, auto-promoting a pawn that
   * reaches the last rank to a queen. Returns `true` when the move was legal
   * and applied, `false` when it was illegal (the position is left unchanged).
   *
   * `promotion` is always passed; chess.js ignores it for non-promoting moves.
   */
  makeMove(from: Square, to: Square): boolean {
    const result = this.chess.move({ from, to, promotion: "q" });
    return result !== null;
  }

  /**
   * The derived {@link ChessStatus} for the current position, translated from
   * chess.js's snake_case predicates.
   */
  status(): ChessStatus {
    const turn = this.chess.turn();
    const isCheckmate = this.chess.in_checkmate();
    const base = {
      turn,
      inCheck: this.chess.in_check(),
      isCheckmate,
      isDraw: this.chess.in_draw(),
      isStalemate: this.chess.in_stalemate(),
      isGameOver: this.chess.game_over(),
    };
    // On checkmate the side to move has been mated, so the winner is the other
    // side. `winner` is omitted entirely otherwise (exactOptionalPropertyTypes).
    if (isCheckmate) {
      return { ...base, winner: turn === "w" ? "b" : "w" };
    }
    return base;
  }

  /** Reset the board to the standard starting position. */
  reset(): void {
    this.chess.reset();
  }

  /** Alias for {@link ChessGame.reset}: start a fresh game from the initial position. */
  newGame(): void {
    this.chess.reset();
  }

  /** The FEN string describing the current position. */
  fen(): string {
    return this.chess.fen();
  }
}
