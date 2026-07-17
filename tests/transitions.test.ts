import { describe, expect, it } from "vitest";
import { reconcileTransitions } from "@/lib/store";
import type { Project, Section, Transition } from "@/lib/types";

function section(id: string, index: number): Section {
  return {
    id,
    index,
    type: "clip",
    title: id,
    duration_s: 3,
    versions: [],
    active_version_id: null,
    stills: [],
    active_still_id: null,
  };
}

function project(sections: Section[], transitions: Transition[]): Project {
  return {
    schema_version: 1,
    id: "p1",
    name: "test",
    aspect: "9:16",
    duration_s: sections.length * 3,
    status: "draft",
    revision: 1,
    sections,
    transitions,
    vo_segments: [],
    graphics: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

describe("reconcileTransitions", () => {
  const abc = [section("a", 1), section("b", 2), section("c", 3)];
  const custom: Transition[] = [
    { id: "t1", from_section_id: "a", to_section_id: "b", type: "fade_black", duration_s: 1.2 },
    { id: "t2", from_section_id: "b", to_section_id: "c", type: "cut", duration_s: 0 },
  ];

  it("keeps transitions untouched when order is unchanged", () => {
    const out = reconcileTransitions(project(abc, custom));
    expect(out.transitions).toEqual(custom);
  });

  it("preserves a customized transition when its section moves", () => {
    // a b c  ->  a c b : the boundary into c and into b both survive by
    // to_section_id, with from_section_id rewritten.
    const acb = [section("a", 1), section("c", 2), section("b", 3)];
    const out = reconcileTransitions(project(acb, custom));
    expect(out.transitions).toHaveLength(2);
    const intoC = out.transitions.find((t) => t.to_section_id === "c")!;
    expect(intoC.type).toBe("cut");
    expect(intoC.from_section_id).toBe("a");
    const intoB = out.transitions.find((t) => t.to_section_id === "b")!;
    expect(intoB.type).toBe("fade_black");
    expect(intoB.duration_s).toBe(1.2);
    expect(intoB.from_section_id).toBe("c");
  });

  it("mints a default only for a truly new boundary", () => {
    const abcd = [...abc, section("d", 4)];
    const out = reconcileTransitions(project(abcd, custom));
    expect(out.transitions).toHaveLength(3);
    const intoD = out.transitions.find((t) => t.to_section_id === "d")!;
    expect(intoD.type).toBe("crossfade");
    expect(intoD.duration_s).toBe(0.4);
  });

  it("drops the transition of a removed section", () => {
    const ac = [section("a", 1), section("c", 2)];
    const out = reconcileTransitions(project(ac, custom));
    expect(out.transitions).toHaveLength(1);
    expect(out.transitions[0].to_section_id).toBe("c");
    expect(out.transitions[0].type).toBe("cut");
  });
});
