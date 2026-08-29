import { describe, expect, it } from "vitest";

import { exportProjectJSON, importProjectJSON } from "@/lib/serialize";
import type { Project } from "@/lib/types";

function makeProject(): Project {
  return {
    schema_version: 1,
    id: "project_abc123",
    name: "Launch Teaser",
    aspect: "9:16",
    duration_s: 8,
    status: "draft",
    revision: 2,
    sections: [
      {
        id: "section_1",
        index: 1,
        type: "clip",
        title: "Opening",
        duration_s: 8,
        notes: "The hero shot.",
        stills: [
          {
            id: "still_1",
            label: "v1",
            image_prompt: "a lighthouse at dawn",
            model: "pollinations",
            input_ref: null,
            output_url: "data:image/jpeg;base64,AAA",
          },
        ],
        active_still_id: "still_1",
        versions: [
          {
            id: "ver_1",
            kind: "clip",
            label: "v1",
            still_ref: "still_1",
            motion: { prompt: "slow pan right", model: "ken-burns", duration_s: 8 },
          },
        ],
        active_version_id: "ver_1",
      },
    ],
    transitions: [],
    vo_segments: [
      { id: "vo_1", text: "Coming soon.", voice: "narrator", start_s: 0, duration_s: 2 },
    ],
    graphics: [],
    grade: { id: "grade_1", name: "Teal & Orange", adjustments: { contrast: 15, shadow_tint: "teal" } },
    created_at: "2026-08-01T12:00:00.000Z",
    updated_at: "2026-08-02T09:30:00.000Z",
  };
}

describe("export/import round-trip", () => {
  it("preserves a project exactly", () => {
    const project = makeProject();
    const json = exportProjectJSON(project);
    const result = importProjectJSON(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.project).toEqual(project);
      expect(result.project).not.toBe(project); // a fresh parse, not the same reference
    }
  });

  it("exports human-readable pretty-printed JSON", () => {
    const json = exportProjectJSON(makeProject());
    expect(json).toContain("\n");
    expect(JSON.parse(json).id).toBe("project_abc123");
  });
});

describe("importProjectJSON rejection", () => {
  it("rejects malformed JSON with an error result (does not throw)", () => {
    const result = importProjectJSON("{ not json");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Invalid JSON");
  });

  it("rejects non-object roots", () => {
    for (const text of ["42", '"hello"', "null", "true"]) {
      const result = importProjectJSON(text);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("Project JSON must be an object");
    }
  });

  it("rejects an unsupported or missing schema_version", () => {
    const wrong = importProjectJSON(JSON.stringify({ ...makeProject(), schema_version: 2 }));
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error).toContain("Unsupported schema_version: 2");

    const { schema_version: _dropped, ...rest } = makeProject();
    const missing = importProjectJSON(JSON.stringify(rest));
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toContain("Unsupported schema_version: undefined");
  });

  it("rejects projects missing required fields, naming the field", () => {
    for (const key of ["id", "name", "aspect", "sections", "transitions"] as const) {
      const broken: Record<string, unknown> = { ...makeProject() };
      delete broken[key];
      const result = importProjectJSON(JSON.stringify(broken));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe(`Missing required field: ${key}`);
    }
  });

  it("rejects a non-array sections field", () => {
    const result = importProjectJSON(JSON.stringify({ ...makeProject(), sections: {} }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("sections must be an array");
  });
});
