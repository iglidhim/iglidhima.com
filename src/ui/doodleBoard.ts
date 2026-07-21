// src/ui/doodleBoard.ts
// Doodle_Board chrome component — an HTML5 <canvas> a child draws on with a
// finger, mouse, or stylus, plus a color palette, brush-size picker, and undo /
// clear controls (Requirements 2.1, 2.2, 2.3, 2.5, 2.7, 2.8, 10.2, 10.3, 10.5).
//
// This is a framework-free vanilla-TS factory matching the other ui/ components
// (playArea, themeToggle, …): it builds its own DOM using the `.doodle*` CSS
// classes (styling/sizing added in task 18.1) and exposes a small
// { element, mount, destroy } handle.
//
// Design notes:
//   - The pure `StrokeStack` (src/lib/doodle.ts) is the single source of truth.
//     The canvas is a pure projection of the stack: every state change
//     re-renders the whole canvas from the stack, so undo/clear are just pure
//     state operations followed by a redraw.
//   - Input is unified through Pointer Events (pointerdown/move/up/cancel) so
//     mouse, touch, and stylus share exactly one code path (Reqs 2.1, 2.2).
//     `setPointerCapture` keeps a drag bound to the canvas even if the pointer
//     briefly leaves it mid-stroke.
//   - Rendering is guarded: under jsdom `getContext("2d")` may be null and
//     `toBlob` may be missing, so the factory degrades gracefully rather than
//     throwing, and tests can assert on model/DOM state instead of pixels.
//
// Accessibility: every control is a native <button> (keyboard reachable and
// activatable) with an `aria-label` text alternative; the active color and
// brush reflect their selection via `aria-pressed` (Reqs 10.3, 10.5). Sizing to
// >=44x44px is applied via CSS in task 18.1 (Req 10.2).

import { StrokeStack } from "../lib/doodle";

/** A selectable palette color: its CSS color value and an accessible name. */
interface PaletteColor {
  readonly value: string;
  readonly name: string;
}

/** A selectable brush: its stroke width in canvas px and an accessible name. */
interface BrushSize {
  readonly width: number;
  readonly name: string;
}

/**
 * The predefined palette (Req 2.3: at least six colors). Ordered light-to-dark
 * groupings for an easy kid-friendly scan.
 */
const PALETTE = [
  { value: "#1b1b1b", name: "Black" },
  { value: "#e6194b", name: "Red" },
  { value: "#f58231", name: "Orange" },
  { value: "#ffe119", name: "Yellow" },
  { value: "#3cb44b", name: "Green" },
  { value: "#4363d8", name: "Blue" },
  { value: "#911eb4", name: "Purple" },
  { value: "#f032e6", name: "Pink" },
] as const satisfies readonly PaletteColor[];

/** The default palette color: the first entry (Black). */
const DEFAULT_COLOR = PALETTE[0].value;

/** The predefined brush sizes (Req 2.5: at least three sizes). */
const BRUSHES = [
  { width: 4, name: "Small" },
  { width: 10, name: "Medium" },
  { width: 22, name: "Large" },
] as const satisfies readonly BrushSize[];

/** The default brush: the middle entry (Medium). */
const DEFAULT_BRUSH = BRUSHES[1].width;

/** Fallback backing-store size when layout is not measured (e.g. under jsdom).
 *  CSS scales the canvas responsively to the board width (Req 10.1). */
const DEFAULT_CANVAS_WIDTH = 640;
const DEFAULT_CANVAS_HEIGHT = 480;

export interface CreateDoodleBoardOptions {
  /** Initial palette color value; defaults to the first palette entry. */
  initialColor?: string;
  /** Initial brush width; defaults to the middle brush. */
  initialBrush?: number;
  /** Backing-store width in px (defaults to {@link DEFAULT_CANVAS_WIDTH}). */
  width?: number;
  /** Backing-store height in px (defaults to {@link DEFAULT_CANVAS_HEIGHT}). */
  height?: number;
}

/**
 * A mounted Doodle_Board. Returned by {@link createDoodleBoard}. The surrounding
 * Family Corner view reads `isEmpty()` for the empty-submission pre-check and
 * `toPngBlob()` to attach the drawing to a submission.
 */
