// Render tests for the Touch_Controls overlay chrome component (task 9.3).
//
// Lives under src/ui/** so it runs in the jsdom environment (see vite.config.ts).
// _Requirements: 3.2, 8.4, 9.5_
import { describe, it, expect, beforeEach } from "vitest";
import { createTouchControls } from "./touchControls";
import type { TouchControlSpec } from "../engine/types";

const SPECS: readonly TouchControlSpec[] = [
  { action: "left", label: "Move Left", position: "left" },
  { action: "right", label: "Move Right", position: "right" },
  { action: "rotate", label: "Rotate", position: "primary" },
];

describe("createTouchControls", () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  it("renders a button per control only when touch is reported (Req 3.2)", () => {
    const tc = createTouchControls(SPECS, { touchCapable: true });
    tc.mount(host);

    expect(tc.enabled).toBe(true);
    const buttons = host.querySelectorAll(".touch-controls__btn");
    expect(buttons).toHaveLength(SPECS.length);
    // The overlay is flagged so the CSS reveals it alongside the Play_Area (Req 8.4).
    expect(host.querySelector(".touch-controls")?.getAttribute("data-touch")).toBe("true");
  });

  it("renders no buttons when the device is not touch-capable (Req 3.2)", () => {
    const tc = createTouchControls(SPECS, { touchCapable: false });
    tc.mount(host);

    expect(tc.enabled).toBe(false);
    expect(host.querySelectorAll(".touch-controls__btn")).toHaveLength(0);
    // Without the flag, the shared CSS keeps the overlay hidden.
    expect(host.querySelector(".touch-controls")?.hasAttribute("data-touch")).toBe(false);
  });

  it("gives each button the right data-action and aria-label (Req 3.2, 9.5)", () => {
    const tc = createTouchControls(SPECS, { touchCapable: true });
    tc.mount(host);

    for (const spec of SPECS) {
      const button = host.querySelector<HTMLButtonElement>(
        `.touch-controls__btn[data-action="${spec.action}"]`,
      );
      expect(button).not.toBeNull();
      // The InputManager reads data-action via pointerdown delegation (Req 3.2).
      expect(button?.dataset.action).toBe(spec.action);
      // Accessible label from the spec (Req 9.5).
      expect(button?.getAttribute("aria-label")).toBe(spec.label);
      // Buttons are native <button>s so they are keyboard-operable.
      expect(button?.tagName).toBe("BUTTON");
      expect(button?.type).toBe("button");
    }
  });

  it("positions each button per its spec position", () => {
    const tc = createTouchControls(SPECS, { touchCapable: true });
    tc.mount(host);

    for (const spec of SPECS) {
      const button = host.querySelector<HTMLButtonElement>(
        `.touch-controls__btn[data-action="${spec.action}"]`,
      );
      expect(button?.dataset.position).toBe(spec.position);
      expect(button?.classList.contains(`touch-controls__btn--${spec.position}`)).toBe(true);
    }
  });

  it("removes the overlay from the DOM on destroy", () => {
    const tc = createTouchControls(SPECS, { touchCapable: true });
    tc.mount(host);
    expect(host.querySelector(".touch-controls")).not.toBeNull();

    tc.destroy();
    expect(host.querySelector(".touch-controls")).toBeNull();
  });
});
