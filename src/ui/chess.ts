// src/ui/chess.ts
// Chess view — the play experience a Visitor opens from the Hub (parallel to
// the Family_Corner view). This is a framework-free vanilla-TS factory matching
// the other ui/ components (familyCorner, playArea, …): it builds its own DOM
// using `.chess*` CSS classes (styling in src/styles/global.css) and exposes the
// shared { element, mount, destroy } handle.
//
// It is the composition root for playing chess in the browser. It renders:
//   - a persistent mode selector ("Vs Computer" / "Two Player") plus, in vs-
//     computer mode, a difficulty selector ("Easy" / "Medium"), all as
//     accessible aria-pressed toggle buttons;
//   - an 8x8 grid of native <button> squares (NOT canvas) showing pieces as
//     Unicode glyphs, White at the bottom and the a-file on the left;
//   - an aria-live status line describing whose turn it is / check / mate / draw;
//   - a "New game" control and a Back-to-Hub control mirroring familyCorner.
//
// Interaction is click-to-move (no drag): the first click on a square holding a
// piece of the side to move selects it and highlights its legal targets (from
// ChessGame.legalTargetsFrom); the second click on a highlighted target applies
// the move (ChessGame.makeMove auto-promotes pawns to a queen in the adapter).
//
// In vs-computer mode the human plays White and the computer plays Black: after
// a human move, if the game is not over and it is the computer's turn, board
// input is disabled, the component waits `aiDelayMs` (a guarded setTimeout), then
// applies chooseMove(game, difficulty, rng) and re-renders. destroy() cancels any
// pending AI move so there are no leaks or late writes to a torn-down view.

import { ChessGame, type Board, type BoardSquare, type PieceColor, type Square } from "../lib/chessGame";
import { chooseMove, type Difficulty, type Rng } from "../lib/chessAi";

/** The two ways to play: against the computer, or two humans on one board. */
export type ChessMode = "cpu" | "two-player";

/** Options for {@link createChess}. */
export interface CreateChessOptions {
  /** Invoked when the Visitor activates Back-to-Hub (mirrors familyCorner). */
  onBackToHub: () => void;
  /**
   * Random source for the computer opponent, in `[0, 1)`. Injectable so tests
   * drive the AI deterministically; defaults to `Math.random`.
   */
  rng?: Rng;
  /**
   * The computer "thinking" delay in milliseconds before it replies. Defaults
   * to ~350ms for a natural feel; tests pass 0 to resolve immediately.
   */
  aiDelayMs?: number;
}

/** A mounted Chess view. Returned by {@link createChess}. */
export interface Chess {
  /** The view root element (also exposed for testing/positioning). */
  readonly element: HTMLElement;
  /** Attach the view to a parent node. */
  mount(parent: HTMLElement): void;
  /** Cancel any pending AI move, detach listeners, and remove from the DOM. */
  destroy(): void;
}

/** Files left→right as rendered (a on the left). */
const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;

/** Unicode glyphs for each piece by color then type. */
const GLYPHS: Record<PieceColor, Record<string, string>> = {
  w: { k: "\u2654", q: "\u2655", r: "\u2656", b: "\u2657", n: "\u2658", p: "\u2659" },
  b: { k: "\u265A", q: "\u265B", r: "\u265C", b: "\u265D", n: "\u265E", p: "\u265F" },
};

/** Human-readable piece-type names for square aria-labels. */
const TYPE_NAMES: Record<string, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

/** Human-readable color names for square aria-labels. */
const COLOR_NAMES: Record<PieceColor, string> = { w: "white", b: "black" };

/** The computer plays Black in vs-computer mode; the human plays White. */
const HUMAN_COLOR: PieceColor = "w";
const COMPUTER_COLOR: PieceColor = "b";

/** Read the piece standing on `square` from a board snapshot (or `null`). */
function pieceAt(board: Board, square: Square): BoardSquare {
  const file = FILES.indexOf(square[0] as (typeof FILES)[number]);
  const rank = Number(square[1]);
  const row = board[8 - rank];
  if (row === undefined) return null;
  return row[file] ?? null;
}

