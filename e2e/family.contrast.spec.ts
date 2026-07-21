// e2e/family.contrast.spec.ts
// Family Corner contrast audit (Requirement 10.4).
//
// Text and interactive controls in the Family_Corner create-and-send experience
// must render with a contrast ratio of at least 4.5:1 against their background
// in BOTH the light and dark themes (Requirement 10.4). This uses
// @axe-core/playwright (as e2e/accessibility.spec.ts does) to run the WCAG AA
// color-contrast audit — the AA color-contrast rule enforces the >= 4.5:1
// threshold for normal text — scoped to the Family Corner view, once per theme.
//
// The theme is applied exactly the way the app applies it: by setting
// `<html data-theme="light|dark">` (see src/lib/theme.ts applyTheme), which
// drives the palette tokens in src/styles/global.css. We set it directly so the
// audit is deterministic regardless of the persisted/system preference.

import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/** The two themes that must both satisfy the >= 4.5:1 contrast requirement. */
const THEMES = ["light", "dark"] as const;

/** Open Family_Corner from the Hub and wait for its view to mount. */
async function openFamilyCorner(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator(".hub__family-corner").click();
  await page.locator(".family-corner").waitFor({ state: "visible" });
  await page.locator(".family-corner__send").waitFor({ state: "visible" });
}

/** Apply a theme the same way the app does: `<html data-theme="…">`. */
async function applyTheme(page: Page, theme: (typeof THEMES)[number]): Promise<void> {
  await page.evaluate((t) => {
    document.documentElement.dataset.theme = t;
  }, theme);
}

test.describe("Family Corner contrast audit (Req 10.4)", () => {
  for (const theme of THEMES) {
    test(`no color-contrast violations in ${theme} theme (Req 10.4)`, async ({ page }) => {
      await openFamilyCorner(page);
      await applyTheme(page, theme);

      const results = await new AxeBuilder({ page })
        .include(".family-corner")
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();

      // Require >= 4.5:1 across the Family Corner view: zero contrast failures.
      const contrast = results.violations.filter((v) => v.id === "color-contrast");
      expect(
        contrast,
        JSON.stringify(
          contrast.map((v) => v.nodes.map((n) => n.html)),
          null,
          2,
        ),
      ).toEqual([]);
    });
  }
});
