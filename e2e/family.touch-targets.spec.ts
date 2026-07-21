// e2e/family.touch-targets.spec.ts
// Family Corner touch-target checks (Requirement 10.2).
//
// Every interactive control in the Family_Corner create-and-send experience
// must present a touch target of at least 44 by 44 CSS pixels (Requirement
// 10.2). These run against the served production preview build (see
// playwright.config.ts) and measure each control's rendered box via
// boundingBox().
//
// Controls covered (ui/doodleBoard.ts, ui/senderSelector.ts, ui/noteComposer.ts,
// ui/familyCorner.ts):
//   .doodle__color            — color swatches
//   .doodle__brush            — brush sizes
//   .doodle__action           — undo / clear
//   .sender-selector__option  — sender toggles (Kian / Eloise)
//   .family-corner__send      — the "Send to Dad" button
//   .family-corner__back      — Back-to-Hub control
//   .note-composer__input     — the note composer textarea

import { test, expect, type Page } from "@playwright/test";

/** The WCAG 44x44 CSS-px minimum touch target (Requirement 10.2). */
const MIN_TARGET = 44;
/** Sub-pixel rounding slack so an exact-44px box is never flakily rejected. */
const SLACK = 0.5;

/**
 * Selectors for the interactive controls that must meet the 44x44 minimum,
 * paired with a friendly label used in assertion messages.
 */
const CONTROL_SELECTORS: ReadonlyArray<{ selector: string; label: string }> = [
  { selector: ".doodle__color", label: "color swatch" },
  { selector: ".doodle__brush", label: "brush size" },
  { selector: ".doodle__action", label: "undo/clear action" },
  { selector: ".sender-selector__option", label: "sender option" },
  { selector: ".family-corner__send", label: "send button" },
  { selector: ".family-corner__back", label: "back-to-hub button" },
  { selector: ".note-composer__input", label: "note composer textarea" },
];

/** Open Family_Corner from the Hub and wait for its controls to mount. */
async function openFamilyCorner(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator(".hub__family-corner").click();
  await page.locator(".family-corner").waitFor({ state: "visible" });
  await page.locator(".family-corner__send").waitFor({ state: "visible" });
}

test.describe("Family Corner touch targets (Req 10.2)", () => {
  test("every interactive control measures at least 44x44 CSS px", async ({ page }) => {
    await openFamilyCorner(page);

    for (const { selector, label } of CONTROL_SELECTORS) {
      const controls = page.locator(selector);
      const count = await controls.count();
      // Each control class must actually be present in the experience.
      expect(count, `expected at least one "${label}" (${selector})`).toBeGreaterThan(0);

      for (let i = 0; i < count; i += 1) {
        const control = controls.nth(i);
        await expect(control).toBeVisible();

        const box = await control.boundingBox();
        expect(box, `${label} #${i} (${selector}) should have a bounding box`).not.toBeNull();
        if (!box) continue;

        expect(
          box.width + SLACK,
          `${label} #${i} width (${box.width}px) must be >= ${MIN_TARGET}px`,
        ).toBeGreaterThanOrEqual(MIN_TARGET);
        expect(
          box.height + SLACK,
          `${label} #${i} height (${box.height}px) must be >= ${MIN_TARGET}px`,
        ).toBeGreaterThanOrEqual(MIN_TARGET);
      }
    }
  });
});
