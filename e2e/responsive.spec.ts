// e2e/responsive.spec.ts
// Responsive-layout integration checks (Requirements 8.1, 8.2, 8.3, 8.4).
//
// These run against the served production preview build (see playwright.config.ts)
// across the desktop-chromium and mobile-chromium projects. Viewport widths are
// set explicitly inside each test so the width-dependent assertions are
// deterministic regardless of which project drives them; the touch-controls
// check is gated to the touch-capable mobile project.
//
// Selectors mirror the chrome components:
//   .arcade-container  — centred, max-width page container (main.ts)
//   .hub-card          — one selectable game entry per game (ui/hub.ts)
//   .play-area__stage  — canvas host region (ui/playArea.ts)
//   .play-area__canvas — the game canvas, CSS-capped to the stage width
//   .touch-controls[data-touch="true"] — on-screen controls on touch devices

import { test, expect, type Page } from "@playwright/test";

/** The desktop max-width container cap from src/styles/global.css (--container-max-width). */
const CONTAINER_MAX_WIDTH = 1024;

/** Select the first game and wait for its canvas to mount in the Play_Area. */
async function selectGameAndWaitForCanvas(page: Page): Promise<void> {
  await page.locator(".hub-card").first().click();
  await page.locator(".play-area__canvas").waitFor({ state: "visible" });
}

test.describe("responsive layout", () => {
  test("mobile: single column with no horizontal overflow (Req 8.1)", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.locator(".hub-card").first().waitFor();

    // No horizontal scrolling: the document is no wider than the viewport.
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    // Allow a 1px rounding slack; the layout must not overflow horizontally.
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth + 1);

    // The hub grid collapses to a single column below the mobile breakpoint.
    const columns = await page
      .locator(".hub-grid")
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns);
    // A single track => one column (no space-separated list of track sizes).
    expect(columns.trim().split(/\s+/).length).toBe(1);
  });

  test("desktop: centred max-width container (Req 8.2)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");

    const container = page.locator(".arcade-container");
    await container.waitFor();

    const box = await container.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // Content width is capped at the desktop max-width.
    expect(box.width).toBeLessThanOrEqual(CONTAINER_MAX_WIDTH + 1);

    // The container is horizontally centred within the wider viewport: the left
    // and right gutters are roughly equal.
    const viewportWidth = page.viewportSize()!.width;
    const leftGutter = box.x;
    const rightGutter = viewportWidth - (box.x + box.width);
    expect(Math.abs(leftGutter - rightGutter)).toBeLessThanOrEqual(2);
    expect(leftGutter).toBeGreaterThan(0);
  });

  test("canvas scales to the Play_Area at mobile and desktop widths (Req 8.3)", async ({
    page,
  }) => {
    for (const size of [
      { width: 375, height: 667 },
      { width: 1280, height: 800 },
    ]) {
      await page.setViewportSize(size);
      await page.goto("/");
      await selectGameAndWaitForCanvas(page);

      const { canvasWidth, stageWidth } = await page.evaluate(() => {
        const canvas = document.querySelector<HTMLCanvasElement>(".play-area__canvas")!;
        const stage = document.querySelector<HTMLElement>(".play-area__stage")!;
        return { canvasWidth: canvas.clientWidth, stageWidth: stage.clientWidth };
      });

      // The rendered canvas never exceeds the Play_Area stage width at any size.
      expect(canvasWidth).toBeGreaterThan(0);
      expect(canvasWidth).toBeLessThanOrEqual(stageWidth + 1);
    }
  });

  test("touch controls appear within the initial viewport on touch devices (Req 8.4)", async ({
    page,
  }, testInfo) => {
    // Touch_Controls only render on touch-capable devices; gate to the touch project.
    test.skip(
      testInfo.project.name !== "mobile-chromium",
      "Touch controls only render on the touch-capable mobile project",
    );

    await page.goto("/");
    // Serpent's square (1:1) field keeps the Play_Area compact, so the overlay
    // sits alongside it within the initial viewport at mobile width (Req 8.4).
    await page.locator('.hub-card[data-game-id="serpent"]').click();
    await page.locator(".play-area__canvas").waitFor({ state: "visible" });

    const touch = page.locator('.touch-controls[data-touch="true"]');
    await expect(touch).toBeVisible();

    // The overlay sits within the initial viewport (no need to scroll to reach it).
    const box = await touch.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box).not.toBeNull();
    if (!box) return;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  });
});
