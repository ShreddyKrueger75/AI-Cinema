import type { Grade } from "./types";

// Helpers to read adjustment values from the loose `Record<string, number | string>`
// shape that Grade uses.
function num(grade: Grade, key: string, fallback = 0): number {
  const v = grade.adjustments[key];
  return typeof v === "number" ? v : fallback;
}
function str(grade: Grade, key: string, fallback = "neutral"): string {
  const v = grade.adjustments[key];
  return typeof v === "string" ? v : fallback;
}

const TINT_RGB: Record<string, [number, number, number]> = {
  neutral: [0, 0, 0],
  teal:    [-0.06, 0.03, 0.10],
  warm:    [0.08, 0.02, -0.07],
  violet:  [0.06, -0.04, 0.10],
  cool:    [-0.05, 0.01, 0.10],
};
const MID_RGB: Record<string, [number, number, number]> = {
  neutral: [0, 0, 0],
  warm:    [0.06, 0.02, -0.05],
  cool:    [-0.05, 0.01, 0.06],
};

/** Apply a Grade's adjustments to an (r,g,b) input in [0..1]. True 3D — uses
 *  luminance so saturation and shadow/mid weighting reflect the actual pixel,
 *  not just one channel. */
export function applyGrade(
  r: number,
  g: number,
  b: number,
  grade: Grade,
): [number, number, number] {
  const exposure = num(grade, "exposure");
  const contrast = num(grade, "contrast") / 100;
  const saturation = num(grade, "saturation") / 100;
  const mids = str(grade, "mids");
  const blacks = str(grade, "blacks");
  const shadowTint = str(grade, "shadow_tint");

  // Exposure: shift around mid (stops-ish)
  let rr = r + exposure * 0.5;
  let gg = g + exposure * 0.5;
  let bb = b + exposure * 0.5;

  // Contrast: scale around 0.5
  rr = (rr - 0.5) * (1 + contrast) + 0.5;
  gg = (gg - 0.5) * (1 + contrast) + 0.5;
  bb = (bb - 0.5) * (1 + contrast) + 0.5;

  // Saturation: lerp toward luminance
  const lum = 0.299 * rr + 0.587 * gg + 0.114 * bb;
  const satScale = 1 + saturation;
  rr = lum + (rr - lum) * satScale;
  gg = lum + (gg - lum) * satScale;
  bb = lum + (bb - lum) * satScale;

  // Shadow tint: weighted into the shadows
  const tint = TINT_RGB[shadowTint] ?? TINT_RGB.neutral;
  const shadowWeight = Math.max(0, 1 - lum * 2);
  rr += tint[0] * shadowWeight;
  gg += tint[1] * shadowWeight;
  bb += tint[2] * shadowWeight;

  // Mid shift: weighted around the midtones
  const mid = MID_RGB[mids] ?? MID_RGB.neutral;
  const midWeight = Math.max(0, 1 - Math.abs(lum - 0.5) * 2);
  rr += mid[0] * midWeight;
  gg += mid[1] * midWeight;
  bb += mid[2] * midWeight;

  // Blacks: crush or lift
  if (blacks === "crushed" && lum < 0.18) {
    rr *= 0.55;
    gg *= 0.55;
    bb *= 0.55;
  } else if (blacks === "lifted" && lum < 0.18) {
    rr = Math.min(0.28, rr + 0.07);
    gg = Math.min(0.28, gg + 0.07);
    bb = Math.min(0.28, bb + 0.07);
  }

  return [
    Math.max(0, Math.min(1, rr)),
    Math.max(0, Math.min(1, gg)),
    Math.max(0, Math.min(1, bb)),
  ];
}

export function buildCubeLUT(grade: Grade): string {
  const size = 17;
  const lines: string[] = [];
  lines.push(`# AI Cinema grade: ${grade.name}`);
  lines.push(
    `# exposure=${num(grade, "exposure")} contrast=${num(grade, "contrast")} ` +
      `saturation=${num(grade, "saturation")} mids=${str(grade, "mids")} ` +
      `blacks=${str(grade, "blacks")} shadow=${str(grade, "shadow_tint")}`,
  );
  lines.push(`LUT_3D_SIZE ${size}`);
  lines.push("DOMAIN_MIN 0.0 0.0 0.0");
  lines.push("DOMAIN_MAX 1.0 1.0 1.0");

  // .cube ordering: r varies fastest, then g, then b.
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const [rr, gg, bb] = applyGrade(
          r / (size - 1),
          g / (size - 1),
          b / (size - 1),
          grade,
        );
        lines.push(`${rr.toFixed(5)} ${gg.toFixed(5)} ${bb.toFixed(5)}`);
      }
    }
  }
  return lines.join("\n");
}

