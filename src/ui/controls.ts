// src/ui/controls.ts
// LifecycleControls chrome component (Requirements 1.4, 2.1, 5.3, 9.2, 9.5).
//
// Renders the shared lifecycle controls — Start, Pause, Resume, Restart,
// Play-Again, and Back-to-Hub — as native, keyboard-operable <button>s, and
// shows/hides them according to the Active_Game's `GameStatus` so the hub's
// controls behave identically for every game (Requirement 2):
//
//     idle     -> Start        (Requirement 2.1)
//     running  -> Pause, Restart
//     paused   -> Resume, Restart
//     gameover -> Play-Again   (only in gameover, Requirement 5.3)
//     always   -> Back-to-Hub  (available while a game is active, Requirement 1.4)
//
// This is a framework-free vanilla-TS factory that builds its own DOM using the
// shared `.controls` / `.btn` / `.btn--primary` classes defined in
// src/styles/global.css, keeping rendering separate from game logic like the
// other chrome components. Each button carries a descriptive text label so it
// is perceivable to assistive technology (Requirement 9.5) and, being a native
// <button>, is fully keyboard-operable with a visible focus ring
// (Requirement 9.2).
//
// Wiring is flexible: callers may pass individual callbacks (`onStart`,
// `onPause`, ...) and/or a `GameInstance`. When a `GameInstance` is supplied,
// the lifecycle buttons default to invoking its `start`/`pause`/`resume`/
// `restart` methods (Play-Again also maps to `restart`, per the design's
// lifecycle machine), and any explicit callback overrides that default. The
// Back-to-Hub button is always wired to `onBackToHub`, since returning to the
// Hub is the responsibility of the surrounding PlayArea, not the runner.

import type { GameInstance, GameStatus } from "../engine/types";

/** Callbacks invoked when the corresponding control is activated. */
export interface LifecycleControlsCallbacks {
  /** Start play from `idle` (Requirement 2.2). */
  onStart?: () => void;
  /** Suspend play while `running` (Requirement 2.3). */
  onPause?: () => void;
  /** Continue play from `paused` (Requirement 2.4). */
  onResume?: () => void;
  /** Reset to the initial state while `running`/`paused` (Requirement 2.5). */
  onRestart?: () => void;
  /** Begin a fresh session from `gameover` (Requirement 5.4). */
  onPlayAgain?: () => void;
  /** Return to the Hub, clearing the Play_Area (Requirements 1.4, 1.5). */
  onBackToHub?: () => void;
}

export interface CreateLifecycleControlsOptions extends LifecycleControlsCallbacks {
  /**
   * The running game instance. When provided, lifecycle buttons default to the
   * instance's methods; explicit callbacks above take precedence.
   */
  instance?: GameInstance;
}

/**
 * A mounted set of lifecycle controls. Returned by
 * {@link createLifecycleControls}. The PlayArea mounts it alongside the canvas,
 * drives visibility with `setStatus` as the runner's status changes, and tears
 * it down with `destroy()` when the game is stopped or the Visitor returns to
 * the Hub.
 */
export interface LifecycleControls {
  /** The controls root element (also exposed for testing/positioning). */
  readonly element: HTMLElement;
  /** Attach the controls to a parent node. */
  mount(parent: HTMLElement): void;
  /** Update button visibility to match the given status (Requirements 2.1, 5.3). */
  setStatus(status: GameStatus): void;
  /** Remove the controls from the DOM and release their references. */
  destroy(): void;
}

/** Identifies each lifecycle button. */
type ControlKey = "start" | "pause" | "resume" | "restart" | "playAgain" | "back";

interface ControlConfig {
  readonly key: ControlKey;
  /** Accessible + visible label (Requirement 9.5). */
  readonly label: string;
  /** Primary buttons get the accent treatment (Start, Play-Again). */
  readonly primary: boolean;
  /** The statuses in which this control is shown. */
  readonly visibleIn: readonly GameStatus[];
}

// Visibility follows the shared lifecycle machine (see file header). Back-to-Hub
// is present in every status because it must be available while a game is the
// Active_Game (Requirement 1.4).
const CONTROL_CONFIGS: readonly ControlConfig[] = [
  { key: "start", label: "Start", primary: true, visibleIn: ["idle"] },
  { key: "pause", label: "Pause", primary: false, visibleIn: ["running"] },
  { key: "resume", label: "Resume", primary: true, visibleIn: ["paused"] },
  { key: "restart", label: "Restart", primary: false, visibleIn: ["running", "paused"] },
  { key: "playAgain", label: "Play Again", primary: true, visibleIn: ["gameover"] },
  {
    key: "back",
    label: "Back to Hub",
    primary: false,
    visibleIn: ["idle", "running", "paused", "gameover"],
  },
];

/**
 * Create a set of LifecycleControls.
 *
 * All six buttons are created up front; only those whose `visibleIn` includes
 * the current status are shown. The controls start in `idle`, so only Start and
 * Back-to-Hub are visible until {@link LifecycleControls.setStatus} is called.
 */
export function createLifecycleControls(
  options: CreateLifecycleControlsOptions = {},
): LifecycleControls {
  const { instance } = options;

  // Resolve the click handler for each control: an explicit callback wins,
  // otherwise fall back to the bound GameInstance method when available.
  const handlers: Record<ControlKey, (() => void) | undefined> = {
    start: options.onStart ?? (instance ? () => instance.start() : undefined),
    pause: options.onPause ?? (instance ? () => instance.pause() : undefined),
    resume: options.onResume ?? (instance ? () => instance.resume() : undefined),
    restart: options.onRestart ?? (instance ? () => instance.restart() : undefined),
    // Play-Again reuses restart per the design's lifecycle machine.
    playAgain:
      options.onPlayAgain ?? options.onRestart ?? (instance ? () => instance.restart() : undefined),
    back: options.onBackToHub,
  };

  const root = document.createElement("div");
  root.className = "controls";
  // Group the lifecycle controls for assistive technology (Requirement 9.5).
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Game controls");

  const buttons = new Map<ControlKey, HTMLButtonElement>();

  for (const config of CONTROL_CONFIGS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = config.primary ? "btn btn--primary" : "btn";
    button.dataset.control = config.key;
    button.textContent = config.label;
    // Explicit accessible name so the control is described even if the visible
    // text ever diverges from the label (Requirement 9.5).
    button.setAttribute("aria-label", config.label);

    const handler = handlers[config.key];
    if (handler) {
      button.addEventListener("click", handler);
    }

    buttons.set(config.key, button);
    root.appendChild(button);
  }

  function applyVisibility(status: GameStatus): void {
    for (const config of CONTROL_CONFIGS) {
      const button = buttons.get(config.key);
      if (!button) continue;
      button.hidden = !config.visibleIn.includes(status);
    }
  }

  // Start in `idle`: Start + Back-to-Hub visible before play begins (Req 2.1).
  applyVisibility("idle");

  return {
    element: root,

    mount(parent: HTMLElement): void {
      parent.appendChild(root);
    },

    setStatus(status: GameStatus): void {
      applyVisibility(status);
    },

    destroy(): void {
      root.remove();
      buttons.clear();
    },
  };
}
