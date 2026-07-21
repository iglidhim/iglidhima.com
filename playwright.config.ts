import { defineConfig, devices } from "@playwright/test";

// Playwright drives the responsive, accessibility (axe-core), timing, and
// no-backend integration checks that do not vary with input in a way property
// generation would exercise (see the design's Testing Strategy). These specs
// live under `e2e/` and run against a locally served production preview build.
//
// Unit and property tests run under Vitest instead; Vitest is configured to
// ignore `e2e/` so the two runners never collide.
const PORT = 4173;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  // Build once, then serve the static production bundle for the specs.
  webServer: {
    command: "npm run build && npm run preview -- --port " + PORT + " --strictPort",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 5"] },
    },
  ],
});
