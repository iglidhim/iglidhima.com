// Render/behaviour tests for the ThemeToggle chrome component.
//
// Lives under src/ui/** so it runs in the jsdom environment (see vite.config.ts),
// giving it a document, window, and localStorage.
import { describe, it, expect, beforeEach } from "vitest";
import { createThemeToggle } from "./themeToggle";
import { THEME_KEY } from "../lib/theme";

describe("createThemeToggle", () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    try {
      localStorage.clear();
    } catch {
      // ignore
    }
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  it("renders a native button using the .theme-toggle class", () => {
    document.documentElement.dataset.theme = "dark";
    const toggle = createThemeToggle();
    toggle.mount(host);

    const button = host.querySelector(".theme-toggle");
    expect(button).not.toBeNull();
    expect(button?.tagName).toBe("BUTTON");
  });

  it("reflects the current dark theme on mount (sun icon, aria-pressed=true)", () => {
    document.documentElement.dataset.theme = "dark";
    const toggle = createThemeToggle();
    toggle.mount(host);

    expect(toggle.element.getAttribute("aria-label")).toBe("Switch to light mode");
    expect(toggle.element.getAttribute("aria-pressed")).toBe("true");
    // Decorative SVG present and hidden from assistive tech.
    const svg = toggle.element.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });

  it("reflects the current light theme on mount (aria-pressed=false)", () => {
    document.documentElement.dataset.theme = "light";
    const toggle = createThemeToggle();
    toggle.mount(host);

    expect(toggle.element.getAttribute("aria-label")).toBe("Switch to dark mode");
    expect(toggle.element.getAttribute("aria-pressed")).toBe("false");
  });

  it("flips the document theme, persists it, and updates ARIA on click", () => {
    document.documentElement.dataset.theme = "dark";
    const toggle = createThemeToggle();
    toggle.mount(host);

    // dark -> light
    toggle.element.click();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem(THEME_KEY)).toBe("light");
    expect(toggle.element.getAttribute("aria-label")).toBe("Switch to dark mode");
    expect(toggle.element.getAttribute("aria-pressed")).toBe("false");

    // light -> dark
    toggle.element.click();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    expect(toggle.element.getAttribute("aria-label")).toBe("Switch to light mode");
    expect(toggle.element.getAttribute("aria-pressed")).toBe("true");
  });

  it("detaches its listener and removes itself on destroy", () => {
    document.documentElement.dataset.theme = "dark";
    const toggle = createThemeToggle();
    toggle.mount(host);
    expect(host.querySelector(".theme-toggle")).not.toBeNull();

    toggle.destroy();
    expect(host.querySelector(".theme-toggle")).toBeNull();

    // Clicking the detached button must not change the document theme.
    toggle.element.click();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
