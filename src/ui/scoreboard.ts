// src/ui/scoreboard.ts
// Scoreboard chrome component (Requirements 4.1, 4.2, 4.3, 6.3).
//
// Displays the current Score and the Active_Game's stored High_Score. The
// current Score updates on every score change (Requirement 4.2) and shows `0`
// before play begins (Requirement 4.3); the High_Score shows the value read
// from the Local_Store when a game becomes active (Requirement 6.3).
//
// This is a framework-free vanilla-TS factory: it builds its own DOM using the
// existing scoreboard CSS classes (defined in src/styles/global.css), so the
// text inherits the semantic colour tokens (`--color-score`, `--color-high-score`)
// that satisfy the >= 4.5:1 contrast requirement (Requirement 9.3). Rendering is
// separate from any game logic, matching the design's UI/engine split.

/**
 * A mounted scoreboard. Returned by {@link createScoreboard}. The engine/UI
 * layer drives it via `setScore` / `setHighScore` and tears it down with
 * `destroy` when the Play_Area is cleared.
 */
export interface Scoreboard {
  /** The scoreboard root element (also exposed for testing/positioning). */
  readonly element: HTMLElement;
  /** Attach the scoreboard to a parent node. */
  mount(parent: HTMLElement): void;
  /** Update the displayed current Score (Requirements 4.1, 4.2). */
  setScore(score: number): void;
  /** Update the displayed stored High_Score (Requirement 6.3). */
  setHighScore(highScore: number): void;
  /** Remove the scoreboard from the DOM and release its references. */
  destroy(): void;
}

/** Labels for the two scoreboard captions. */
const SCORE_CAPTION = "Score";
const HIGH_SCORE_CAPTION = "High Score";

/**
 * Coerce an incoming value to a safe, non-negative integer for display.
 * Guards against NaN/Infinity/negative values so the scoreboard never renders
 * a nonsensical figure; both Score and High_Score are non-negative integers.
 */
function toDisplayValue(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}

/**
 * Create a Scoreboard component.
 *
 * The scoreboard starts showing `0` for both the current Score and the
 * High_Score (Requirement 4.3); callers set the real High_Score via
 * {@link Scoreboard.setHighScore} when a game becomes active (Requirement 6.3),
 * and update the Score via {@link Scoreboard.setScore} as points are awarded
 * (Requirements 4.1, 4.2).
 */
export function createScoreboard(): Scoreboard {
  const root = document.createElement("div");
  root.className = "scoreboard";
  // Announce Score/High_Score changes politely to assistive technology.
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");

  // --- Current Score item -------------------------------------------------
  const scoreItem = document.createElement("div");
  scoreItem.className = "scoreboard__item";

  const scoreCaption = document.createElement("span");
  scoreCaption.className = "scoreboard__caption";
  scoreCaption.textContent = SCORE_CAPTION;

  const scoreValue = document.createElement("span");
  scoreValue.className = "scoreboard__score";
  scoreValue.textContent = "0"; // zero before play begins (Req 4.3)

  scoreItem.append(scoreCaption, scoreValue);

  // --- High_Score item ----------------------------------------------------
  const highItem = document.createElement("div");
  highItem.className = "scoreboard__item";

  const highCaption = document.createElement("span");
  highCaption.className = "scoreboard__caption";
  highCaption.textContent = HIGH_SCORE_CAPTION;

  const highValue = document.createElement("span");
  highValue.className = "scoreboard__high-score";
  highValue.textContent = "0"; // zero until a stored value is provided (Req 6.3)

  highItem.append(highCaption, highValue);

  root.append(scoreItem, highItem);

  return {
    element: root,

    mount(parent: HTMLElement): void {
      parent.appendChild(root);
    },

    setScore(score: number): void {
      scoreValue.textContent = String(toDisplayValue(score));
    },

    setHighScore(highScore: number): void {
      highValue.textContent = String(toDisplayValue(highScore));
    },

    destroy(): void {
      root.remove();
    },
  };
}
