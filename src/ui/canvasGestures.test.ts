// Behaviour tests for the on-canvas gesture layer (Requirements 3.2, 8.4).
//
// Lives under src/ui/** so it runs in the jsdom environment (see vite.config.ts).
// jsdom computes no layout, so `getBoundingClientRect()` returns a zero-sized
// rect and the layer falls back to the canvas backing-store size for its step
// math — the tests size the canvas explicitly (200×100) so every step length
// is deterministic: stepFraction 0.1 → 20px horizontally, 10px vertically.
import { describe, it, expect, beforeEach } from "vitest";
import { createCanvasGestures, TAP_MAX_TRAVEL_PX } from "./canvasGestures";
import type { GestureSpec } from "../engine/types";

/** Build a PointerEvent, tolerating jsdom's missing PointerEvent constructor. */
function pointerEvent(type: string, init: PointerEventInit): Event {
  if (typeof PointerEvent === "function") {
    return new PointerEvent(type, init);
  }
  // Fallback: a MouseEvent with a pointerId tacked on is enough for the handler.
  const event = new MouseEvent(type, init);
  Object.defineProperty(event, "pointerId", { value: init.pointerId ?? 1 });
  return event;
}

/** Four-direction spec (Serpent-like): 0.1 steps → 20px horiz, 10px vert. */
const DPAD_SPEC: GestureSpec = {
  up: { action: "up", stepFraction: 0.1 },
  down: { action: "down", stepFraction: 0.1 },
  left: { action: "left", stepFraction: 0.1 },
  right: { action: "right", stepFraction: 0.1 },
};

