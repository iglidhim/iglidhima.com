// Responsive canvas-fit math for scaling the Active_Game display into the
// Play_Area while preserving its aspect ratio (Requirement 8.3).

export interface FitResult {
  width: number;
  height: number;
}

/**
 * Compute the largest size that fits within the container in BOTH dimensions
 * while preserving `aspectRatio` (defined as width / height).
 *
 * The result never exceeds `containerWidth` or `containerHeight`, and its
 * width-to-height ratio equals `aspectRatio`.
 *
 * @param containerWidth  Available width of the Play_Area (>= 0).
 * @param containerHeight Available height of the Play_Area (>= 0).
 * @param aspectRatio     Desired width / height ratio (> 0).
 */
export function fitToContainer(
  containerWidth: number,
  containerHeight: number,
  aspectRatio: number,
): FitResult {
  // Start by filling the full container width, then derive the matching height.
  const widthIfWidthBound = containerWidth;
  const heightIfWidthBound = containerWidth / aspectRatio;

  if (heightIfWidthBound <= containerHeight) {
    // Width is the limiting dimension (or an exact fit).
    return { width: widthIfWidthBound, height: heightIfWidthBound };
  }

  // Otherwise height is the limiting dimension: fill the full container height
  // and derive the matching width from the aspect ratio.
  return { width: containerHeight * aspectRatio, height: containerHeight };
}
