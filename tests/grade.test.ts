import { describe, expect, it } from "vitest";
import { applyGrade, buildCubeLUT, buildFFmpegGradeFilter } from "@/lib/grade";
import type { Grade } from "@/lib/types";

const neutral: Grade = { id: "g1", name: "Neutral", adjustments: {} };
const punchy: Grade = {
  id: "g2",
  name: "Punchy",
  adjustments: {
    exposure: 0.2,
    contrast: 20,
    saturation: 15,
    mids: "warm",
    blacks: "crushed",
    shadow_tint: "teal",
  },
};

describe("applyGrade", () => {
  it("is identity for a neutral grade", () => {
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
      const [r, g, b] = applyGrade(v, v, v, neutral);
      expect(r).toBeCloseTo(v, 5);
      expect(g).toBeCloseTo(v, 5);
      expect(b).toBeCloseTo(v, 5);
    }
  });

  it("always clamps output to [0, 1]", () => {
    for (const v of [0, 0.1, 0.5, 0.9, 1]) {
      for (const out of applyGrade(v, 1 - v, v * 0.5, punchy)) {
        expect(out).toBeGreaterThanOrEqual(0);
        expect(out).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("buildCubeLUT", () => {
  it("emits a well-formed 17^3 .cube file", () => {
    const lines = buildCubeLUT(punchy).split("\n");
    expect(lines).toContain("LUT_3D_SIZE 17");
    const entries = lines.filter((l) => /^[\d.]+ [\d.]+ [\d.]+$/.test(l));
    expect(entries).toHaveLength(17 * 17 * 17);
  });

  it("maps black to black and white to white for a neutral grade", () => {
    const entries = buildCubeLUT(neutral)
      .split("\n")
      .filter((l) => /^[\d.]+ [\d.]+ [\d.]+$/.test(l));
    expect(entries[0]).toBe("0.00000 0.00000 0.00000");
    expect(entries[entries.length - 1]).toBe("1.00000 1.00000 1.00000");
  });
});

describe("buildFFmpegGradeFilter", () => {
  it("emits a parseable eq,colorbalance chain", () => {
    const f = buildFFmpegGradeFilter(punchy);
    expect(f).toMatch(/^eq=brightness=[\d.-]+:contrast=[\d.]+:saturation=[\d.]+,colorbalance=/);
    expect(f).toContain("curves="); // crushed blacks
  });

  it("is a no-op-shaped chain for neutral", () => {
    const f = buildFFmpegGradeFilter(neutral);
    expect(f).toContain("brightness=0.000");
    expect(f).toContain("contrast=1.000");
    expect(f).toContain("saturation=1.000");
    expect(f).not.toContain("curves=");
  });
});
