// e2e/family.responsive.spec.ts
// Family Corner responsive-usability checks (Requirement 10.1).
//
// The Family_Corner create-and-send experience must render as usable across the
// full viewport range 320px–1920px with NO horizontal overflow (Requirement
// 10.1). These run against the served production preview build (see
// playwright.config.ts). Viewport widths are set explicitly inside the test so
// the width-dependent assertions are deterministic regardless of which project
// (desktop-chromium / mobile-chromium) drives them.
//
// Selectors mirror the Family Corner chrome:
//   .hub__family-corner  — the Hub entry that opens Family_Corner (ui/hub.ts)
//   .family-corner       — the create-and-send view root (ui/familyCorner.ts)
//   .doodle__canvas      — the drawing canvas (ui/doodleBoard.ts)
//   .doodle__color       — a palette color swatch
//   .sender-selector__option — a sender toggle (Kian / Eloise)
//   .family-corner__send — the "Send to Dad" button

import { test, expect, type Page } from "@playwright/test";

/**
 * A representative set of viewport widths spanning the required 320–1920px
 * range: the 320px floor, common phone/tablet/laptop widths, and the 1920px
 * ceiling (Requirement 10.1).
 */
const WIDTHS = [320, 375, 768, 1024, 1440, 1920] as const;

/** Open Family_Corner from the Hub and wait for its view to mount. */
async function openFamilyCorner(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator(".hub__family-corner").click();
  await page.locator(".family-corner").waitFor({ state: "visible" });
  await page.locator(".doodle__canvas").waitFor({ state: "visible" });
}

test.describe("Family Corner responsive usability (Req 10.1)", () => {
  for (const width of WIDTHS) {
    test(`usable with no horizontal overflow at ${width}px (Req 10.1)`, async ({ page }) => {
      // A tall viewport so the whole experience is laid out; width is what the
      // requirement constrains.
      await page.setViewportSize({ width, height: 900 });
      await openFamilyCorner(page);

      // No horizontal scrolling: the document is no wider than the viewport.
      const { scrollWidth, innerWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      // Allow a 1px rounding slack; the layout must not overflow horizontally.
      expect(
        scrollWidth,
        `document (${scrollWidth}px) must not exceed viewport (${innerWidth}px) at ${width}px`,
      ).toBeLessThanOrEqual(innerWidth + 1);

      // The Family Corner root itself stays within the viewport bounds.
      const rootBox = await page.locator(".family-corner").boundingBox();
      expect(rootBox).not.toBeNull();
      if (rootBox) {
        expect(rootBox.x).toBeGreaterThanOrEqual(-1);
        expect(rootBox.x + rootBox.width).toBeLessThanOrEqual(innerWidth + 1);
      }

      // Key controls remain visible and usable at every width.
      await expect(page.locator(".doodle__canvas")).toBeVisible();
      await expect(page.locator(".doodle__color").first()).toBeVisible();
      await expect(page.locator(".sender-selector__option").first()).toBeVisible();
      await expect(page.locator(".family-corner__send")).toBeVisible();
    });
  }
});
