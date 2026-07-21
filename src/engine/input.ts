// src/engine/input.ts
// Game-agnostic input handling for the arcade hub.
//
// The InputManager translates raw keyboard events and (on touch-capable
// devices) on-screen Touch_Controls into a buffer of game actions, using the
// active game's `keyMap` and `touchControls`. Each frame the GameRunner drains
// the buffer and feeds the actions to the pure `step` function, so that a
// directional input reaches the simulation on the very next frame
// (Requirements 3.1, 3.2, 3.3).
//
// While a game is running, any key mapped to a browser scrolling action has its
// default prevented so gameplay input never scrolls the page (Requirement 3.5).
// Unmapped keys are ignored rather than throwing.
//
// The raw-key -> action translation is factored out as the pure function
// `resolveAction` so it can be tested in isolation without any DOM.

import type { TouchControlSpec } from "./types";

/**
 * Pure translation from a raw key to a game action.
 *
 * Returns the action the active game maps the key to, or `null` when the key is
 * unmapped. This has no side effects and no DOM dependency, so it is the focus
 * of unit testing for input resolution (Requirement 3.1).
 */
export function resolveAction<A extends string>(
  keyMap: Readonly<Record<string, A>>,
  key: string,
): A | null {
  const action = keyMap[key];
  return action ?? null;
}

/** Best-effort detection of touch capability in the current environment. */
export function detectTouchCapable(): boolean {
  if (typeof window !== "undefined" && "ontouchstart" in window) {
    return true;
  }
  if (typeof navigator !== "undefined" && typeof navigator.maxTouchPoints === "number") {
    return navigator.maxTouchPoints > 0;
  }
  return false;
}

export interface InputManagerOptions<A extends string> {
  /** The active game's key -> action map (Requirement 3.1). */
  keyMap: Readonly<Record<string, A>>;
  /** Keys whose default browser scrolling is prevented while running (Req 3.5). */
  scrollKeys?: readonly string[];
  /** The active game's touch control specs; defines the valid touch actions (Req 3.2). */
  touchControls?: readonly TouchControlSpec[];
  /** EventTarget that receives keyboard listeners. Defaults to `window`. */
  keyboardTarget?: EventTarget;
  /**
   * Container element holding the rendered Touch_Controls. Each interactive
   * control carries a `data-action` attribute naming the game action it issues;
   * a single delegated listener on the container buffers those actions.
   */
  touchContainer?: HTMLElement | null;
  /** Override touch-capability detection (auto-detected when omitted). */
  touchCapable?: boolean;
}

/**
 * Registers input listeners for the active game and buffers the resulting game
 * actions until the runner drains them each frame.
 *
 * Lifecycle: construct, then `attach()` to bind listeners; `setRunning(true)`
 * once play begins so inputs are buffered and scroll keys are suppressed;
 * `drainActions()` once per frame; and `destroy()` to remove every listener and
 * release the buffer (Requirement 1.5).
 */
export class InputManager<A extends string> {
  private readonly keyMap: Readonly<Record<string, A>>;
  private readonly scrollKeys: ReadonlySet<string>;
  private readonly touchActions: ReadonlySet<string>;
  private readonly keyboardTarget: EventTarget;
  private readonly touchContainer: HTMLElement | null;
  private readonly touchCapable: boolean;

  private buffer: A[] = [];
  private running = false;
  private attached = false;

  constructor(options: InputManagerOptions<A>) {
    this.keyMap = options.keyMap;
    this.scrollKeys = new Set(options.scrollKeys ?? []);
    this.touchActions = new Set((options.touchControls ?? []).map((spec) => spec.action));
    this.keyboardTarget =
      options.keyboardTarget ?? (typeof window !== "undefined" ? window : new EventTarget());
    this.touchContainer = options.touchContainer ?? null;
    this.touchCapable = options.touchCapable ?? detectTouchCapable();
  }

  /** Whether Touch_Controls should be active for this device. */
  get touchEnabled(): boolean {
    return this.touchCapable;
  }

  /** Whether the manager currently treats the game as running. */
  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Mark the game as running (or not). Only while running are inputs buffered
   * and scroll keys suppressed, so paused/idle games neither consume input nor
   * block page scrolling (Requirement 3.5).
   */
  setRunning(running: boolean): void {
    this.running = running;
  }

  /** Bind keyboard (and, when touch-capable, touch) listeners. Idempotent. */
  attach(): void {
    if (this.attached) return;
    this.keyboardTarget.addEventListener("keydown", this.handleKeyDown as EventListener);
    if (this.touchCapable && this.touchContainer) {
      this.touchContainer.addEventListener("pointerdown", this.handlePointerDown);
    }
    this.attached = true;
  }

  /**
   * Buffer an action directly. Used by rendered Touch_Controls that prefer to
   * call the manager rather than rely on `data-action` delegation. Actions are
   * only accepted while the game is running.
   */
  pushAction(action: A): void {
    if (!this.running) return;
    this.buffer.push(action);
  }

  /**
   * Return the actions buffered since the last drain and clear the buffer, so
   * each action is delivered to the simulation exactly once (Requirement 3.3).
   */
  drainActions(): A[] {
    const drained = this.buffer;
    this.buffer = [];
    return drained;
  }

  /** Remove all listeners, clear the buffer, and stop treating the game as running. */
  destroy(): void {
    if (this.attached) {
      this.keyboardTarget.removeEventListener("keydown", this.handleKeyDown as EventListener);
      if (this.touchCapable && this.touchContainer) {
        this.touchContainer.removeEventListener("pointerdown", this.handlePointerDown);
      }
      this.attached = false;
    }
    this.buffer = [];
    this.running = false;
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.running) return;

    // Prevent the browser from scrolling on keys the game uses for play (Req 3.5).
    if (this.scrollKeys.has(event.key)) {
      event.preventDefault();
    }

    const action = resolveAction(this.keyMap, event.key);
    if (action !== null) {
      this.buffer.push(action);
    }
  };

  private readonly handlePointerDown = (event: Event): void => {
    if (!this.running) return;

    const target = event.target as HTMLElement | null;
    const control = target?.closest?.("[data-action]") as HTMLElement | null;
    const action = control?.getAttribute("data-action");
    if (action && this.touchActions.has(action)) {
      event.preventDefault();
      this.buffer.push(action as A);
    }
  };
}
