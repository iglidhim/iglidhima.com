// Unit tests for the pure theme helpers (resolveInitialTheme, toggleTheme).
//
// These are pure functions with no DOM/localStorage dependency, so they run in
// the fast `node` environment (see vite.config.ts).
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { resolveInitialTheme, toggleTheme, type Theme } from "./theme";

describe("resolveInitialTheme", () => {
  it("returns the stored theme when it is a valid 'dark'", () => {
    expect(resolveInitialTheme("dark", false)).toBe("dark");
    expect(resolveInitialTheme("dark", true)).toBe("dark");
  });

  it("returns the stored theme when it is a valid 'light'", () => {
    expect(resolveInitialTheme("light", true)).toBe("light");
    expect(resolveInitialTheme("light", false)).toBe("light");
  });

  it("stored valid theme overrides the system preference", () => {
    // prefersDark is true but the user explicitly chose light -> light wins.
    expect(resolveInitialTheme("light", true)).toBe("light");
    // prefersDark is false but the user explicitly chose dark -> dark wins.
    expect(resolveInitialTheme("dark", false)).toBe("dark");
  });

  it("falls back to system preference when stored is null", () => {
    expect(resolveInitialTheme(null, true)).toBe("dark");
    expect(resolveInitialTheme(null, false)).toBe("light");
  });

  it("falls back to system preference when stored is invalid", () => {
    expect(resolveInitialTheme("purple", true)).toBe("dark");
    expect(resolveInitialTheme("", false)).toBe("light");
    expect(resolveInitialTheme("DARK", false)).toBe("light"); // case-sensitive
  });

  it("uses dark when prefersDark and light otherwise for any non-theme input", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant<string | null>(null), fc.string()),
        fc.boolean(),
        (stored, prefersDark) => {
          const result = resolveInitialTheme(stored, prefersDark);
          if (stored === "light" || stored === "dark") {
            expect(result).toBe(stored);
          } else {
            expect(result).toBe(prefersDark ? "dark" : "light");
          }
        },
      ),
    );
  });
});

describe("toggleTheme", () => {
  it("flips dark to light and light to dark", () => {
    expect(toggleTheme("dark")).toBe("light");
    expect(toggleTheme("light")).toBe("dark");
  });

  it("is its own inverse (toggling twice returns the original)", () => {
    fc.assert(
      fc.property(fc.constantFrom<Theme>("light", "dark"), (theme) => {
        expect(toggleTheme(toggleTheme(theme))).toBe(theme);
      }),
    );
  });
});
