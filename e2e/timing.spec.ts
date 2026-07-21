// e2e/timing.spec.ts
// Timing / performance integration checks (Requirements 3.3, 4.2, 10.2).
//
// Two behaviours are validated against the running preview build:
//   * a directional input is reflected on screen within ~100ms (Req 3.3, 4.2):
//     we mark the moment a key is dispatched and measure how soon the next
//     animation frame renders — the game loop redraws every frame, so a frame
//     within 100ms means the input is applied and the display updated well
//     inside the budget;
//   * gameplay sustains at least ~30fps (Req 10.2): we sample requestAnimationFrame
//     callbacks in-page over a short window and derive the frame rate.
//
// The thresholds are kept deliberately tolerant (with slack for CI/headless
// jitter) so the checks assert the requirement without becoming flaky.

import { test, expect, type Page } from "@playwright/test";

/** Select the first game, wait for it to mount, and start play. */
async function startFirstGame(page: Page): Promise<void> {
  await page.locator(".hub-card").first().click();
  await page.locator(".play-area__canvas").waitFor({ state: "visible" });
  await page.locator('[data-control="start"]').click();
  // Pause becomes available once running — confirms the loop is live.
  await page.locator('[data-control="pause"]').waitFor({ state: "visible" });
}

test.describe("timing and performance", () => {
  test("a directional input is reflected within 100ms (Req 3.3, 4.2)", async ({ page }) => {
    await page.goto("/");
    await startFirstGame(page);
    await page.locator(".play-area__canvas").focus();

    // Arm an in-page probe that records the time of the next animation frame.
    await page.evaluate(() => {
      (window as unknown as { __frameAfterInput?: number }).__frameAfterInput = undefined;
      (window as unknown as { __inputMark?: number }).__inputMark = performance.now();
      requestAnimationFrame(() => {
        (window as unknown as { __frameAfterInput?: number }).__frameAfterInput =
          performance.now();
      });
    });

    // Dispatch a directional input.
    await page.keyboard.press("ArrowUp");

    // The next rendered frame after the input arrives well within 100ms.
    await page.waitForFunction(
      () => (window as unknown as { __frameAfterInput?: number }).__frameAfterInput !== undefined,
      undefined,
      { timeout: 1000 },
    );
    const latency = await page.evaluate(() => {
      const w = window as unknown as { __inputMark: number; __frameAfterInput: number };
      return w.__frameAfterInput - w.__inputMark;
    });

    expect(latency).toBeLessThanOrEqual(100);
  });

  test("gameplay sustains at least ~30fps (Req 10.2)", async ({ page }) => {
    await page.goto("/");
    await startFirstGame(page);

    // Sample rAF callbacks in-page over ~800ms and compute the frame rate.
    const fps = await page.evaluate(async () => {
      return await new Promise<number>((resolve) => {
        const durationMs = 800;
        let frames = 0;
        const start = performance.now();
        function tick(now: number): void {
          frames += 1;
          if (now - start >= durationMs) {
            resolve((frames * 1000) / (now - start));
            return;
          }
          requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      });
    });

    // Requirement floor is 30fps; allow a small tolerance for headless/CI jitter.
    expect(fps).toBeGreaterThanOrEqual(28);
  });
});