/** Find the square of `color`'s king in a board snapshot, or `null`. */
function findKing(board: Board, color: PieceColor): Square | null {
  for (let r = 0; r < 8; r++) {
    const row = board[r];
    if (row === undefined) continue;
    for (let f = 0; f < 8; f++) {
      const cell = row[f];
      if (cell && cell.type === "k" && cell.color === color) {
        return `${FILES[f]}${8 - r}` as Square;
      }
    }
  }
  return null;
}

/**
 * Create the Chess view.
 *
 * The view is usable as soon as it is mounted: a fresh game is set up, the
 * board is rendered, and the mode/difficulty toggles + New game + Back controls
 * are wired. The default mode is Two Player so the board is immediately
 * playable; switching modes resets the position (keeping the human as White in
 * vs-computer mode).
 */
export function createChess(options: CreateChessOptions): Chess {
  const { onBackToHub } = options;
  const rng: Rng = options.rng ?? Math.random;
  const aiDelayMs = options.aiDelayMs ?? 350;

  // --- Game + interaction state -------------------------------------------
  const game = new ChessGame();
  let mode: ChessMode = "two-player";
  let difficulty: Difficulty = "easy";
  let selected: Square | null = null;
  let legalTargets: Square[] = [];
  // Set while the computer is "thinking"; blocks human input until it replies.
  let aiThinking = false;
  // The pending AI move timer, cleared on destroy / new game / mode switch.
  let aiTimeout: ReturnType<typeof setTimeout> | null = null;

  // --- Root ---------------------------------------------------------------
  const root = document.createElement("div");
  root.className = "chess";
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", "Chess");

  // --- Header with Back-to-Hub (mirrors familyCorner) ---------------------
  const header = document.createElement("div");
  header.className = "chess__header";

  const backButton = document.createElement("button");
  backButton.type = "button";
  backButton.className = "btn chess__back";
  backButton.textContent = "Back to Hub";
  backButton.setAttribute("aria-label", "Back to Hub");

  const heading = document.createElement("h1");
  heading.className = "chess__title";
  heading.textContent = "Chess";

  header.append(backButton, heading);

  // --- Controls: mode + difficulty + new game -----------------------------
  const controls = document.createElement("div");
  controls.className = "chess__controls";

  const modeGroup = document.createElement("div");
  modeGroup.className = "chess__modes";
  modeGroup.setAttribute("role", "group");
  modeGroup.setAttribute("aria-label", "Game mode");

  const modeCpuButton = document.createElement("button");
  modeCpuButton.type = "button";
  modeCpuButton.className = "btn chess__mode";
  modeCpuButton.dataset.mode = "cpu";
  modeCpuButton.textContent = "Vs Computer";
  modeCpuButton.setAttribute("aria-label", "Play against the computer");

  const modeTwoButton = document.createElement("button");
  modeTwoButton.type = "button";
  modeTwoButton.className = "btn chess__mode";
  modeTwoButton.dataset.mode = "two-player";
  modeTwoButton.textContent = "Two Player";
  modeTwoButton.setAttribute("aria-label", "Play two players on one board");

  modeGroup.append(modeCpuButton, modeTwoButton);

  const difficultyGroup = document.createElement("div");
  difficultyGroup.className = "chess__difficulties";
  difficultyGroup.setAttribute("role", "group");
  difficultyGroup.setAttribute("aria-label", "Computer difficulty");

  const easyButton = document.createElement("button");
  easyButton.type = "button";
  easyButton.className = "btn chess__difficulty";
  easyButton.dataset.difficulty = "easy";
  easyButton.textContent = "Easy";
  easyButton.setAttribute("aria-label", "Easy computer");

  const mediumButton = document.createElement("button");
  mediumButton.type = "button";
  mediumButton.className = "btn chess__difficulty";
  mediumButton.dataset.difficulty = "medium";
  mediumButton.textContent = "Medium";
  mediumButton.setAttribute("aria-label", "Medium computer");

  difficultyGroup.append(easyButton, mediumButton);

  const newGameButton = document.createElement("button");
  newGameButton.type = "button";
  newGameButton.className = "btn chess__new-game";
  newGameButton.textContent = "New game";
  newGameButton.setAttribute("aria-label", "New game");

  controls.append(modeGroup, difficultyGroup, newGameButton);

  // --- Status line (aria-live) --------------------------------------------
  const statusEl = document.createElement("p");
  statusEl.className = "chess__status";
  statusEl.setAttribute("role", "status");
  statusEl.setAttribute("aria-live", "polite");

  // --- Board --------------------------------------------------------------
  const boardEl = document.createElement("div");
  boardEl.className = "chess__board";
  boardEl.setAttribute("role", "grid");
  boardEl.setAttribute("aria-label", "Chess board");

  // Build the 64 square buttons once, in visual order (rank 8 → rank 1, file
  // a → h), so White ends up at the bottom and the a-file on the left. A single
  // delegated click listener reads `data-square`, so re-rendering is free to
  // rewrite each button's content without touching listeners.
  const squareButtons = new Map<Square, HTMLButtonElement>();
  for (let r = 0; r < 8; r++) {
    const rank = 8 - r;
    for (let f = 0; f < 8; f++) {
      const square = `${FILES[f]}${rank}` as Square;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chess__square";
      // a1 is dark: a square is light when (file index + rank) is even.
      const light = (f + rank) % 2 === 0;
      btn.classList.add(light ? "chess__square--light" : "chess__square--dark");
      btn.dataset.square = square;
      boardEl.appendChild(btn);
      squareButtons.set(square, btn);
    }
  }

  root.append(header, controls, statusEl, boardEl);

  // --- Rendering -----------------------------------------------------------
  function statusText(): string {
    const status = game.status();
    if (status.isCheckmate) {
      return `Checkmate — ${status.winner === "w" ? "White" : "Black"} wins`;
    }
    if (status.isStalemate) {
      return "Stalemate — draw";
    }
    if (status.isDraw) {
      return "Draw";
    }
    const side = status.turn === "w" ? "White" : "Black";
    return status.inCheck ? `${side} to move — Check!` : `${side} to move`;
  }

  function render(): void {
    const board = game.board();
    const status = game.status();
    const checkSquare = status.inCheck ? findKing(board, status.turn) : null;

    for (let r = 0; r < 8; r++) {
      const row = board[r];
      const rank = 8 - r;
      for (let f = 0; f < 8; f++) {
        const square = `${FILES[f]}${rank}` as Square;
        const btn = squareButtons.get(square);
        if (btn === undefined) continue;
        const piece = row?.[f] ?? null;

        if (piece) {
          btn.textContent = GLYPHS[piece.color][piece.type] ?? "";
          btn.dataset.pieceColor = piece.color;
        } else {
          btn.textContent = "";
          delete btn.dataset.pieceColor;
        }

        const isSelected = selected === square;
        const isTarget = legalTargets.includes(square);
        const isCapture = isTarget && piece !== null;
        const isCheck = checkSquare === square;

        btn.classList.toggle("is-selected", isSelected);
        btn.classList.toggle("is-target", isTarget && !isCapture);
        btn.classList.toggle("is-capture", isCapture);
        btn.classList.toggle("is-check", isCheck);

        const desc = piece
          ? `${COLOR_NAMES[piece.color]} ${TYPE_NAMES[piece.type] ?? piece.type}`
          : "empty";
        let label = `${square}, ${desc}`;
        if (isSelected) {
          label += ", selected";
        } else if (isTarget) {
          label += piece ? ", capture" : ", legal move";
        }
        btn.setAttribute("aria-label", label);
      }
    }

    statusEl.textContent = statusText();

    modeCpuButton.setAttribute("aria-pressed", String(mode === "cpu"));
    modeTwoButton.setAttribute("aria-pressed", String(mode === "two-player"));
    difficultyGroup.hidden = mode !== "cpu";
    easyButton.setAttribute("aria-pressed", String(difficulty === "easy"));
    mediumButton.setAttribute("aria-pressed", String(difficulty === "medium"));

    boardEl.classList.toggle("chess__board--thinking", aiThinking);
  }

  // --- Selection helpers ---------------------------------------------------
  function clearSelection(): void {
    selected = null;
    legalTargets = [];
  }

  function selectSquare(square: Square): void {
    selected = square;
    legalTargets = game.legalTargetsFrom(square);
    render();
  }

  // --- Computer opponent ---------------------------------------------------
  function clearAiTimeout(): void {
    if (aiTimeout !== null) {
      clearTimeout(aiTimeout);
      aiTimeout = null;
    }
    aiThinking = false;
  }

  /**
   * If it is the computer's turn in vs-computer mode and the game is live,
   * disable input and schedule the computer's reply after `aiDelayMs`.
   */
  function maybeScheduleAi(): void {
    if (mode !== "cpu") return;
    if (game.status().isGameOver) return;
    if (game.turn() !== COMPUTER_COLOR) return;

    aiThinking = true;
    render();
    aiTimeout = setTimeout(() => {
      aiTimeout = null;
      const move = chooseMove(game, difficulty, rng);
      if (move !== null) {
        game.makeMove(move.from, move.to);
      }
      aiThinking = false;
      render();
    }, aiDelayMs);
  }

  // --- Click-to-move handling ---------------------------------------------
  function handleSquare(square: Square): void {
    if (aiThinking) return;
    if (game.status().isGameOver) return;

    const turn = game.turn();
    // In vs-computer mode the human only ever moves White.
    if (mode === "cpu" && turn !== HUMAN_COLOR) return;

    const board = game.board();
    const piece = pieceAt(board, square);

    if (selected === null) {
      // First click: select an own piece; ignore empty / enemy squares.
      if (piece && piece.color === turn) {
        selectSquare(square);
      }
      return;
    }

    if (square === selected) {
      // Clicking the selected piece again deselects it.
      clearSelection();
      render();
      return;
    }

    if (legalTargets.includes(square)) {
      // Second click on a legal target: apply the move (auto-queen in adapter).
      game.makeMove(selected, square);
      clearSelection();
      render();
      maybeScheduleAi();
      return;
    }

    if (piece && piece.color === turn) {
      // Clicking another own piece re-selects it.
      selectSquare(square);
      return;
    }

    // Clicking a non-legal, non-own square clears the selection.
    clearSelection();
    render();
  }

  // --- Listeners -----------------------------------------------------------
  const cleanups: Array<() => void> = [];

  function addClick(el: HTMLElement, handler: (event: MouseEvent) => void): void {
    el.addEventListener("click", handler);
    cleanups.push(() => el.removeEventListener("click", handler));
  }

  addClick(backButton, () => onBackToHub());

  addClick(newGameButton, () => {
    clearAiTimeout();
    game.newGame();
    clearSelection();
    render();
  });

  function setMode(next: ChessMode): void {
    if (mode === next) return;
    clearAiTimeout();
    mode = next;
    // Reset the position on a mode switch so vs-computer always starts with the
    // human (White) to move; the chosen mode/difficulty are preserved.
    game.newGame();
    clearSelection();
    render();
    maybeScheduleAi();
  }

  addClick(modeCpuButton, () => setMode("cpu"));
  addClick(modeTwoButton, () => setMode("two-player"));

  addClick(easyButton, () => {
    difficulty = "easy";
    render();
  });
  addClick(mediumButton, () => {
    difficulty = "medium";
    render();
  });

  addClick(boardEl, (event) => {
    const target = event.target as HTMLElement | null;
    const btn = target?.closest<HTMLButtonElement>(".chess__square");
    if (!btn || !boardEl.contains(btn)) return;
    const square = btn.dataset.square as Square | undefined;
    if (square === undefined) return;
    handleSquare(square);
  });

  // Initial paint.
  render();

  return {
    element: root,

    mount(parent: HTMLElement): void {
      parent.appendChild(root);
    },

    destroy(): void {
      clearAiTimeout();
      for (const cleanup of cleanups) {
        cleanup();
      }
      cleanups.length = 0;
      squareButtons.clear();
      root.replaceChildren();
      root.remove();
    },
  };
}
