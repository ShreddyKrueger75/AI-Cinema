import type { Grade } from "./types";

export function buildCubeLUT(grade: Grade): string {
  const size = 17;
  const adj = grade.adjustments;
  const exposure = typeof adj.exposure === "number" ? adj.exposure : 0;
  const contrast = typeof adj.contrast === "number" ? adj.contrast / 100 : 0;
  const mids = typeof adj.mids === "string" ? adj.mids : "neutral";
  const blacks = typeof adj.blacks === "string" ? adj.blacks : "neutral";
  const shadow = typeof adj.shadow_tint === "string" ? adj.shadow_tint : "neutral";

  const tintMap: Record<string, [number, number, number]> = {
    neutral: [0, 0, 0],
    teal:    [-0.04, 0.02, 0.06],
    warm:    [0.05, 0.01, -0.04],
    violet:  [0.03, -0.02, 0.05],
    cool:    [-0.03, 0, 0.05],
  };
  const midShift = mids === "warm" ? [0.03, 0.01, -0.02] : mids === "cool" ? [-0.02, 0, 0.03] : [0, 0, 0];
  const tint = tintMap[shadow] ?? [0, 0, 0];

  const lines: string[] = [];
  lines.push(`# AI Cinema grade: ${grade.name}`);
  lines.push(`# exposure=${exposure} contrast=${contrast} mids=${mids} blacks=${blacks} shadow=${shadow}`);
  lines.push(`LUT_3D_SIZE ${size}`);
  lines.push("DOMAIN_MIN 0.0 0.0 0.0");
  lines.push("DOMAIN_MAX 1.0 1.0 1.0");

  const channel = (v: number, i: 0 | 1 | 2): number => {
    let x = v;
    x = x + exposure * 0.5;
    x = (x - 0.5) * (1 + contrast) + 0.5;
    const shadowWeight = Math.max(0, 1 - x * 2);
    x += tint[i] * shadowWeight;
    const midWeight = 1 - Math.abs(x - 0.5) * 2;
    x += midShift[i] * Math.max(0, midWeight);
    if (blacks === "crushed") x = x < 0.18 ? x * 0.7 : x;
    else if (blacks === "lifted") x = x < 0.18 ? Math.min(0.25, x + 0.05) : x;
    return Math.max(0, Math.min(1, x));
  };

  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const rv = r / (size - 1);
        const gv = g / (size - 1);
        const bv = b / (size - 1);
        lines.push(
          `${channel(rv, 0).toFixed(5)} ${channel(gv, 1).toFixed(5)} ${channel(bv, 2).toFixed(5)}`,
        );
      }
    }
  }
  return lines.join("\n");
}
