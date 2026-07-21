// e2e/chess.spec.ts
// Chess play-experience integration checks, covering BOTH play modes.
//
// Runs against the served production preview build (see playwright.config.ts).
// Selectors mirror the Chess chrome:
//   .hub__chess          — the Hub entry that opens Chess (ui/hub.ts)
//   .chess               — the play-view root (ui/chess.ts)
//   .chess__board        — the 8x8 board grid
//   .chess__square       — a board square button (data-square="e2", …)
//   .chess__mode         — a mode toggle (data-mode="cpu" | "two-player")
//   .chess__difficulty   — a difficulty toggle (data-difficulty="easy" | "medium")
//   .chess__new-game     — the New game control
//   .chess__status       — the aria-live status line

import { test, expect, type Page } from "@playwright/test";

/** Open Chess from the Hub and wait for the board to mount. */
async function openChess(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator(".hub__chess").click();
  await page.locator(".chess").waitFor({ state: "visible" });
  await page.locator(".chess__board").waitFor({ state: "visible" });
}

/** Click a square by algebraic name (e.g. "e2"). */
function sq(page: Page, name: string) {
  return page.locator(`.chess__square[data-square="${name}"]`);
}

test.describe("Chess", () => {
  test("Two Player: a legal move passes the turn to the other side", async ({ page }) => {
    await openChess(page);

    await page.locator('.chess__mode[data-mode="two-player"]').click();
    await expect(page.locator(".chess__status")).toHaveText("White to move");

    // White plays e2-e4.
    await sq(page, "e2").click();
    await sq(page, "e4").click();

    // The pawn moved and it is now Black's turn.
    await expect(sq(page, "e4")).not.toHaveText("");
    await expect(sq(page, "e2")).toHaveText("");
    await expect(page.locator(".chess__status")).toHaveText("Black to move");
  });

  test("Vs Computer (Easy): the computer replies and it becomes White's turn again", async ({
    page,
  }) => {
    await openChess(page);

    await page.locator('.chess__mode[data-mode="cpu"]').click();
    await page.locator('.chess__difficulty[data-difficulty="easy"]').click();
    await expect(page.locator(".chess__status")).toHaveText("White to move");

    // Human (White) plays e2-e4; the status flips to Black to move immediately.
    await sq(page, "e2").click();
    await sq(page, "e4").click();
    await expect(sq(page, "e2")).toHaveText("");

    // After the computer's reply the turn returns to White (auto-waits for the
    // ~350ms AI delay). A first full move can never end the game.
    await expect(page.locator(".chess__status")).toHaveText("White to move");
  });

  test("New game resets the position", async ({ page }) => {
    await openChess(page);

    await page.locator('.chess__mode[data-mode="two-player"]').click();
    await sq(page, "e2").click();
    await sq(page, "e4").click();
    await expect(sq(page, "e2")).toHaveText("");

    await page.locator(".chess__new-game").click();

    // Back to the starting position: the e2 pawn is home and White is to move.
    await expect(sq(page, "e2")).not.toHaveText("");
    await expect(sq(page, "e4")).toHaveText("");
    await expect(page.locator(".chess__status")).toHaveText("White to move");
  });

  test("board is visible with no horizontal overflow at 320px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await openChess(page);

    await expect(page.locator(".chess__board")).toBeVisible();

    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(
      scrollWidth,
      `document (${scrollWidth}px) must not exceed viewport (${innerWidth}px)`,
    ).toBeLessThanOrEqual(innerWidth + 1);

    // The board stays within the viewport bounds.
    const box = await page.locator(".chess__board").boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width).toBeLessThanOrEqual(innerWidth + 1);
    }
  });
});
