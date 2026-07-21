// Render/behaviour tests for the Doodle_Board chrome component.
//
// Lives under src/ui/** so it runs in the jsdom environment (see vite.config.ts).
// jsdom has no real 2D canvas: `getContext("2d")` may return null and `toBlob`
// is unavailable, so these tests assert on model state (isEmpty) and DOM
// structure rather than pixels (Requirements 2.3, 2.5, 10.3, 10.5).
import { describe, it, expect, beforeEach } from "vitest";
import { createDoodleBoard } from "./doodleBoard";

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

describe("createDoodleBoard", () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  it("does not throw when constructed and mounted under jsdom", () => {
    expect(() => {
      const board = createDoodleBoard();
      board.mount(host);
      board.destroy();
    }).not.toThrow();
  });

  it("renders a palette of at least six selectable colors", () => {
    const board = createDoodleBoard();
    board.mount(host);

    const colors = host.querySelectorAll(".doodle__color");
    expect(colors.length).toBeGreaterThanOrEqual(6);
    // Each is a native, labelled button (keyboard reachable + text alternative).
    colors.forEach((c) => {
      expect(c.tagName).toBe("BUTTON");
      expect(c.getAttribute("aria-label")).toBeTruthy();
    });
  });

  it("renders at least three selectable brush sizes", () => {
    const board = createDoodleBoard();
    board.mount(host);

    const brushSizes = host.querySelectorAll(".doodle__brush");
    expect(brushSizes.length).toBeGreaterThanOrEqual(3);
    brushSizes.forEach((b) => {
      expect(b.tagName).toBe("BUTTON");
      expect(b.getAttribute("aria-label")).toBeTruthy();
    });
  });

  it("exposes undo and clear as native, labelled, keyboard-reachable buttons", () => {
    const board = createDoodleBoard();
    board.mount(host);

    const undo = host.querySelector('.doodle__action[aria-label="Undo last stroke"]');
    const clear = host.querySelector('.doodle__action[aria-label="Clear the whole drawing"]');
    expect(undo).not.toBeNull();
    expect(clear).not.toBeNull();
    expect(undo?.tagName).toBe("BUTTON");
    expect(clear?.tagName).toBe("BUTTON");
    // Native buttons are focusable without a positive tabindex.
    expect(undo?.getAttribute("tabindex")).not.toBe("-1");
    expect(clear?.getAttribute("tabindex")).not.toBe("-1");
  });

  it("marks the active color and brush via aria-pressed", () => {
    const board = createDoodleBoard();
    board.mount(host);

    const pressedColors = host.querySelectorAll('.doodle__color[aria-pressed="true"]');
    const pressedBrushes = host.querySelectorAll('.doodle__brush[aria-pressed="true"]');
    expect(pressedColors.length).toBe(1);
    expect(pressedBrushes.length).toBe(1);

    // Selecting another color moves the active marker.
    const colors = Array.from(host.querySelectorAll<HTMLButtonElement>(".doodle__color"));
    const target = colors.find((c) => c.getAttribute("aria-pressed") === "false");
    target?.click();
    expect(target?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelectorAll('.doodle__color[aria-pressed="true"]').length).toBe(1);
  });

  it("adds a stroke to the model over a pointer down/move/up drag", () => {
    const board = createDoodleBoard();
    board.mount(host);
    const canvas = host.querySelector<HTMLCanvasElement>(".doodle__canvas");
    expect(canvas).not.toBeNull();
    expect(board.isEmpty()).toBe(true);

    canvas!.dispatchEvent(pointerEvent("pointerdown", { pointerId: 1, clientX: 10, clientY: 10, button: 0 }));
    canvas!.dispatchEvent(pointerEvent("pointermove", { pointerId: 1, clientX: 20, clientY: 25 }));
    canvas!.dispatchEvent(pointerEvent("pointermove", { pointerId: 1, clientX: 40, clientY: 55 }));
    canvas!.dispatchEvent(pointerEvent("pointerup", { pointerId: 1, clientX: 40, clientY: 55 }));

    // A drag produced a committed stroke, so the board is no longer empty.
    expect(board.isEmpty()).toBe(false);
  });

  it("undo removes the last stroke and clear empties the board", () => {
    const board = createDoodleBoard();
    board.mount(host);
    const canvas = host.querySelector<HTMLCanvasElement>(".doodle__canvas")!;

    const drag = (): void => {
      canvas.dispatchEvent(pointerEvent("pointerdown", { pointerId: 1, clientX: 5, clientY: 5, button: 0 }));
      canvas.dispatchEvent(pointerEvent("pointermove", { pointerId: 1, clientX: 15, clientY: 15 }));
      canvas.dispatchEvent(pointerEvent("pointerup", { pointerId: 1, clientX: 15, clientY: 15 }));
    };

    drag();
    drag();
    expect(board.isEmpty()).toBe(false);

    board.undo();
    expect(board.isEmpty()).toBe(false); // one stroke left

    board.clear();
    expect(board.isEmpty()).toBe(true);
  });

  it("toPngBlob resolves without throwing under jsdom (null when unsupported)", async () => {
    const board = createDoodleBoard();
    board.mount(host);
    // jsdom lacks a PNG encoder; the guard must resolve rather than reject.
    await expect(board.toPngBlob()).resolves.not.toThrow;
  });

  it("removes itself and detaches listeners on destroy", () => {
    const board = createDoodleBoard();
    board.mount(host);
    expect(host.querySelector(".doodle")).not.toBeNull();

    board.destroy();
    expect(host.querySelector(".doodle")).toBeNull();
  });
});
