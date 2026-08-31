import { describe, expect, it } from "vitest";

import { MODE_THRESHOLDS, pointerOf, regionLabel } from "@/lib/digest";

// The shape pointerOf expects — same as the module-internal `Gray` type.
type Plane = { data: Int16Array; width: number; height: number };

function plane(width: number, height: number, fill = 0): Plane {
  const data = new Int16Array(width * height);
  data.fill(fill);
  return { data, width, height };
}

function setBlock(
  p: Plane,
  x0: number,
  y0: number,
  w: number,
  h: number,
  value: number,
): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      p.data[y * p.width + x] = value;
    }
  }
}

describe("regionLabel", () => {
  it("names all nine cells of the 3x3 grid", () => {
    expect(regionLabel(0.1, 0.1)).toBe("top-left");
    expect(regionLabel(0.5, 0.1)).toBe("top-center");
    expect(regionLabel(0.9, 0.1)).toBe("top-right");
    expect(regionLabel(0.1, 0.5)).toBe("middle-left");
    expect(regionLabel(0.9, 0.5)).toBe("middle-right");
    expect(regionLabel(0.1, 0.9)).toBe("bottom-left");
    expect(regionLabel(0.5, 0.9)).toBe("bottom-center");
    expect(regionLabel(0.9, 0.9)).toBe("bottom-right");
  });

  it("collapses middle-center to the special 'center' label", () => {
    expect(regionLabel(0.5, 0.5)).toBe("center");
  });

  it("treats the exact 1/3 and 2/3 boundaries as the center band", () => {
    expect(regionLabel(1 / 3, 0)).toBe("top-center");
    expect(regionLabel(2 / 3, 0)).toBe("top-center");
    expect(regionLabel(0, 1 / 3)).toBe("middle-left");
    expect(regionLabel(1 / 3, 1 / 3)).toBe("center");
  });
});

describe("pointerOf", () => {
  it("returns null when nothing moved", () => {
    const prev = plane(20, 20, 50);
    const cur = plane(20, 20, 50);
    expect(pointerOf(prev, cur)).toBeNull();
  });

  it("returns null for empty planes", () => {
    expect(pointerOf(plane(0, 0), plane(0, 0))).toBeNull();
  });

  it("ignores pixel deltas at or below the pixel threshold", () => {
    const prev = plane(10, 10, 0);
    const cur = plane(10, 10, 28); // delta of exactly 28 — needs > 28 to count
    expect(pointerOf(prev, cur)).toBeNull();
  });

  it("returns null when fewer than minPixels changed", () => {
    const prev = plane(20, 20, 0);
    const cur = plane(20, 20, 0);
    setBlock(cur, 0, 0, 4, 6, 100); // 24 changed pixels < default minPixels of 25
    expect(pointerOf(prev, cur)).toBeNull();
  });

  it("localizes a changed block in the top-left with correct centroid and fraction", () => {
    const prev = plane(20, 20, 0);
    const cur = plane(20, 20, 0);
    setBlock(cur, 0, 0, 5, 5, 100); // 25 pixels — exactly minPixels, so it counts
    const p = pointerOf(prev, cur);
    expect(p).not.toBeNull();
    // Centroid of x,y in 0..4 is 2; normalized by width/height 20 → 0.1.
    expect(p!.nx).toBe(0.1);
    expect(p!.ny).toBe(0.1);
    expect(p!.region).toBe("top-left");
    // 25 of 400 pixels changed.
    expect(p!.changed_fraction).toBe(0.0625);
  });

  it("labels a centered change 'center' and rounds changed_fraction to 4 decimals", () => {
    const prev = plane(30, 30, 0);
    const cur = plane(30, 30, 0);
    setBlock(cur, 13, 13, 5, 5, 200); // centroid at x=y=15 → 0.5, 0.5
    const p = pointerOf(prev, cur);
    expect(p).not.toBeNull();
    expect(p!.nx).toBe(0.5);
    expect(p!.ny).toBe(0.5);
    expect(p!.region).toBe("center");
    // 25 / 900 = 0.02777… → rounded to 0.0278.
    expect(p!.changed_fraction).toBe(0.0278);
  });

  it("rounds the centroid to 3 decimals and labels off-center regions", () => {
    const prev = plane(30, 30, 0);
    const cur = plane(30, 30, 0);
    setBlock(cur, 24, 24, 5, 5, 200); // centroid at x=y=26 → 26/30 = 0.8666…
    const p = pointerOf(prev, cur);
    expect(p).not.toBeNull();
    expect(p!.nx).toBe(0.867);
    expect(p!.ny).toBe(0.867);
    expect(p!.region).toBe("bottom-right");
  });

  it("honors custom pixelThresh and minPixels arguments", () => {
    const prev = plane(10, 10, 0);
    const cur = plane(10, 10, 0);
    setBlock(cur, 4, 4, 2, 2, 10); // 4 pixels changed by 10
    // Defaults (thresh 28, min 25): nothing qualifies.
    expect(pointerOf(prev, cur)).toBeNull();
    // Lowered thresholds: the 2x2 block localizes.
    const p = pointerOf(prev, cur, 5, 4);
    expect(p).not.toBeNull();
    expect(p!.region).toBe("center");
    expect(p!.changed_fraction).toBe(0.04);
  });
});

describe("MODE_THRESHOLDS", () => {
  it("orders modes insano < strict < standard < lenient", () => {
    expect(MODE_THRESHOLDS.insano).toBeLessThan(MODE_THRESHOLDS.strict);
    expect(MODE_THRESHOLDS.strict).toBeLessThan(MODE_THRESHOLDS.standard);
    expect(MODE_THRESHOLDS.standard).toBeLessThan(MODE_THRESHOLDS.lenient);
  });
});
