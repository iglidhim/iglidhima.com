/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";

// Static build config for the arcade hub.
// `vite build` emits a static `dist/` bundle that Cloudflare Pages serves
// directly with no server-side runtime (Requirements 7.1, 11.4).
export default defineConfig({
  build: {
    outDir: "dist",
    target: "es2020",
    sourcemap: false,
  },
  test: {
    // Pure logic (game rules, scoring, state machines, canvas-fit math) runs
    // under the fast `node` environment by default. DOM/render tests for the
    // UI chrome opt into `jsdom` via the glob below, so they get a document,
    // window, and localStorage without slowing the pure-logic suite.
    environment: "node",
    environmentMatchGlobs: [
      ["src/ui/**", "jsdom"],
      ["test/**/*.dom.{test,spec}.ts", "jsdom"],
      ["**/*.dom.{test,spec}.ts", "jsdom"],
    ],
    // Load the shared fast-check config (numRuns >= 100) before every test file.
    setupFiles: ["test/setup.fast-check.ts"],
    include: ["test/**/*.{test,spec}.ts", "src/**/*.{test,spec}.ts"],
    // Playwright integration/accessibility/timing specs run under their own
    // runner (playwright.config.ts), not Vitest.
    exclude: ["node_modules/**", "dist/**", "e2e/**"],
  },
});
