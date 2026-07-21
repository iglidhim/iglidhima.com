import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { fitToContainer } from "./canvasFit";

describe("fitToContainer", () => {
  // Feature: personal-website, Property 12: The game display scales to fit the Play_Area while preserving aspect ratio
  it("never exceeds the container and preserves the aspect ratio", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 10000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 1, max: 10000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.01, max: 100, noNaN: true, noDefaultInfinity: true }),
        (containerWidth, containerHeight, aspectRatio) => {
          const { width, height } = fitToContainer(
            containerWidth,
            containerHeight,
            aspectRatio,
          );

          // Result fits within the container in both dimensions (allow a tiny
          // floating-point slack).
          const slack = 1e-9;
          expect(width).toBeLessThanOrEqual(containerWidth + slack);
          expect(height).toBeLessThanOrEqual(containerHeight + slack);

          // Dimensions are non-negative and finite.
          expect(width).toBeGreaterThanOrEqual(0);
          expect(height).toBeGreaterThanOrEqual(0);
          expect(Number.isFinite(width)).toBe(true);
          expect(Number.isFinite(height)).toBe(true);

          // Width-to-height ratio equals the requested aspect ratio (relative
          // tolerance for floating point).
          const actualRatio = width / height;
          expect(Math.abs(actualRatio - aspectRatio)).toBeLessThanOrEqual(
            aspectRatio * 1e-9 + 1e-9,
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
