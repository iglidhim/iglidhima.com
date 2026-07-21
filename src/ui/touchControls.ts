// src/ui/touchControls.ts
// Touch_Controls overlay chrome component (Requirements 3.2, 8.4, 9.5).
//
// Renders the Active_Game's on-screen controls as native <button>s, but ONLY
// when the device reports touch capability (Requirement 3.2). On non-touch
// devices the overlay renders nothing, so a keyboard/mouse Visitor never sees
// unused controls.
//
// Each control carries a `data-action` attribute naming the game action it
// issues, so the existing InputManager (src/engine/input.ts) picks it up via
// its delegated `pointerdown` listener on the container — no direct coupling
// between this component and the runner is required. Each control also exposes
// an accessible label via `aria-label` taken from the spec's `label`
// (Requirement 9.5).
//
// The overlay uses the shared `.touch-controls` / `.touch-controls__btn`
// classes defined in src/styles/global.css, and sets `data-touch="true"` on the
// root when enabled so the CSS reveals it within the initial viewport alongside
// the Play_Area at mobile width (Requirement 8.4). Like the other chrome
// components, this is a framework-free vanilla-TS factory with rendering kept
// separate from game logic.

import type { TouchControlSpec } from "../engine/types";
import { detectTouchCapable } from "../engine/input";

/**
 * A mounted Touch_Controls overlay. Returned by {@link createTouchControls}.
 * The Play_Area mounts it alongside the canvas and tears it down with
 * `destroy()` when the game is stopped or the Visitor returns to the Hub.
 */
export interface TouchControls {
  /** The overlay root element (also exposed for testing/positioning). */
  readonly element: HTMLElement;
  /**
   * Whether the overlay is enabled (the device reports touch capability). When
   * false, no control buttons are rendered.
   */
  readonly enabled: boolean;
  /** Attach the overlay to a parent node. */
  mount(parent: HTMLElement): void;
  /** Remove the overlay from the DOM and release its references. */
  destroy(): void;
}

/** The order buttons appear in the overlay, keyed by control position. */
const POSITION_ORDER: Record<TouchControlSpec["position"], number> = {
  left: 0,
  up: 1,
  down: 2,
  right: 3,
  primary: 4,
};

export interface CreateTouchControlsOptions {
  /**
   * Override touch-capability detection. When omitted, capability is detected
   * via {@link detectTouchCapable}. Primarily used by tests to force the
   * enabled/disabled branches deterministically.
   */
  touchCapable?: boolean;
}

/**
 * Create a Touch_Controls overlay for the given control specs.
 *
 * When the device reports touch capability, one `<button>` is rendered per
 * spec — positioned by its `position`, carrying its `data-action` and an
 * `aria-label` from `spec.label` — and the root is flagged `data-touch="true"`
 * so the CSS shows it (Requirements 3.2, 8.4, 9.5). When touch is not reported,
 * the root stays empty and hidden.
 */
export function createTouchControls(
  controls: readonly TouchControlSpec[],
  options: CreateTouchControlsOptions = {},
): TouchControls {
  const enabled = options.touchCapable ?? detectTouchCapable();

  const root = document.createElement("div");
  root.className = "touch-controls";
  // Group the on-screen controls for assistive technology (Requirement 9.5).
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Touch controls");

  if (enabled) {
    // The CSS reveals the overlay only when this flag is present, keeping it
    // within the initial viewport alongside the Play_Area on mobile (Req 8.4).
    root.setAttribute("data-touch", "true");

    // Render in a stable directional order regardless of spec ordering.
    const ordered = [...controls].sort(
      (a, b) => POSITION_ORDER[a.position] - POSITION_ORDER[b.position],
    );

    for (const spec of ordered) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "touch-controls__btn";
      button.classList.add(`touch-controls__btn--${spec.position}`);
      // The InputManager reads this attribute via pointerdown delegation (Req 3.2).
      button.dataset.action = spec.action;
      button.dataset.position = spec.position;
      // Accessible name for the control (Requirement 9.5).
      button.setAttribute("aria-label", spec.label);
      // Visible glyph: reuse the label so sighted touch users see it too.
      button.textContent = spec.label;
      root.appendChild(button);
    }
  }

  return {
    element: root,
    enabled,

    mount(parent: HTMLElement): void {
      parent.appendChild(root);
    },

    destroy(): void {
      root.remove();
    },
  };
}
