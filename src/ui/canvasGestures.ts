// src/ui/canvasGestures.ts
// On-canvas touch gestures for the Play_Area (Requirements 3.2, 8.4).
//
// Turns pointer interaction with the game canvas itself into game actions, so
// touch players can play by swiping/dragging/tapping the board instead of (or
// as well as) the on-screen Touch_Controls buttons. The layer is declarative:
// each game describes its gestures via the optional `GameDefinition.gestures`
// spec, and this module translates pointer movement into the mapped actions.
//
// Gesture model:
//   * Directional drag — movement is accumulated from an anchor point; every
//     time the drag crosses one "step" (a fraction of the canvas display size
//     on that axis) the direction's action is dispatched and the anchor
//     re-arms at the current position. A held drag therefore keeps steering:
//     one long pull dispatches several steps, and changing direction without
//     lifting the finger works naturally. When both axes cross their step in
//     the same movement, only the dominant axis (greater progress relative to
//     its own step) fires, so diagonal wobble never double-dispatches.
//   * `once` directions fire a single action and then swallow the remainder of
//     that touch — used for committing actions like Block Cascade's hard drop,
//     where a repeat would spill onto the next piece.
//   * Tap — press and release with negligible total movement dispatches the
//     spec's `tap` action (e.g. rotate, launch). Any dispatched drag step
//     suppresses the tap for that touch.
//
// Pointer Events unify mouse/touch/stylus (same pattern as doodleBoard.ts):
// pointer capture keeps the drag alive when the finger leaves the canvas, and
// `touch-action: none` is applied inline WHILE THE GAME IS RUNNING ONLY — the
// layer is gated by `setActive`, wired to the runner's status, so an idle,
// paused, or finished game never consumes input nor blocks page scrolling
// (mirroring InputManager's running gate, Requirement 3.5).
//
// Dispatch goes through `InputManager.pushAction`, so gestures share the exact
// per-frame drain as keyboard and Touch_Controls input — the simulation cannot
// tell the sources apart (Requirement 3.3).

import type { GestureDirectionSpec, GestureSpec } from "../engine/types";

/** Default drag step: 15% of the canvas display size along the gesture axis. */
export const DEFAULT_STEP_FRACTION = 0.15;

/** Maximum total pointer travel (CSS px) for a press-release to count as a tap. */
export const TAP_MAX_TRAVEL_PX = 12;

export interface CreateCanvasGesturesOptions<A extends string = string> {
  /** The Play_Area game canvas the gestures attach to. */
  canvas: HTMLCanvasElement;
  /** The active game's declarative gesture mapping. */
  spec: GestureSpec<A>;
  /** Sink for resolved actions (typically `InputManager.pushAction`). */
  dispatch: (action: A) => void;
}

export interface CanvasGestures {
  /**
   * Enable/disable the layer. While active the canvas opts out of native
   * touch scrolling (`touch-action: none`) and pointer input is translated to
   * actions; while inactive the canvas behaves like ordinary page content.
   */
  setActive(active: boolean): void;
  /** Detach every listener and restore the canvas's touch behaviour. */
  destroy(): void;
}

/**
 * Attach a declarative gesture layer to a game canvas. Listeners are bound
 * immediately but stay dormant until `setActive(true)`; the caller wires that
 * to the game's `running` status. Call `destroy()` on teardown.
 */