describe("createCanvasGestures", () => {
  let canvas: HTMLCanvasElement;
  let dispatched: string[];

  beforeEach(() => {
    document.body.innerHTML = "";
    canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 100;
    document.body.appendChild(canvas);
    dispatched = [];
  });

  function build(spec: GestureSpec, { active = true } = {}) {
    const gestures = createCanvasGestures({
      canvas,
      spec,
      dispatch: (action) => dispatched.push(action),
    });
    if (active) gestures.setActive(true);
    return gestures;
  }

  function down(x: number, y: number, pointerId = 1, button = 0): void {
    canvas.dispatchEvent(
      pointerEvent("pointerdown", { pointerId, clientX: x, clientY: y, button }),
    );
  }
  function move(x: number, y: number, pointerId = 1): void {
    canvas.dispatchEvent(pointerEvent("pointermove", { pointerId, clientX: x, clientY: y }));
  }
  function up(x: number, y: number, pointerId = 1): void {
    canvas.dispatchEvent(pointerEvent("pointerup", { pointerId, clientX: x, clientY: y }));
  }
  function cancel(x: number, y: number, pointerId = 1): void {
    canvas.dispatchEvent(pointerEvent("pointercancel", { pointerId, clientX: x, clientY: y }));
  }

  it("stays dormant until activated: no actions, no touch-action override", () => {
    build(DPAD_SPEC, { active: false });

    down(100, 50);
    move(160, 50);
    up(160, 50);

    expect(dispatched).toEqual([]);
    // jsdom reports a never-assigned property as undefined; a browser as "".
    // Either way, the layer must not have applied the "none" override.
    expect(canvas.style.touchAction).not.toBe("none");
  });

  it("opts the canvas out of native touch scrolling only while active (Req 3.5)", () => {
    const gestures = build(DPAD_SPEC, { active: false });

    gestures.setActive(true);
    expect(canvas.style.touchAction).toBe("none");

    gestures.setActive(false);
    expect(canvas.style.touchAction).toBe("");
  });

  it("dispatches a direction action once the drag crosses one step", () => {
    build(DPAD_SPEC);

    down(100, 50);
    move(125, 50); // dx = +25 ≥ 20px step

    expect(dispatched).toEqual(["right"]);
  });

  it("dispatches one action per step for a long pull", () => {
    build(DPAD_SPEC);

    down(100, 50);
    move(165, 50); // dx = +65 → floor(65 / 20) = 3 steps

    expect(dispatched).toEqual(["right", "right", "right"]);
  });

  it("re-arms at the current position so a held drag keeps steering", () => {
    build(DPAD_SPEC);

    down(100, 50);
    move(125, 50); // right (anchor re-arms at 125,50)
    move(125, 35); // dy = -15 ≥ 10px step → up

    expect(dispatched).toEqual(["right", "up"]);
  });

  it("fires only the dominant axis when a movement crosses both (no diagonal double-dispatch)", () => {
    build(DPAD_SPEC);

    down(100, 50);
    // dx = +40 → 2.0 steps; dy = +12 → 1.2 steps: horizontal dominates.
    move(140, 62);

    expect(dispatched).toEqual(["right", "right"]);
  });

  it("treats a quiet press-release as a tap", () => {
    build({ ...DPAD_SPEC, tap: "rotate" });

    down(100, 50);
    up(102, 52); // travel ≈ 2.8px ≤ TAP_MAX_TRAVEL_PX

    expect(dispatched).toEqual(["rotate"]);
  });

  it("does not tap when the spec declares no tap action", () => {
    build(DPAD_SPEC);

    down(100, 50);
    up(100, 50);

    expect(dispatched).toEqual([]);
  });

  it("suppresses the tap once a drag step has fired", () => {
    build({ ...DPAD_SPEC, tap: "rotate" });

    down(100, 50);
    move(125, 50); // dispatches "right"
    up(125, 50);

    expect(dispatched).toEqual(["right"]);
  });

  it("suppresses the tap when travel exceeds the threshold even without steps", () => {
    build({ tap: "launch" }); // no directions configured

    down(100, 50);
    const travel = TAP_MAX_TRAVEL_PX + 10;
    move(100 + travel, 50); // no direction configured → no step dispatch
    up(100 + travel, 50);

    expect(dispatched).toEqual([]);
  });

  it("fires a `once` direction a single time and swallows the rest of the touch", () => {
    build({
      tap: "rotate",
      left: { action: "left", stepFraction: 0.1 },
      right: { action: "right", stepFraction: 0.1 },
      down: { action: "hardDrop", stepFraction: 0.25, once: true },
    });

    down(100, 20);
    move(100, 80); // dy = +60 → 2.4 steps of 25px, but once → exactly 1 dispatch
    move(40, 80); // dx = -60 → would be 3 left-steps, but the touch is consumed
    up(40, 80); // no tap either

    expect(dispatched).toEqual(["hardDrop"]);

    // The next touch starts fresh.
    down(100, 50);
    move(75, 50);
    expect(dispatched).toEqual(["hardDrop", "left"]);
  });

  it("never dispatches a tap for a cancelled touch", () => {
    build({ ...DPAD_SPEC, tap: "rotate" });

    down(100, 50);
    cancel(100, 50);

    expect(dispatched).toEqual([]);
  });

  it("ignores non-primary buttons", () => {
    build(DPAD_SPEC);

    down(100, 50, 1, 2); // right-click / secondary contact
    move(160, 50);

    expect(dispatched).toEqual([]);
  });

  it("tracks a single pointer: a second concurrent finger is ignored", () => {
    build(DPAD_SPEC);

    down(100, 50, 1);
    down(10, 10, 2); // second finger — ignored while the first steers
    move(70, 10, 2); // its movement dispatches nothing

    expect(dispatched).toEqual([]);

    move(125, 50, 1); // the tracked finger still steers
    expect(dispatched).toEqual(["right"]);
  });

  it("abandons an in-flight touch when deactivated mid-drag", () => {
    const gestures = build(DPAD_SPEC);

    down(100, 50);
    gestures.setActive(false);
    move(160, 50);
    up(160, 50);

    expect(dispatched).toEqual([]);
  });

  it("destroy() detaches listeners and restores touch behaviour", () => {
    const gestures = build(DPAD_SPEC);
    expect(canvas.style.touchAction).toBe("none");

    gestures.destroy();
    expect(canvas.style.touchAction).toBe("");

    down(100, 50);
    move(160, 50);
    up(160, 50);
    expect(dispatched).toEqual([]);
  });
});
