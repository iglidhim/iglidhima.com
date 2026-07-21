// Pure doodle stroke model and undo stack for the Doodle_Board.
//
// This module is the single source of truth for what the Doodle_Board renders:
// an ordered list of completed strokes plus an optional in-progress stroke. All
// operations are pure state mutations over encapsulated arrays, so undo, clear,
// and stroke composition are directly unit/property testable and independent of
// the canvas/DOM. It uses no DOM or Workers globals so it compiles under both
// the client (tsconfig.json) and Worker (tsconfig.worker.json) programs.
//
// Requirements: 2.1, 2.2, 2.4, 2.6, 2.7, 2.8, 2.9.

/** A single point along a stroke path, in canvas coordinates. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A completed (or in-progress) stroke: a color, a brush width, and its path. */
export interface Stroke {
  /** The color applied to this stroke (the selected palette color). */
  readonly color: string;
  /** The brush width applied to this stroke (the selected brush size). */
  readonly width: number;
  /** The ordered points of the stroke path, from first to last. */
  readonly points: Point[];
}

/**
 * The encapsulated stroke model backing the Doodle_Board.
 *
 * A drag lifecycle is: `beginStroke(color, width)` starts an active stroke that
 * carries the currently selected tool settings (Requirements 2.4, 2.6);
 * `appendPoint(pt)` extends it following the pointer/touch path in order
 * (Requirements 2.1, 2.2); `endStroke()` commits it onto the completed stack.
 * `undo()` removes the most recently completed stroke (Requirements 2.8, 2.9)
 * and `clear()` empties the canvas (Requirement 2.7).
 */
export class StrokeStack {
  private readonly completed: Stroke[] = [];
  private active: { color: string; width: number; points: Point[] } | null =
    null;

  /**
   * Begin a new stroke that carries the currently selected color and width.
   *
   * Any in-progress stroke is committed first so a new drag never silently
   * discards a prior one. New strokes carry exactly the passed tool settings
   * (Requirements 2.4, 2.6).
   */
  beginStroke(color: string, width: number): void {
    if (this.active !== null) {
      this.endStroke();
    }
    this.active = { color, width, points: [] };
  }

  /**
   * Append a point to the in-progress stroke, in order (Requirements 2.1, 2.2).
   *
   * No-op if there is no active stroke, so stray pointer moves outside a drag
   * cannot create phantom strokes.
   */
  appendPoint(pt: Point): void {
    if (this.active === null) {
      return;
    }
    this.active.points.push({ x: pt.x, y: pt.y });
  }

  /**
   * Commit the in-progress stroke onto the completed stack.
   *
   * A stroke with no points is discarded (a tap that produced no path adds
   * nothing to undo). No-op if there is no active stroke.
   */
  endStroke(): void {
    if (this.active === null) {
      return;
    }
    if (this.active.points.length > 0) {
      this.completed.push({
        color: this.active.color,
        width: this.active.width,
        points: this.active.points,
      });
    }
    this.active = null;
  }

  /**
   * Remove the most recently completed stroke (Requirement 2.8).
   *
   * If there are no completed strokes, the stack is left unchanged
   * (Requirement 2.9). Any in-progress stroke is dropped first so undo acts on
   * the visible completed strokes.
   */
  undo(): void {
    this.active = null;
    this.completed.pop();
  }

  /** Remove all strokes and any in-progress stroke (Requirement 2.7). */
  clear(): void {
    this.active = null;
    this.completed.length = 0;
  }

  /** True when there are no completed strokes and no in-progress stroke. */
  isEmpty(): boolean {
    return this.completed.length === 0 && this.active === null;
  }

  /** The number of completed strokes currently on the stack. */
  get count(): number {
    return this.completed.length;
  }

  /**
   * The in-progress stroke, if a drag is active, as an immutable snapshot.
   * Returns `null` when no stroke is being drawn.
   */
  get activeStroke(): Stroke | null {
    if (this.active === null) {
      return null;
    }
    return {
      color: this.active.color,
      width: this.active.width,
      points: this.active.points.map((p) => ({ x: p.x, y: p.y })),
    };
  }

  /**
   * A read snapshot of the completed strokes for rendering, in draw order.
   *
   * Returns fresh copies so callers cannot mutate the internal model; the
   * Doodle_Board re-renders from this accessor after every operation.
   */
  get strokes(): Stroke[] {
    return this.completed.map((s) => ({
      color: s.color,
      width: s.width,
      points: s.points.map((p) => ({ x: p.x, y: p.y })),
    }));
  }
}
