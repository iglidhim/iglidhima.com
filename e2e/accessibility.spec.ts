// e2e/accessibility.spec.ts
// Accessibility integration checks (Requirements 9.1, 9.2, 9.3, 9.4).
//
// Uses @axe-core/playwright to scan the Hub and the Play_Area for WCAG issues,
// asserting no serious/critical violations and — specifically — no colour
// contrast failures for the Score, control labels, and instructions (Req 9.3).
// It also verifies keyboard operability of the selector and lifecycle controls
// with a visible focus indicator (Req 9.1, 9.2), and the document title (Req 9.4).

import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/** Axe impact levels we treat as failures. */
const BLOCKING_IMPACTS = new Set(["serious", "critical"]);

/** Select the first game and wait for the Play_Area chrome to mount. */
async function enterFirstGame(page: Page): Promise<void> {
  await page.locator(".hub-card").first().click();
  await page.locator(".play-area__canvas").waitFor({ state: "visible" });
  await page.locator('[data-control="start"]').waitFor({ state: "visible" });
}

test.describe("accessibility", () => {
  test("document title identifies the arcade hub (Req 9.4)", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/arcade/i);
  });

  test("hub has no serious/critical or contrast violations (Req 9.3)", async ({ page }) => {
    await page.goto("/");
    await page.locator(".hub-card").first().waitFor();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    const blocking = results.violations.filter(
      (v) => v.impact && BLOCKING_IMPACTS.has(v.impact),
    );
    expect(blocking, JSON.stringify(blocking.map((v) => v.id), null, 2)).toEqual([]);

    // Explicit contrast check for Score/labels/instructions text (Req 9.3).
    const contrast = results.violations.filter((v) => v.id === "color-contrast");
    expect(contrast).toEqual([]);
  });

  test("play area has no serious/critical or contrast violations (Req 9.3)", async ({
    page,
  }) => {
    await page.goto("/");
    await enterFirstGame(page);

    const results = await new AxeBuilder({ page })
      .include(".play-area")
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    const blocking = results.violations.filter(
      (v) => v.impact && BLOCKING_IMPACTS.has(v.impact),
    );
    expect(blocking, JSON.stringify(blocking.map((v) => v.id), null, 2)).toEqual([]);

    const contrast = results.violations.filter((v) => v.id === "color-contrast");
    expect(contrast).toEqual([]);
  });

  test("keyboard reaches the game cards with a visible focus indicator (Req 9.1, 9.2)", async ({
    page,
  }) => {
    await page.goto("/");
    await page.locator(".hub-card").first().waitFor();

    // Tab through the document until focus lands on a hub card (keyboard reach).
    let onCard = false;
    for (let i = 0; i < 10 && !onCard; i++) {
      await page.keyboard.press("Tab");
      onCard = await page.evaluate(() =>
        document.activeElement?.classList.contains("hub-card") ?? false,
      );
    }
    expect(onCard, "Tab focus should reach a hub card").toBe(true);

    // A visible focus indicator (:focus-visible outline) is present for the
    // keyboard-focused card.
    const outline = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return null;
      const s = getComputedStyle(el);
      return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) || 0 };
    });
    expect(outline).not.toBeNull();
    expect(outline!.style).not.toBe("none");
    expect(outline!.width).toBeGreaterThan(0);
  });

  test("keyboard can start a game via the lifecycle controls (Req 9.2)", async ({ page }) => {
    await page.goto("/");
    await page.locator(".hub-card").first().waitFor();

    // Keyboard-activate the first hub card to load a game.
    await page.locator(".hub-card").first().focus();
    await page.keyboard.press("Enter");
    await page.locator('[data-control="start"]').waitFor({ state: "visible" });

    // Tab to the Start control and activate it with the keyboard, then confirm
    // the lifecycle advanced (Pause becomes available while running).
    let onStart = false;
    for (let i = 0; i < 12 && !onStart; i++) {
      await page.keyboard.press("Tab");
      onStart = await page.evaluate(
        () => document.activeElement?.getAttribute("data-control") === "start",
      );
    }
    expect(onStart, "Tab focus should reach the Start control").toBe(true);

    await page.keyboard.press("Enter");
    await expect(page.locator('[data-control="pause"]')).toBeVisible();
  });
});
