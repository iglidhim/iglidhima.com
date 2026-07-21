// Render/behaviour tests for the Chess view.
//
// Lives under src/ui/** so it runs in the jsdom environment (see vite.config.ts),
// giving it a document and window. The game logic + AI are the real WAVE 1
// modules; determinism for the vs-computer flow comes from an injected `rng`
// plus `aiDelayMs: 0` driven under vitest's fake timers.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createChess } from "./chess";

/** A square button by algebraic name (e.g. "e2"). */
function square(host: HTMLElement, name: string): HTMLButtonElement {
  return host.querySelector<HTMLButtonElement>(
    `.chess__square[data-square="${name}"]`,
  )!;
}

/** Count squares currently showing a piece glyph. */
function pieceCount(host: HTMLElement): number {
  return Array.from(host.querySelectorAll(".chess__square")).filter(
    (el) => (el.textContent ?? "").trim().length > 0,
  ).length;
}

function statusText(host: HTMLElement): string {
  return host.querySelector(".chess__status")!.textContent ?? "";
}

describe("createChess", () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  it("renders the mode selection toggles and a Back-to-Hub control", () => {
    const view = createChess({ onBackToHub: () => {} });
    view.mount(host);

    const modeButtons = host.querySelectorAll<HTMLButtonElement>(".chess__mode");
    expect(modeButtons).toHaveLength(2);
    expect(modeButtons[0]?.dataset.mode).toBe("cpu");
    expect(modeButtons[1]?.dataset.mode).toBe("two-player");
    expect(host.querySelector(".chess__back")).not.toBeNull();
  });

  it("shows the difficulty selector only in Vs Computer mode", () => {
    const view = createChess({ onBackToHub: () => {} });
    view.mount(host);

    const difficulties = host.querySelector<HTMLElement>(".chess__difficulties")!;
    // Default mode is Two Player, so difficulty is hidden.
    expect(difficulties.hidden).toBe(true);

    host.querySelector<HTMLButtonElement>('.chess__mode[data-mode="cpu"]')!.click();
    expect(difficulties.hidden).toBe(false);
    expect(host.querySelectorAll(".chess__difficulty")).toHaveLength(2);
  });

  it("choosing Two Player renders a board with 32 piece glyphs", () => {
    const view = createChess({ onBackToHub: () => {} });
    view.mount(host);

    host
      .querySelector<HTMLButtonElement>('.chess__mode[data-mode="two-player"]')!
      .click();

    expect(host.querySelectorAll(".chess__square")).toHaveLength(64);
    expect(pieceCount(host)).toBe(32);
    // White is at the bottom: a1 holds a white rook (♖).
    expect(square(host, "a1").textContent).toBe("\u2656");
    expect(square(host, "a1").dataset.pieceColor).toBe("w");
    // Black is at the top: a8 holds a black rook (♜).
    expect(square(host, "a8").textContent).toBe("\u265C");
    expect(square(host, "a8").dataset.pieceColor).toBe("b");
  });

  it("click-to-move: selecting e2 highlights e3/e4, then e4 moves the pawn (Two Player)", () => {
    const view = createChess({ onBackToHub: () => {} });
    view.mount(host);

    // Select the e2 pawn.
    square(host, "e2").click();
    expect(square(host, "e2").classList.contains("is-selected")).toBe(true);
    expect(square(host, "e3").classList.contains("is-target")).toBe(true);
    expect(square(host, "e4").classList.contains("is-target")).toBe(true);

    // Move to e4.
    square(host, "e4").click();
    expect((square(host, "e2").textContent ?? "").trim()).toBe("");
    expect(square(host, "e4").textContent).toBe("\u2659"); // white pawn
    expect(square(host, "e4").dataset.pieceColor).toBe("w");
    // Selection cleared and the turn passed to Black.
    expect(square(host, "e2").classList.contains("is-selected")).toBe(false);
    expect(statusText(host)).toBe("Black to move");
  });

  it("clicking a piece then a non-target empty square clears the selection", () => {
    const view = createChess({ onBackToHub: () => {} });
    view.mount(host);

    square(host, "e2").click();
    expect(square(host, "e2").classList.contains("is-selected")).toBe(true);

    // e5 is empty and not a legal target of the e2 pawn: selection clears.
    square(host, "e5").click();
    expect(square(host, "e2").classList.contains("is-selected")).toBe(false);
    expect(host.querySelectorAll(".chess__square.is-target")).toHaveLength(0);
    // No move was made — still White to move with 32 pieces.
    expect(pieceCount(host)).toBe(32);
    expect(statusText(host)).toBe("White to move");
  });

  it("New game resets to 32 pieces and White to move", () => {
    const view = createChess({ onBackToHub: () => {} });
    view.mount(host);

    // Play a couple of moves first.
    square(host, "e2").click();
    square(host, "e4").click();
    expect(statusText(host)).toBe("Black to move");

    host.querySelector<HTMLButtonElement>(".chess__new-game")!.click();
    expect(pieceCount(host)).toBe(32);
    expect(statusText(host)).toBe("White to move");
    expect(square(host, "e2").textContent).toBe("\u2659");
  });

  it("Vs Computer (Easy): after the human White move the computer replies as Black", () => {
    vi.useFakeTimers();
    try {
      // Deterministic RNG (always the first legal move) + no thinking delay.
      const view = createChess({
        onBackToHub: () => {},
        rng: () => 0,
        aiDelayMs: 0,
      });
      view.mount(host);

      host
        .querySelector<HTMLButtonElement>('.chess__mode[data-mode="cpu"]')!
        .click();
      // Human (White) plays e2-e4.
      square(host, "e2").click();
      square(host, "e4").click();
      // The computer's reply is scheduled on a timer; run it.
      vi.runAllTimers();

      // Black has replied, so it is White's turn again.
      expect(statusText(host)).toBe("White to move");
      // A black piece has moved off its back/second rank somewhere.
      expect(pieceCount(host)).toBe(32);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never lets the human move for Black in Vs Computer mode", () => {
    vi.useFakeTimers();
    try {
      const view = createChess({
        onBackToHub: () => {},
        rng: () => 0,
        aiDelayMs: 10,
      });
      view.mount(host);
      host
        .querySelector<HTMLButtonElement>('.chess__mode[data-mode="cpu"]')!
        .click();

      // Human plays a White move; the AI reply is pending (aiThinking).
      square(host, "e2").click();
      square(host, "e4").click();
      // While the computer is thinking, clicking a black piece does nothing.
      square(host, "d7").click();
      expect(square(host, "d7").classList.contains("is-selected")).toBe(false);

      vi.runAllTimers();
    } finally {
      vi.useRealTimers();
    }
  });

  it("destroy() cancels a pending AI timeout without error and detaches the DOM", () => {
    vi.useFakeTimers();
    try {
      const view = createChess({
        onBackToHub: () => {},
        rng: () => 0,
        aiDelayMs: 1000,
      });
      view.mount(host);
      host
        .querySelector<HTMLButtonElement>('.chess__mode[data-mode="cpu"]')!
        .click();

      // Trigger a human move so the AI reply is scheduled but not yet run.
      square(host, "e2").click();
      square(host, "e4").click();

      expect(() => {
        view.destroy();
        vi.runAllTimers();
      }).not.toThrow();

      expect(host.querySelector(".chess")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("invokes onBackToHub when Back to Hub is activated", () => {
    const onBackToHub = vi.fn();
    const view = createChess({ onBackToHub });
    view.mount(host);

    host.querySelector<HTMLButtonElement>(".chess__back")!.click();
    expect(onBackToHub).toHaveBeenCalledTimes(1);
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });
});