export function createCanvasGestures<A extends string = string>(
  options: CreateCanvasGesturesOptions<A>,
): CanvasGestures {
  const { canvas, spec, dispatch } = options;

  let active = false;

  // --- Per-touch tracking state -------------------------------------------
  /** The pointer currently steering, or null between touches (single-touch). */
  let pointerId: number | null = null;
  /** Re-arming accumulation anchor (client/CSS px). */
  let anchorX = 0;
  let anchorY = 0;
  /** Where the touch began, for tap travel measurement (client/CSS px). */
  let startX = 0;
  let startY = 0;
  /** Whether any drag step was dispatched during this touch (suppresses tap). */
  let stepped = false;
  /** Whether a `once` direction fired — the rest of the touch is swallowed. */
  let consumed = false;

  /**
   * Canvas display size in CSS px. Under jsdom (or before layout) the rect is
   * zero-sized; fall back to the backing-store size so step math stays sane
   * (same fallback strategy as doodleBoard's coordinate mapping).
   */
  function displaySize(): { width: number; height: number } {
    const rect = canvas.getBoundingClientRect();
    return {
      width: rect.width > 0 ? rect.width : canvas.width,
      height: rect.height > 0 ? rect.height : canvas.height,
    };
  }

  /** The step length in CSS px for a direction spec along the given axis size. */
  function stepPx(direction: GestureDirectionSpec<A>, axisSize: number): number {
    const fraction = direction.stepFraction ?? DEFAULT_STEP_FRACTION;
    // Guard degenerate configs/layouts so progress math never divides by zero.
    return Math.max(1, fraction * axisSize);
  }

  /** Reset all per-touch state (between touches / on deactivate / destroy). */
  function resetTouch(): void {
    pointerId = null;
    stepped = false;
    consumed = false;
  }

  function handlePointerDown(event: PointerEvent): void {
    if (!active) return;
    // Primary button / touch / pen contact only.
    if (event.button !== undefined && event.button > 0) return;
    // Single-touch: ignore additional fingers while one is steering.
    if (pointerId !== null) return;

    pointerId = event.pointerId;
    anchorX = startX = event.clientX;
    anchorY = startY = event.clientY;
    stepped = false;
    consumed = false;

    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // setPointerCapture may be unavailable (jsdom) or reject an unknown id.
    }
    event.preventDefault();
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!active || pointerId !== event.pointerId || consumed) return;
    event.preventDefault();

    const { width, height } = displaySize();
    const dx = event.clientX - anchorX;
    const dy = event.clientY - anchorY;

    const horizontal = dx < 0 ? spec.left : spec.right;
    const vertical = dy < 0 ? spec.up : spec.down;

    // Progress along each axis, in units of that direction's own step. An
    // unconfigured direction contributes no progress.
    const hStep = horizontal ? stepPx(horizontal, width) : Infinity;
    const vStep = vertical ? stepPx(vertical, height) : Infinity;
    const hProgress = horizontal ? Math.abs(dx) / hStep : 0;
    const vProgress = vertical ? Math.abs(dy) / vStep : 0;

    if (hProgress < 1 && vProgress < 1) return;

    // Dominant axis wins; the other axis's accumulation resets with the anchor
    // so diagonal wobble never queues a stale perpendicular step.
    if (hProgress >= vProgress) {
      fireDirection(horizontal!, Math.floor(hProgress));
    } else {
      fireDirection(vertical!, Math.floor(vProgress));
    }
    anchorX = event.clientX;
    anchorY = event.clientY;
  }

  /** Dispatch a direction's action `count` times (once for `once` directions). */
  function fireDirection(direction: GestureDirectionSpec<A>, count: number): void {
    stepped = true;
    if (direction.once) {
      dispatch(direction.action);
      consumed = true;
      return;
    }
    for (let i = 0; i < count; i++) {
      dispatch(direction.action);
    }
  }

  function handlePointerEnd(event: PointerEvent): void {
    if (pointerId !== event.pointerId) return;

    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore: capture may not have been set or the id is unknown.
    }

    // A quiet press-release is a tap (only on pointerup — a cancelled touch,
    // e.g. one the OS claimed for a system gesture, must not fire actions).
    if (event.type === "pointerup" && active && !stepped && !consumed && spec.tap) {
      const travel = Math.hypot(event.clientX - startX, event.clientY - startY);
      if (travel <= TAP_MAX_TRAVEL_PX) {
        dispatch(spec.tap);
      }
    }
    resetTouch();
  }

  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerup", handlePointerEnd);
  canvas.addEventListener("pointercancel", handlePointerEnd);

  return {
    setActive(next: boolean): void {
      if (active === next) return;
      active = next;
      // Opt out of native touch scrolling only while the game is running, so
      // an idle/paused/finished canvas never traps page scrolling (Req 3.5).
      // Applied inline (like doodleBoard) so it takes effect immediately.
      canvas.style.touchAction = next ? "none" : "";
      if (!next) {
        resetTouch();
      }
    },

    destroy(): void {
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerEnd);
      canvas.removeEventListener("pointercancel", handlePointerEnd);
      canvas.style.touchAction = "";
      active = false;
      resetTouch();
    },
  };
}