export interface DoodleBoard {
  /** The Doodle_Board root element (also exposed for testing/positioning). */
  readonly element: HTMLElement;
  /** Attach the board to a parent node. */
  mount(parent: HTMLElement): void;
  /** Detach every listener and remove the board from the DOM. */
  destroy(): void;
  /** True when the canvas has no strokes (Req 2.7 / empty-submission check). */
  isEmpty(): boolean;
  /** Export the drawing as a PNG blob, or `null` if the canvas cannot encode. */
  toPngBlob(): Promise<Blob | null>;
  /** Remove the most recently drawn stroke (Req 2.8). */
  undo(): void;
  /** Remove all strokes, presenting an empty canvas (Req 2.7). */
  clear(): void;
  /** Apply a color to subsequent strokes (Req 2.4). */
  setColor(color: string): void;
  /** Apply a brush width to subsequent strokes (Req 2.6). */
  setBrush(size: number): void;
}

/**
 * Create a Doodle_Board.
 *
 * The root element and all controls are built synchronously; drawing works as
 * soon as it is mounted. Under environments without a 2D context (jsdom) the
 * model still updates on pointer events, so behaviour is testable without
 * pixels.
 */
export function createDoodleBoard(
  options: CreateDoodleBoardOptions = {},
): DoodleBoard {
  const stack = new StrokeStack();

  let currentColor = options.initialColor ?? DEFAULT_COLOR;
  let currentWidth = options.initialBrush ?? DEFAULT_BRUSH;

  // --- Root ---------------------------------------------------------------
  const root = document.createElement("div");
  root.className = "doodle";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Drawing board");

  // --- Canvas -------------------------------------------------------------
  const canvas = document.createElement("canvas");
  canvas.className = "doodle__canvas";
  canvas.width = Math.max(1, Math.round(options.width ?? DEFAULT_CANVAS_WIDTH));
  canvas.height = Math.max(
    1,
    Math.round(options.height ?? DEFAULT_CANVAS_HEIGHT),
  );
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Drawing canvas");
  // `touch-action: none` lets Pointer Events own touch gestures (no scroll/zoom
  // stealing the drag); mirrored in CSS but set here so it applies immediately.
  canvas.style.touchAction = "none";

  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext("2d");
  } catch {
    // Canvas 2D unavailable (e.g. under jsdom): skip rendering, keep the model.
    ctx = null;
  }

  // --- Tools (palette + brushes + actions) --------------------------------
  const tools = document.createElement("div");
  tools.className = "doodle__tools";
  tools.setAttribute("role", "toolbar");
  tools.setAttribute("aria-label", "Drawing tools");

  // Track listeners so destroy() can deterministically deregister everything.
  const cleanups: Array<() => void> = [];

  function addClick(button: HTMLButtonElement, handler: () => void): void {
    button.addEventListener("click", handler);
    cleanups.push(() => button.removeEventListener("click", handler));
  }

  // Palette --------------------------------------------------------------
  const palette = document.createElement("div");
  palette.className = "doodle__palette";
  palette.setAttribute("role", "group");
  palette.setAttribute("aria-label", "Colors");

  const colorButtons: HTMLButtonElement[] = [];
  for (const color of PALETTE) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "doodle__color";
    button.dataset.color = color.value;
    button.style.backgroundColor = color.value;
    button.setAttribute("aria-label", `Color ${color.name}`);
    addClick(button, () => setColor(color.value));
    palette.appendChild(button);
    colorButtons.push(button);
  }

  // Brushes --------------------------------------------------------------
  const brushes = document.createElement("div");
  brushes.className = "doodle__brushes";
  brushes.setAttribute("role", "group");
  brushes.setAttribute("aria-label", "Brush sizes");

  const brushButtons: HTMLButtonElement[] = [];
  for (const brush of BRUSHES) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "doodle__brush";
    button.dataset.width = String(brush.width);
    button.setAttribute("aria-label", `${brush.name} brush`);
    addClick(button, () => setBrush(brush.width));
    brushes.appendChild(button);
    brushButtons.push(button);
  }

  // Actions --------------------------------------------------------------
  const actions = document.createElement("div");
  actions.className = "doodle__actions";
  actions.setAttribute("role", "group");
  actions.setAttribute("aria-label", "Actions");

  const undoButton = document.createElement("button");
  undoButton.type = "button";
  undoButton.className = "doodle__action";
  undoButton.textContent = "Undo";
  undoButton.setAttribute("aria-label", "Undo last stroke");
  addClick(undoButton, () => undo());

  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "doodle__action";
  clearButton.textContent = "Clear";
  clearButton.setAttribute("aria-label", "Clear the whole drawing");
  addClick(clearButton, () => clear());

  actions.append(undoButton, clearButton);
  tools.append(palette, brushes, actions);
  root.append(canvas, tools);

  // --- Rendering ----------------------------------------------------------
  /** Draw a single stroke as a connected, round-capped path. */
  function drawStroke(
    context: CanvasRenderingContext2D,
    color: string,
    width: number,
    points: readonly { x: number; y: number }[],
  ): void {
    if (points.length === 0) return;
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = width;
    context.lineCap = "round";
    context.lineJoin = "round";

    const first = points[0];
    if (first === undefined) return;

    if (points.length === 1) {
      // A single tap: render a filled dot so a click still leaves a mark.
      context.beginPath();
      context.arc(first.x, first.y, Math.max(0.5, width / 2), 0, Math.PI * 2);
      context.fill();
      return;
    }

    context.beginPath();
    context.moveTo(first.x, first.y);
    for (let i = 1; i < points.length; i += 1) {
      const p = points[i];
      if (p !== undefined) {
        context.lineTo(p.x, p.y);
      }
    }
    context.stroke();
  }

  /** Re-render the whole canvas from the StrokeStack (its source of truth). */
  function render(): void {
    if (ctx === null) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const stroke of stack.strokes) {
      drawStroke(ctx, stroke.color, stroke.width, stroke.points);
    }
    const active = stack.activeStroke;
    if (active !== null) {
      drawStroke(ctx, active.color, active.width, active.points);
    }
  }

  // --- Tool selection -----------------------------------------------------
  function markActiveColor(): void {
    for (const button of colorButtons) {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.color === currentColor),
      );
    }
  }

  function markActiveBrush(): void {
    for (const button of brushButtons) {
      button.setAttribute(
        "aria-pressed",
        String(Number(button.dataset.width) === currentWidth),
      );
    }
  }

  function setColor(color: string): void {
    currentColor = color;
    markActiveColor();
  }

  function setBrush(size: number): void {
    currentWidth = size;
    markActiveBrush();
  }

  // Seed the active-tool indicators.
  markActiveColor();
  markActiveBrush();

  // --- Pointer input (unified mouse/touch/stylus) -------------------------
  let drawing = false;

  /** Convert a pointer event's viewport coords to canvas backing-store coords. */
  function toCanvasPoint(event: PointerEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    // Under jsdom (or before layout) the rect has zero size; fall back to a 1:1
    // mapping so the model still receives sensible ordered points.
    const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
    const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  }

  function handlePointerDown(event: PointerEvent): void {
    // Only start on the primary button / touch / pen contact.
    if (event.button !== undefined && event.button > 0) return;
    drawing = true;
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // setPointerCapture may be unavailable (jsdom) or reject an unknown id.
    }
    stack.beginStroke(currentColor, currentWidth);
    stack.appendPoint(toCanvasPoint(event));
    render();
    event.preventDefault();
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!drawing) return;
    stack.appendPoint(toCanvasPoint(event));
    render();
    event.preventDefault();
  }

  function endStroke(event: PointerEvent): void {
    if (!drawing) return;
    drawing = false;
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore: capture may not have been set or the id is unknown.
    }
    stack.endStroke();
    render();
  }

  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerup", endStroke);
  canvas.addEventListener("pointercancel", endStroke);
  cleanups.push(() => {
    canvas.removeEventListener("pointerdown", handlePointerDown);
    canvas.removeEventListener("pointermove", handlePointerMove);
    canvas.removeEventListener("pointerup", endStroke);
    canvas.removeEventListener("pointercancel", endStroke);
  });

  // --- Public operations --------------------------------------------------
  function undo(): void {
    stack.undo();
    render();
  }

  function clear(): void {
    stack.clear();
    render();
  }

  return {
    element: root,

    mount(parent: HTMLElement): void {
      parent.appendChild(root);
    },

    destroy(): void {
      for (const cleanup of cleanups) {
        cleanup();
      }
      cleanups.length = 0;
      root.replaceChildren();
      root.remove();
    },

    isEmpty(): boolean {
      return stack.isEmpty();
    },

    toPngBlob(): Promise<Blob | null> {
      return new Promise((resolve) => {
        if (typeof canvas.toBlob !== "function") {
          // jsdom / unsupported: no PNG encoder available.
          resolve(null);
          return;
        }
        try {
          canvas.toBlob((blob) => resolve(blob), "image/png");
        } catch {
          resolve(null);
        }
      });
    },

    undo,
    clear,
    setColor,
    setBrush,
  };
}
