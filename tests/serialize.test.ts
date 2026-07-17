import { describe, expect, it } from "vitest";
import { importProjectJSON } from "@/lib/serialize";

const valid = JSON.stringify({
  schema_version: 1,
  id: "p1",
  name: "test",
  aspect: "9:16",
  sections: [],
  transitions: [],
});

describe("importProjectJSON", () => {
  it("accepts a minimal valid project", () => {
    expect(importProjectJSON(valid).ok).toBe(true);
  });

  it("rejects malformed JSON", () => {
    const r = importProjectJSON("{nope");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Invalid JSON/);
  });

  it("rejects non-object roots", () => {
    expect(importProjectJSON("42").ok).toBe(false);
    expect(importProjectJSON("null").ok).toBe(false);
  });

  it("rejects unsupported schema versions", () => {
    const r = importProjectJSON(JSON.stringify({ schema_version: 2 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/schema_version/);
  });

  it("rejects missing required fields", () => {
    const r = importProjectJSON(JSON.stringify({ schema_version: 1, id: "x" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Missing required field/);
  });

  it("rejects non-array sections", () => {
    const r = importProjectJSON(
      JSON.stringify({ schema_version: 1, id: "x", name: "n", aspect: "1:1", sections: {}, transitions: [] }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/sections/);
  });
});
