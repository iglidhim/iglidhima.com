// src/lib/theme.ts
// Light/dark theme logic for the arcade hub.
//
// Split into PURE helpers (`resolveInitialTheme`, `toggleTheme`) that contain
// no DOM or `localStorage` access and are directly unit-testable, plus thin
// side-effecting adapters (`getStoredTheme`, `storeTheme`, `applyTheme`,
// `initTheme`) layered on top. Storage access is wrapped in try/catch so a
// disabled/unavailable `localStorage` never throws — the theme simply falls
// back to the system preference (matching the fail-safe style of scoreStore).
//
// The resolved theme is applied by setting `document.documentElement.dataset.theme`
// (i.e. `<html data-theme="light|dark">`), which drives the palette defined in
// src/styles/global.css. The DARK palette is the default under `:root`, so if
// JS never runs the Site still renders correctly in dark.

/** The two supported themes. */
export type Theme = "light" | "dark";

/** The Local_Store key under which the chosen theme is persisted. */
export const THEME_KEY = "iglidhima.arcade.theme";

/** Type guard: is `value` one of the valid theme strings? */
function isTheme(value: string | null): value is Theme {
  return value === "light" || value === "dark";
}

/**
 * Resolve the theme to apply on first load (PURE).
 *
 * - If `stored` is a valid persisted theme ("light"/"dark"), it wins — an
 *   explicit user choice always overrides the system preference.
 * - Otherwise fall back to the system preference: "dark" when `prefersDark`
 *   is true, else "light".
 *
 * The system preference is the default, with dark as the ultimate fallback
 * when nothing else is known.
 */
export function resolveInitialTheme(stored: string | null, prefersDark: boolean): Theme {
  if (isTheme(stored)) {
    return stored;
  }
  return prefersDark ? "dark" : "light";
}

/** The opposite theme (PURE). */
export function toggleTheme(current: Theme): Theme {
  return current === "dark" ? "light" : "dark";
}

/**
 * Read the persisted theme from `localStorage`, or `null` when absent/invalid
 * or when storage is unavailable. Never throws.
 */
export function getStoredTheme(): Theme | null {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    return isTheme(raw) ? raw : null;
  } catch {
    // Storage disabled/unavailable: behave as if nothing was stored.
    return null;
  }
}

/**
 * Persist the chosen theme to `localStorage`. Silently skipped if storage is
 * unavailable (disabled storage, private-mode quota errors); never throws.
 */
export function storeTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage unavailable/quota exceeded: skip the write, continue.
  }
}

/**
 * Apply a theme to the document by setting `<html data-theme="…">`, which the
 * stylesheet keys its palette off. Safe to call repeatedly.
 */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

/**
 * Resolve the initial theme from persisted storage + the system preference and
 * apply it to the document. Returns the resolved theme so callers can seed UI
 * (e.g. the theme toggle) with the current value. Called once during bootstrap.
 */
export function initTheme(): Theme {
  const stored = getStoredTheme();
  const prefersDark =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;

  const theme = resolveInitialTheme(stored, prefersDark);
  applyTheme(theme);
  return theme;
}
