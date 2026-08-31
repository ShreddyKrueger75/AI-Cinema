import { describe, expect, it } from "vitest";

import {
  applyGrade,
  buildCubeLUT,
  gradeDescriptor,
  gradeToCssFilter,
} from "@/lib/grade";
import type { Grade } from "@/lib/types";

const LUT_SIZE = 17;
const DATA_LINE = /^\d+\.\d{5} \d+\.\d{5} \d+\.\d{5}$/;

function makeGrade(adjustments: Grade["adjustments"] = {}, name = "Test"): Grade {
  return { id: "grade_test", name, adjustments };
}

function dataLines(lut: string): number[][] {
  return lut
    .split("\n")
    .filter((line) => DATA_LINE.test(line))
    .map((line) => line.split(" ").map(Number));
}

describe("applyGrade", () => {
  it("is an identity mapping with no adjustments", () => {
    const grade = makeGrade();
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
      const [r, g, b] = applyGrade(v, v, v, grade);
      expect(r).toBeCloseTo(v, 10);
      expect(g).toBeCloseTo(v, 10);
      expect(b).toBeCloseTo(v, 10);
    }
    const [r, g, b] = applyGrade(0.2, 0.5, 0.8, grade);
    expect(r).toBeCloseTo(0.2, 10);
    expect(g).toBeCloseTo(0.5, 10);
    expect(b).toBeCloseTo(0.8, 10);
  });

  it("positive exposure raises values", () => {
    const [r, g, b] = applyGrade(0.5, 0.5, 0.5, makeGrade({ exposure: 0.5 }));
    expect(r).toBeCloseTo(0.75, 10);
    expect(g).toBeCloseTo(0.75, 10);
    expect(b).toBeCloseTo(0.75, 10);
  });

  it("positive contrast pushes values away from mid gray", () => {
    const grade = makeGrade({ contrast: 50 });
    const [dark] = applyGrade(0.25, 0.25, 0.25, grade);
    const [bright] = applyGrade(0.75, 0.75, 0.75, grade);
    expect(dark).toBeLessThan(0.25);
    expect(bright).toBeGreaterThan(0.75);
    // Mid gray is the pivot and stays put.
    const [mid] = applyGrade(0.5, 0.5, 0.5, grade);
    expect(mid).toBeCloseTo(0.5, 10);
  });

  it("positive saturation moves channels away from luminance", () => {
    const grade = makeGrade({ saturation: 100 });
    const [r0, g0] = [0.6, 0.4];
    const [r, g] = applyGrade(r0, g0, 0.4, grade);
    expect(r).toBeGreaterThan(r0); // above luminance, pushed further up
    expect(g).toBeLessThan(g0); // below luminance, pushed further down
  });

  it("clamps output to [0, 1] under extreme adjustments", () => {
    const hot = applyGrade(0.9, 0.9, 0.9, makeGrade({ exposure: 3, contrast: 100 }));
    const cold = applyGrade(0.1, 0.1, 0.1, makeGrade({ exposure: -3, contrast: 100 }));
    for (const v of hot) expect(v).toBe(1);
    for (const v of cold) expect(v).toBe(0);
  });
});

describe("buildCubeLUT", () => {
  it("declares a 17-point LUT with unit domain and the grade name", () => {
    const lut = buildCubeLUT(makeGrade({}, "Neon Nights"));
    const lines = lut.split("\n");
    expect(lines[0]).toContain("Neon Nights");
    expect(lines).toContain(`LUT_3D_SIZE ${LUT_SIZE}`);
    expect(lines).toContain("DOMAIN_MIN 0.0 0.0 0.0");
    expect(lines).toContain("DOMAIN_MAX 1.0 1.0 1.0");
  });

  it("emits exactly size^3 data rows", () => {
    const rows = dataLines(buildCubeLUT(makeGrade()));
    expect(rows).toHaveLength(LUT_SIZE ** 3);
  });

  it("maps an identity grade to the identity LUT (r fastest, then g, then b)", () => {
    const rows = dataLines(buildCubeLUT(makeGrade()));
    rows.forEach((row, i) => {
      const r = (i % LUT_SIZE) / (LUT_SIZE - 1);
      const g = (Math.floor(i / LUT_SIZE) % LUT_SIZE) / (LUT_SIZE - 1);
      const b = Math.floor(i / (LUT_SIZE * LUT_SIZE)) / (LUT_SIZE - 1);
      expect(row[0]).toBeCloseTo(r, 4);
      expect(row[1]).toBeCloseTo(g, 4);
      expect(row[2]).toBeCloseTo(b, 4);
    });
  });

  it("moves the mid-gray entry up under positive exposure", () => {
    const rows = dataLines(buildCubeLUT(makeGrade({ exposure: 0.5 })));
    const mid = (LUT_SIZE - 1) / 2; // grid index 8 → input 0.5
    const i = mid * LUT_SIZE * LUT_SIZE + mid * LUT_SIZE + mid;
    expect(rows[i][0]).toBeCloseTo(0.75, 4);
    expect(rows[i][1]).toBeCloseTo(0.75, 4);
    expect(rows[i][2]).toBeCloseTo(0.75, 4);
  });

  it("keeps every value in [0, 1] even for extreme grades", () => {
    const extreme = makeGrade({
      exposure: 2,
      contrast: 100,
      saturation: 200,
      mids: "warm",
      blacks: "crushed",
      shadow_tint: "teal",
    });
    const negative = makeGrade({ exposure: -2, contrast: 100, saturation: -200 });
    for (const grade of [extreme, negative]) {
      const rows = dataLines(buildCubeLUT(grade));
      expect(rows).toHaveLength(LUT_SIZE ** 3);
      for (const row of rows) {
        for (const v of row) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe("gradeToCssFilter", () => {
  it("returns 'none' for an identity grade", () => {
    expect(gradeToCssFilter(makeGrade())).toBe("none");
  });

  it("emits brightness for exposure and saturate for saturation", () => {
    const filter = gradeToCssFilter(makeGrade({ exposure: 0.5, saturation: 20 }));
    expect(filter).toContain("brightness(1.250)");
    expect(filter).toContain("saturate(1.200)");
  });
});

describe("gradeDescriptor", () => {
  it("summarizes an identity grade as no adjustment", () => {
    expect(gradeDescriptor(makeGrade())).toBe("no adjustment");
  });

  it("lists non-neutral adjustments", () => {
    const text = gradeDescriptor(
      makeGrade({ exposure: 0.25, contrast: 10, blacks: "crushed" }),
    );
    expect(text).toContain("exposure +0.25");
    expect(text).toContain("contrast +10");
    expect(text).toContain("crushed blacks");
  });
});
