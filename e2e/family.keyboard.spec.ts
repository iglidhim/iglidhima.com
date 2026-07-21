// e2e/family.keyboard.spec.ts
// Family Corner keyboard operability checks (Requirement 10.5).
//
// When a Child_User operates the create-and-send interface with a keyboard, the
// color, brush, clear, undo, sender, and send controls must all be reachable
// (Tab) and activatable (Enter/Space) with keyboard input (Requirement 10.5).
// These run against the served production preview build (see
// playwright.config.ts).
//
// The test has two parts:
//   1. Reachability — Tab through the document and confirm focus lands on each
//      of the six required control categories.
//   2. Activation — with a control focused, press Enter/Space and confirm the
//      control responds (aria-pressed toggles for the tool/sender toggles; the
//      empty-submission prompt appears for the send button; undo/clear activate
//      as native buttons without navigating away).
//
// Selectors (ui/doodleBoard.ts, ui/senderSelector.ts, ui/familyCorner.ts):
//   .doodle__color            — color swatches
//   .doodle__brush            — brush sizes
//   .doodle__action           — undo / clear (distinguished by aria-label)
//   .sender-selector__option  — sender toggles (Kian / Eloise)
//   .family-corner__send      — the "Send to Dad" button

import { test, expect, type Page } from "@playwright/test";

/** Open Family_Corner from the Hub and wait for its controls to mount. */
async function openFamilyCorner(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator(".hub__family-corner").click();
  await page.locator(".family-corner").waitFor({ state: "visible" });
  await page.locator(".family-corner__send").waitFor({ state: "visible" });
}

/** The category of the currently focused element, or `null` if uncategorised. */
async function focusedCategory(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return null;
    const label = el.getAttribute("aria-label") ?? "";
    if (el.classList.contains("doodle__color")) return "color";
    if (el.classList.contains("doodle__brush")) return "brush";
    if (el.classList.contains("doodle__action")) {
      if (/undo/i.test(label)) return "undo";
      if (/clear/i.test(label)) return "clear";
      return "action";
    }
    if (el.classList.contains("sender-selector__option")) return "sender";
    if (el.classList.contains("family-corner__send")) return "send";
    return null;
  });
}

test.describe("Family Corner keyboard operability (Req 10.5)", () => {
  test("color, brush, clear, undo, sender, and send are reachable by Tab", async ({ page }) => {
    await openFamilyCorner(page);
    // Start from a known place: focus the document body so Tab order is stable.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    const required = new Set(["color", "brush", "clear", "undo", "sender", "send"]);
    const reached = new Set<string>();

    // Tab through the whole view; the six required categories must all appear.
    for (let i = 0; i < 60 && reached.size < required.size; i += 1) {
      await page.keyboard.press("Tab");
      const category = await focusedCategory(page);
      if (category !== null && required.has(category)) {
        reached.add(category);
      }
    }

    for (const category of required) {
      expect(reached.has(category), `Tab focus should reach the ${category} control`).toBe(true);
    }
  });

  test("tool and sender toggles activate with Enter/Space", async ({ page }) => {
    await openFamilyCorner(page);

    // A color swatch that is not the default selection (Black is default).
    const redSwatch = page.locator(".doodle__color").nth(1);
    await expect(redSwatch).toHaveAttribute("aria-pressed", "false");
    await redSwatch.focus();
    await page.keyboard.press("Enter");
    await expect(redSwatch).toHaveAttribute("aria-pressed", "true");

    // A brush that is not the default selection (Medium is default).
    const smallBrush = page.locator(".doodle__brush").nth(0);
    await expect(smallBrush).toHaveAttribute("aria-pressed", "false");
    await smallBrush.focus();
    await page.keyboard.press("Space");
    await expect(smallBrush).toHaveAttribute("aria-pressed", "true");

    // A sender toggle records the pick when activated by keyboard.
    const sender = page.locator(".sender-selector__option").first();
    await expect(sender).toHaveAttribute("aria-pressed", "false");
    await sender.focus();
    await page.keyboard.press("Enter");
    await expect(sender).toHaveAttribute("aria-pressed", "true");
  });

  test("undo and clear activate as keyboard buttons without navigating away", async ({ page }) => {
    await openFamilyCorner(page);

    for (const label of ["Undo last stroke", "Clear the whole drawing"]) {
      const action = page.locator(`.doodle__action[aria-label="${label}"]`);
      await expect(action).toBeVisible();
      // Native <button>: Enter/Space activate it per HTML semantics.
      const tag = await action.evaluate((el) => el.tagName);
      expect(tag).toBe("BUTTON");
      await action.focus();
      await page.keyboard.press("Enter");
      // Activation must not tear down or navigate away from the view.
      await expect(page.locator(".family-corner")).toBeVisible();
    }
  });

  test("send is activatable by keyboard and blocks an empty submission", async ({ page }) => {
    await openFamilyCorner(page);

    const send = page.locator(".family-corner__send");
    await send.focus();
    // Enter activates the focused Send button; with nothing drawn/typed and no
    // sender picked, the view surfaces its inline prompt instead of submitting.
    await page.keyboard.press("Enter");

    const prompt = page.locator(".family-corner__prompt");
    await expect(prompt).toBeVisible();
    await expect(prompt).not.toBeEmpty();
  });
});
