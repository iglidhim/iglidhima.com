import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { clearLines, type Cell } from "./logic";

describe("clearLines", () => {
  // A row is fully filled when it has width and contains no empty (0) cell.
  const isRowFull = (row: readonly Cell[]): boolean =>
    row.length > 0 && row.every((cell) => cell !== 0);

  // Feature: personal-website, Property 13: Block Cascade line clearing removes exactly the full rows
  it("removes exactly the full rows, preserving dimensions and surviving order", () => {
    // Arbitrary rectangular grids: a fixed column width per grid, cells 0 (empty)
    // or 1..7 (filled), with rows spanning empty, partial, and fully filled.
    const gridArb = fc.integer({ min: 1, max: 12 }).chain((cols) =>
      fc.array(
        fc.array(fc.integer({ min: 0, max: 7 }), {
          minLength: cols,
          maxLength: cols,
        }),
        { minLength: 0, maxLength: 24 },
      ),
    );

    fc.assert(
      fc.property(gridArb, (grid) => {
        const cols = grid[0]?.length ?? 0;
        const inputFull = grid.filter(isRowFull).length;
        const surviving = grid.filter((row) => !isRowFull(row));

        const { grid: result, cleared } = clearLines(grid);

        // Dimensions are preserved: same row count and same column width.
        expect(result.length).toBe(grid.length);
        for (const row of result) {
          expect(row.length).toBe(cols);
        }

        // No fully filled rows remain in the output.
        expect(result.some(isRowFull)).toBe(false);

        // `cleared` equals the number of fully filled rows in the input.
        expect(cleared).toBe(inputFull);

        // The leading `cleared` rows are the freshly prepended empty rows.
        for (let i = 0; i < cleared; i++) {
          expect(result[i]).toEqual(new Array<Cell>(cols).fill(0));
        }

        // Surviving rows are preserved in original order, shifted to the bottom.
        expect(result.slice(cleared)).toEqual(surviving);
      }),
      { numRuns: 100 },
    );
  });
});
