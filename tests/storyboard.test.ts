import { describe, expect, it } from "vitest";

import {
  applyDescriptions,
  mergeIntoPrevious,
  projectFromStoryboard,
  storyboardFromDigest,
} from "@/lib/storyboard";
import type { Digest, Project } from "@/lib/types";

function makeDigest(): Digest {
  return {
    source_name: "demo.mp4",
    duration_s: 12,
    width: 1920,
    height: 1080,
    mode: "standard",
    sampled_frames: 24,
    shots: [
      {
        id: "shot_a",
        start_s: 0,
        duration_s: 4.5,
        thumbnail: "data:image/jpeg;base64,AAA",
        change_score: 0,
        pointer: null,
      },
      {
        id: "shot_b",
        start_s: 4.5,
        duration_s: 3.25,
        thumbnail: "data:image/jpeg;base64,BBB",
        change_score: 2.5,
        pointer: { nx: 0.5, ny: 0.5, region: "center", changed_fraction: 0.1 },
      },
      {
        id: "shot_c",
        start_s: 7.75,
        duration_s: 4.25,
        thumbnail: "data:image/jpeg;base64,CCC",
        change_score: 1.8,
        pointer: null,
      },
    ],
  };
}

function makeBaseProject(): Project {
  return {
    schema_version: 1,
    id: "project_base",
    name: "Base",
    aspect: "16:9",
    duration_s: 0,
    status: "draft",
    revision: 3,
    sections: [],
    transitions: [],
    vo_segments: [],
    graphics: [],
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("storyboardFromDigest", () => {
  it("makes one card per shot and carries source metadata", () => {
    const digest = makeDigest();
    const sb = storyboardFromDigest(digest);
    expect(sb.cards).toHaveLength(3);
    expect(sb.source_name).toBe("demo.mp4");
    expect(sb.source_duration_s).toBe(12);
    expect(sb.mode).toBe("standard");
  });

  it("numbers titles in order and preserves per-shot fields", () => {
    const digest = makeDigest();
    const sb = storyboardFromDigest(digest);
    expect(sb.cards.map((c) => c.title)).toEqual(["Shot 1", "Shot 2", "Shot 3"]);
    sb.cards.forEach((card, i) => {
      const shot = digest.shots[i];
      expect(card.duration_s).toBe(shot.duration_s);
      expect(card.thumbnail).toBe(shot.thumbnail);
      expect(card.source_start_s).toBe(shot.start_s);
      expect(card.change_score).toBe(shot.change_score);
      expect(card.pointer).toEqual(shot.pointer);
    });
  });

  it("starts cards undescribed with empty text and prompts", () => {
    const sb = storyboardFromDigest(makeDigest());
    for (const card of sb.cards) {
      expect(card.described).toBe(false);
      expect(card.description).toBe("");
      expect(card.image_prompt).toBe("");
      expect(card.motion_prompt).toBe("");
    }
  });
});

describe("applyDescriptions", () => {
  it("writes text and prompts onto cards by index and marks them described", () => {
    const sb = storyboardFromDigest(makeDigest());
    const out = applyDescriptions(sb, [
      {
        title: "Opening wide",
        description: "A city skyline at dusk.",
        image_prompt: "city skyline, dusk, cinematic",
        motion_prompt: "slow push in",
      },
    ]);
    expect(out.cards[0].title).toBe("Opening wide");
    expect(out.cards[0].description).toBe("A city skyline at dusk.");
    expect(out.cards[0].image_prompt).toBe("city skyline, dusk, cinematic");
    expect(out.cards[0].motion_prompt).toBe("slow push in");
    expect(out.cards[0].described).toBe(true);
    // Cards without a matching description are untouched.
    expect(out.cards[1]).toEqual(sb.cards[1]);
    expect(out.cards[2]).toEqual(sb.cards[2]);
  });

  it("keeps the original title when the description's title is empty", () => {
    const sb = storyboardFromDigest(makeDigest());
    const out = applyDescriptions(sb, [
      { title: "", description: "desc", image_prompt: "ip", motion_prompt: "mp" },
    ]);
    expect(out.cards[0].title).toBe("Shot 1");
    expect(out.cards[0].described).toBe(true);
  });
});

describe("mergeIntoPrevious", () => {
  it("sums durations and concatenates text into the previous card", () => {
    const sb = applyDescriptions(storyboardFromDigest(makeDigest()), [
      { title: "One", description: "First.", image_prompt: "a", motion_prompt: "pan left" },
      { title: "Two", description: "Second.", image_prompt: "b", motion_prompt: "tilt up" },
    ]);
    const out = mergeIntoPrevious(sb, sb.cards[1].id);
    expect(out.cards).toHaveLength(2);
    expect(out.cards[0].duration_s).toBe(7.75); // 4.5 + 3.25
    expect(out.cards[0].description).toBe("First. Second.");
    expect(out.cards[0].motion_prompt).toBe("pan left, then tilt up");
    expect(out.cards[0].title).toBe("One"); // keeps the previous card's identity
    expect(out.cards[1].id).toBe(sb.cards[2].id);
  });

  it("returns the storyboard unchanged for the first card or an unknown id", () => {
    const sb = storyboardFromDigest(makeDigest());
    expect(mergeIntoPrevious(sb, sb.cards[0].id)).toBe(sb);
    expect(mergeIntoPrevious(sb, "card_nope")).toBe(sb);
  });
});

describe("projectFromStoryboard", () => {
  function makeStoryboard() {
    return applyDescriptions(storyboardFromDigest(makeDigest()), [
      { title: "One", description: "First shot.", image_prompt: "prompt one", motion_prompt: "motion one" },
      { title: "Two", description: "Second shot.", image_prompt: "prompt two", motion_prompt: "motion two" },
      { title: "Three", description: "Third shot.", image_prompt: "prompt three", motion_prompt: "motion three" },
    ]);
  }

  it("creates one clip section per card, in order", () => {
    const project = projectFromStoryboard(makeStoryboard(), makeBaseProject());
    expect(project.sections).toHaveLength(3);
    expect(project.sections.map((s) => s.title)).toEqual(["One", "Two", "Three"]);
    expect(project.sections.map((s) => s.index)).toEqual([1, 2, 3]);
    expect(project.sections.every((s) => s.type === "clip")).toBe(true);
  });

  it("rounds section durations to whole seconds with a 1s floor", () => {
    const project = projectFromStoryboard(makeStoryboard(), makeBaseProject());
    // 4.5 → 5, 3.25 → 3, 4.25 → 4
    expect(project.sections.map((s) => s.duration_s)).toEqual([5, 3, 4]);

    const tiny = makeStoryboard();
    tiny.cards[0].duration_s = 0.3;
    const clamped = projectFromStoryboard(tiny, makeBaseProject());
    expect(clamped.sections[0].duration_s).toBe(1);
  });

  it("sets project duration to the sum of section durations", () => {
    const project = projectFromStoryboard(makeStoryboard(), makeBaseProject());
    const sum = project.sections.reduce((acc, s) => acc + s.duration_s, 0);
    expect(project.duration_s).toBe(sum);
    expect(project.duration_s).toBe(12);
  });

  it("lands prompts in stills and motion, and description in notes", () => {
    const sb = makeStoryboard();
    const project = projectFromStoryboard(sb, makeBaseProject());
    project.sections.forEach((section, i) => {
      const card = sb.cards[i];
      expect(section.notes).toBe(card.description);
      expect(section.stills).toHaveLength(1);
      expect(section.stills[0].image_prompt).toBe(card.image_prompt);
      expect(section.stills[0].output_url).toBe(card.thumbnail);
      expect(section.active_still_id).toBe(section.stills[0].id);
      expect(section.versions).toHaveLength(1);
      const version = section.versions[0];
      expect(version.kind).toBe("clip");
      if (version.kind === "clip") {
        expect(version.motion.prompt).toBe(card.motion_prompt);
        expect(version.motion.duration_s).toBe(section.duration_s);
        expect(version.still_ref).toBe(section.stills[0].id);
      }
      expect(section.active_version_id).toBe(section.versions[0].id);
    });
  });

  it("omits notes for cards with no description", () => {
    const sb = storyboardFromDigest(makeDigest()); // all descriptions empty
    const project = projectFromStoryboard(sb, makeBaseProject());
    for (const section of project.sections) {
      expect(section.notes).toBeUndefined();
    }
  });

  it("reconciles transitions to chain consecutive sections as cuts", () => {
    const project = projectFromStoryboard(makeStoryboard(), makeBaseProject());
    expect(project.transitions).toHaveLength(project.sections.length - 1);
    project.transitions.forEach((t, i) => {
      expect(t.from_section_id).toBe(project.sections[i].id);
      expect(t.to_section_id).toBe(project.sections[i + 1].id);
      expect(t.type).toBe("cut");
      expect(t.duration_s).toBe(0);
    });
  });

  it("names the project after the source file and resets draft state", () => {
    const base = makeBaseProject();
    const project = projectFromStoryboard(makeStoryboard(), base);
    expect(project.name).toBe("demo"); // extension stripped
    expect(project.id).not.toBe(base.id);
    expect(project.status).toBe("draft");
    expect(project.revision).toBe(1);
    expect(project.aspect).toBe(base.aspect); // carried over from the base
    expect(project.vo_segments).toEqual([]);
    expect(project.graphics).toEqual([]);
  });
});
