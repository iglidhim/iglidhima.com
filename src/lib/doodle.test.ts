import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { StrokeStack, type Point } from "./doodle";

// A finite, well-behaved coordinate to avoid NaN/Infinity noise in equality.
const coordArb: fc.Arbitrary<number> = fc.double({
  min: -10000,
  max: 10000,
  noNaN: true,
  noDefaultInfinity: true,
});

const pointArb: fc.Arbitrary<Point> = fc.record({
  x: coordArb,
  y: coordArb,
});

// A non-empty sequence of points, modelling the positions produced by a single
// drag (mouse, touch, or stylus share one path in the model).
const dragArb: fc.Arbitrary<Point[]> = fc.array(pointArb, {
  minLength: 1,
  maxLength: 50,
});

const colorArb: fc.Arbitrary<string> = fc.constantFrom(
  "#000000",
  "#ff0000",
  "#00ff00",
  "#0000ff",
  "#ffff00",
  "#ff00ff",
  "#ffffff",
);

const widthArb: fc.Arbitrary<number> = fc.constantFrom(2, 6, 12);

// A completed stroke expressed as its inputs, used to build arbitrary stacks.
const strokeSpecArb = fc.record({
  color: colorArb,
  width: widthArb,
  points: dragArb,
});

function buildStack(specs: ReadonlyArray<{
  color: string;
  width: number;
  points: Point[];
}>): StrokeStack {
  const stack = new StrokeStack();
  for (const spec of specs) {
    stack.beginStroke(spec.color, spec.width);
    for (const pt of spec.points) {
      stack.appendPoint(pt);
    }
    stack.endStroke();
  }
  return stack;
}

describe("doodle StrokeStack", () => {
  // Feature: family-corner, Property 1: A drag appends exactly its points in order
  it("a completed drag contains exactly its points in the same order", () => {
    fc.assert(
      fc.property(colorArb, widthArb, dragArb, (color, width, points) => {
        const stack = new StrokeStack();
        stack.beginStroke(color, width);
        for (const pt of points) {
          stack.appendPoint(pt);
        }
        stack.endStroke();

        const [stroke] = stack.strokes;
        expect(stack.strokes).toHaveLength(1);
        expect(stroke?.points).toEqual(points);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: family-corner, Property 2: New strokes carry the currently selected tool settings
  it("a stroke carries exactly the color and width selected when it began", () => {
    fc.assert(
      fc.property(colorArb, widthArb, dragArb, (color, width, points) => {
        const stack = new StrokeStack();
        stack.beginStroke(color, width);
        for (const pt of points) {
          stack.appendPoint(pt);
        }
        stack.endStroke();

        const [stroke] = stack.strokes;
        expect(stroke?.color).toBe(color);
        expect(stroke?.width).toBe(width);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: family-corner, Property 3: Clear empties the canvas
  it("clear produces an empty stack for any prior strokes", () => {
    fc.assert(
      fc.property(fc.array(strokeSpecArb, { maxLength: 20 }), (specs) => {
        const stack = buildStack(specs);
        stack.clear();
        expect(stack.isEmpty()).toBe(true);
        expect(stack.count).toBe(0);
        expect(stack.strokes).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: family-corner, Property 4: Undo removes exactly the most recent stroke (and is identity on empty)
  it("push then undo restores the original stack; undo on empty is a no-op", () => {
    fc.assert(
      fc.property(
        fc.array(strokeSpecArb, { maxLength: 20 }),
        strokeSpecArb,
        (specs, extra) => {
          // Identity on empty: undo of an empty stack leaves it empty.
          const empty = new StrokeStack();
          empty.undo();
          expect(empty.isEmpty()).toBe(true);
          expect(empty.count).toBe(0);

          // push(extra) then undo() equals the original stack.
          const original = buildStack(specs);
          const before = original.strokes;
          const beforeCount = original.count;

          original.beginStroke(extra.color, extra.width);
          for (const pt of extra.points) {
            original.appendPoint(pt);
          }
          original.endStroke();
          expect(original.count).toBe(beforeCount + 1);

          original.undo();
          expect(original.count).toBe(beforeCount);
          expect(original.strokes).toEqual(before);
        },
      ),
      { numRuns: 100 },
    );
  });
});
