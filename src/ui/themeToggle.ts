// src/ui/themeToggle.ts
// Theme toggle chrome component — an icon button that flips the Site between
// the light and dark palettes and persists the choice.
//
// This is a framework-free vanilla-TS factory matching the style of the other
// ui/ components (scoreboard, controls, …): it builds its own DOM using the
// `.theme-toggle` CSS class (defined in src/styles/global.css) and exposes a
// small { element, mount, destroy } handle.
//
// The current theme is read from `document.documentElement.dataset.theme`, set
// by initTheme() during bootstrap (and by the no-flash inline script before
// first paint). On click the component toggles the theme, applies it to the
// document, persists it, and refreshes its icon + accessible labelling.
//
// Accessibility:
//   - `aria-label` describes the action/target ("Switch to light mode" /
//     "Switch to dark mode") and updates on toggle.
//   - `aria-pressed` reflects whether dark mode is currently active.
//   - The inline SVG is decorative (aria-hidden), so the label is the sole
//     accessible name; the button gets the global :focus-visible ring.

import { applyTheme, storeTheme, toggleTheme, type Theme } from "../lib/theme";

/** A mounted theme toggle. Returned by {@link createThemeToggle}. */
export interface ThemeToggle {
  /** The toggle button element (also exposed for testing/positioning). */
  readonly element: HTMLButtonElement;
  /** Attach the toggle to a parent node. */
  mount(parent: HTMLElement): void;
  /** Remove the toggle from the DOM and detach its listener. */
  destroy(): void;
}

/**
 * Sun icon — shown when the dark theme is active, indicating that clicking will
 * switch to light mode. Decorative (aria-hidden); the button's label names the
 * action.
 */
const SUN_ICON = `
  <svg class="theme-toggle__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"
       fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.5v2.5M12 19v2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M2.5 12H5M19 12h2.5M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8" />
  </svg>`;

/**
 * Moon icon — shown when the light theme is active, indicating that clicking
 * will switch to dark mode. Decorative (aria-hidden).
 */
const MOON_ICON = `
  <svg class="theme-toggle__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"
       fill="currentColor" stroke="none">
    <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4 8.4 8.4 0 1 0 20 14.2z" />
  </svg>`;

/** Read the current theme from the document, defaulting to dark. */
function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/**
 * Create a ThemeToggle component. The button reflects the current theme (read
 * from the document) on mount; clicking it flips, applies, and persists the
 * theme, then updates the icon and accessible labelling.
 */
export function createThemeToggle(): ThemeToggle {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "theme-toggle";

  /**
   * Sync the button's icon and ARIA state to a given theme. When dark is
   * active we show the sun (click -> light) and label the light-switch action;
   * when light is active we show the moon (click -> dark).
   */
  function render(theme: Theme): void {
    const isDark = theme === "dark";
    button.innerHTML = isDark ? SUN_ICON : MOON_ICON;
    button.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
    // aria-pressed reflects whether dark mode is currently engaged.
    button.setAttribute("aria-pressed", String(isDark));
  }

  function handleClick(): void {
    const next = toggleTheme(currentTheme());
    applyTheme(next);
    storeTheme(next);
    render(next);
  }

  button.addEventListener("click", handleClick);

  // Seed from the theme already applied to the document (by initTheme / the
  // no-flash inline script).
  render(currentTheme());

  return {
    element: button,

    mount(parent: HTMLElement): void {
      parent.appendChild(button);
    },

    destroy(): void {
      button.removeEventListener("click", handleClick);
      button.remove();
    },
  };
}