/** CSS `filter` string approximating the Grade in the preview. Not a true LUT
 *  (browser can't do 3D LUTs without WebGL) — covers exposure, contrast,
 *  saturation, and a tint hint via hue-rotate. The rendered MP4 still uses the
 *  full 3D LUT above; preview is the rough pass. */
export function gradeToCssFilter(grade: Grade): string {
  const exposure = num(grade, "exposure");
  const contrastPct = num(grade, "contrast");
  const saturationPct = num(grade, "saturation");
  const mids = str(grade, "mids");
  const shadowTint = str(grade, "shadow_tint");

  const brightness = Math.max(0.1, 1 + exposure * 0.5);
  const contrast = Math.max(0, 1 + contrastPct / 100);
  const saturate = Math.max(0, 1 + saturationPct / 100);

  // Hue-rotate is an extremely rough analogue for tinting — a few degrees per
  // tint, summed for shadow + mid bias.
  let hueDeg = 0;
  if (shadowTint === "teal") hueDeg += -12;
  else if (shadowTint === "warm") hueDeg += 6;
  else if (shadowTint === "violet") hueDeg += 26;
  else if (shadowTint === "cool") hueDeg += -16;
  if (mids === "warm") hueDeg += 8;
  else if (mids === "cool") hueDeg += -8;

  const parts: string[] = [];
  if (Math.abs(brightness - 1) > 0.001) parts.push(`brightness(${brightness.toFixed(3)})`);
  if (Math.abs(contrast - 1) > 0.001) parts.push(`contrast(${contrast.toFixed(3)})`);
  if (Math.abs(saturate - 1) > 0.001) parts.push(`saturate(${saturate.toFixed(3)})`);
  if (Math.abs(hueDeg) > 0.5) parts.push(`hue-rotate(${hueDeg.toFixed(1)}deg)`);

  return parts.length ? parts.join(" ") : "none";
}

/** Friendly one-line summary of the active grade for the descriptor strip. */
export function gradeDescriptor(grade: Grade): string {
  const exposure = num(grade, "exposure");
  const contrast = num(grade, "contrast");
  const saturation = num(grade, "saturation");
  const mids = str(grade, "mids");
  const blacks = str(grade, "blacks");
  const shadow = str(grade, "shadow_tint");

  const parts: string[] = [];
  if (exposure !== 0) parts.push(`exposure ${exposure > 0 ? "+" : ""}${exposure.toFixed(2)}`);
  if (contrast !== 0) parts.push(`contrast ${contrast > 0 ? "+" : ""}${contrast}`);
  if (saturation !== 0) parts.push(`saturation ${saturation > 0 ? "+" : ""}${saturation}`);
  if (mids !== "neutral") parts.push(`${mids} mids`);
  if (blacks !== "neutral") parts.push(`${blacks} blacks`);
  if (shadow !== "neutral") parts.push(`${shadow} shadow`);
  return parts.length ? parts.join(" · ") : "no adjustment";
}

/** ffmpeg filter chain that applies the Grade. Uses the built-in `eq`,
 *  `colorbalance`, and `curves` filters — these ship with every ffmpeg-core
 *  wasm build. `lut3d` is NOT in the minimal builds, so the LUT file we used
 *  to write was effectively a no-op (which is why renders looked ungraded). */
export function buildFFmpegGradeFilter(grade: Grade): string {
  const exposure = num(grade, "exposure");
  const contrastPct = num(grade, "contrast");
  const saturationPct = num(grade, "saturation");
  const mids = str(grade, "mids");
  const blacks = str(grade, "blacks");
  const shadowTint = str(grade, "shadow_tint");

  const brightness = Math.max(-1, Math.min(1, exposure * 0.5));
  const contrast = Math.max(0, 1 + contrastPct / 100);
  const saturation = Math.max(0, 1 + saturationPct / 100);
  const eq = `eq=brightness=${brightness.toFixed(3)}:contrast=${contrast.toFixed(3)}:saturation=${saturation.toFixed(3)}`;

  const shadow = TINT_RGB[shadowTint] ?? TINT_RGB.neutral;
  const mid = MID_RGB[mids] ?? MID_RGB.neutral;
  const cb =
    `colorbalance=` +
    `rs=${shadow[0].toFixed(3)}:gs=${shadow[1].toFixed(3)}:bs=${shadow[2].toFixed(3)}:` +
    `rm=${mid[0].toFixed(3)}:gm=${mid[1].toFixed(3)}:bm=${mid[2].toFixed(3)}`;

  let curves = "";
  if (blacks === "crushed") {
    curves = `,curves=all='0/0 0.18/0.10 0.5/0.5 1/1'`;
  } else if (blacks === "lifted") {
    curves = `,curves=all='0/0.05 0.18/0.22 0.5/0.5 1/1'`;
  }

  return `${eq},${cb}${curves}`;
}
