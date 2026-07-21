// e2e/no-backend.spec.ts
// No-backend / no-personal-data integration checks (Requirements 7.1, 7.2, 7.3).
//
// Confirms the Site behaves as a purely static, client-only arcade:
//   * no XHR/fetch requests to any backend/game/score endpoint during hub load
//     or gameplay (Req 7.1) — the only network traffic is static asset fetches
//     from the site's own origin;
//   * game data is written only to localStorage, and exclusively under the
//     per-game High_Score key prefix `iglidhima.arcade.highscore.*` (Req 7.2);
//   * there is no account / login / authentication UI (Req 7.3).
//
// A localStorage.setItem probe is installed via an init script before the app
// boots, so every key the app writes is recorded regardless of when it happens
// (including the commit on game-over).

import { test, expect, type Page, type Request } from "@playwright/test";

/** The per-game High_Score key prefix used by src/scores/scoreStore.ts. */
const HIGH_SCORE_PREFIX = "iglidhima.arcade.highscore.";

/** Install a localStorage.setItem recorder before any app code runs. */
async function installStorageProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __setItemKeys: string[] };
    w.__setItemKeys = [];
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (this: Storage, key: string, value: string): void {
      try {
        w.__setItemKeys.push(key);
      } catch {
        /* recording must never break the app */
      }
      return original.call(this, key, value);
    };
  });
}

test.describe("no backend, no personal data", () => {
  test("no XHR/fetch to a backend during hub load and gameplay (Req 7.1)", async ({ page }) => {
    const dataRequests: string[] = [];
    page.on("request", (req: Request) => {
      const type = req.resourceType();
      if (type === "xhr" || type === "fetch") {
        dataRequests.push(`${type} ${req.url()}`);
      }
    });

    await page.goto("/");
    await page.locator(".hub-card").first().waitFor();

    // Play a full session through to game-over to exercise the score-commit path.
    // Serpent starts heading into a wall, so it reaches game-over on its own.
    await page.locator('.hub-card[data-game-id="serpent"]').click();
    await page.locator('[data-control="start"]').click();
    // The play-again control appearing marks the Game_Over_State.
    await page
      .locator('[data-control="playAgain"]')
      .waitFor({ state: "visible", timeout: 15_000 });

    // A static, client-only site issues no data-plane requests for logic/scores.
    expect(dataRequests, dataRequests.join("\n")).toEqual([]);
  });

  test("data is written only to localStorage under the arcade prefix (Req 7.2)", async ({
    page,
  }) => {
    await installStorageProbe(page);

    await page.goto("/");
    await page.locator('.hub-card[data-game-id="serpent"]').click();
    await page.locator('[data-control="start"]').click();
    await page
      .locator('[data-control="playAgain"]')
      .waitFor({ state: "visible", timeout: 15_000 });

    // Every key the app wrote (if any) uses the per-game High_Score prefix.
    const writtenKeys: string[] = await page.evaluate(
      () => (window as unknown as { __setItemKeys: string[] }).__setItemKeys,
    );
    for (const key of writtenKeys) {
      expect(key.startsWith(HIGH_SCORE_PREFIX), `unexpected write key: ${key}`).toBe(true);
    }

    // The persisted store contains only arcade High_Score entries — no other data.
    const storageKeys: string[] = await page.evaluate(() => Object.keys(localStorage));
    for (const key of storageKeys) {
      expect(key.startsWith(HIGH_SCORE_PREFIX), `unexpected stored key: ${key}`).toBe(true);
    }
  });

  test("there is no login/authentication UI (Req 7.3)", async ({ page }) => {
    await page.goto("/");
    await page.locator(".hub-card").first().waitFor();

    // No password fields anywhere on the page.
    await expect(page.locator('input[type="password"]')).toHaveCount(0);

    // No visible login / sign-in / sign-up / account affordances.
    const authText = page.getByText(/\b(log ?in|sign ?in|sign ?up|register|account)\b/i);
    await expect(authText).toHaveCount(0);
  });
});
