"use client";

// Glue between the digest/vision passes and the timeline: Digest → Storyboard
// cards, and Storyboard → a real Project the editor can open.

import type {
  Digest,
  Project,
  Section,
  Storyboard,
  StoryboardCard,
  Transition,
  VOSegment,
} from "./types";
import type { ShotDescription } from "./vision";

function newId(prefix: string): string {
  const u =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}_${u.slice(0, 8)}`;
}

export function storyboardFromDigest(digest: Digest): Storyboard {
  return {
    source_name: digest.source_name,
    source_duration_s: digest.duration_s,
    mode: digest.mode,
    cards: digest.shots.map((shot, i) => ({
      id: newId("card"),
      title: `Shot ${i + 1}`,
      description: "",
      image_prompt: "",
      motion_prompt: "",
      duration_s: shot.duration_s,
      thumbnail: shot.thumbnail,
      source_start_s: shot.start_s,
      change_score: shot.change_score,
      pointer: shot.pointer,
      described: false,
    })),
  };
}

export function applyDescriptions(
  storyboard: Storyboard,
  descriptions: ShotDescription[],
): Storyboard {
  return {
    ...storyboard,
    cards: storyboard.cards.map((card, i) => {
      const d = descriptions[i];
      if (!d) return card;
      return {
        ...card,
        title: d.title || card.title,
        description: d.description,
        image_prompt: d.image_prompt,
        motion_prompt: d.motion_prompt,
        described: true,
      };
    }),
  };
}

/** Merge a card into the one before it: durations add, text concatenates. */
export function mergeIntoPrevious(storyboard: Storyboard, cardId: string): Storyboard {
  const i = storyboard.cards.findIndex((c) => c.id === cardId);
  if (i <= 0) return storyboard;
  const prev = storyboard.cards[i - 1];
  const cur = storyboard.cards[i];
  const merged: StoryboardCard = {
    ...prev,
    duration_s: Math.round((prev.duration_s + cur.duration_s) * 100) / 100,
    description: [prev.description, cur.description].filter(Boolean).join(" "),
    motion_prompt: [prev.motion_prompt, cur.motion_prompt].filter(Boolean).join(", then "),
  };
  const cards = [...storyboard.cards];
  cards.splice(i - 1, 2, merged);
  return { ...storyboard, cards };
}

export type ProjectFromStoryboardOptions = {
  /**
   * Carry the storyboard's transcript onto the timeline as VO segments. The
   * segments have no output_url — the user generates TTS later, or the render
   * skips them as silent. Defaults to off so existing callers are unchanged.
   */
  voFromTranscript?: boolean;
};

/**
 * Turn the storyboard into a Project the editor can open. Every card becomes
 * a clip section whose still is the source keyframe — so the timeline is
 * previewable immediately — with the card's prompts filled in for regenerating
 * either stage. With `voFromTranscript`, the transcript rides along as VO.
 */
export function projectFromStoryboard(
  storyboard: Storyboard,
  base: Project,
  opts: ProjectFromStoryboardOptions = {},
): Project {
  const sections: Section[] = storyboard.cards.map((card, i) => {
    const sectionId = newId("section");
    const stillId = newId("still");
    const versionId = newId("ver");
    const duration = Math.max(1, Math.round(card.duration_s));
    return {
      id: sectionId,
      index: i + 1,
      type: "clip",
      title: card.title,
      duration_s: duration,
      notes: card.description || undefined,
      stills: [
        {
          id: stillId,
          label: "from video",
          image_prompt: card.image_prompt,
          model: "pollinations",
          input_ref: null,
          output_url: card.thumbnail,
        },
      ],
      active_still_id: stillId,
      versions: [
        {
          id: versionId,
          kind: "clip",
          label: "v1",
          still_ref: stillId,
          motion: {
            prompt: card.motion_prompt,
            model: "ken-burns",
            duration_s: duration,
          },
        },
      ],
      active_version_id: versionId,
    };
  });

  const transitions: Transition[] = [];
  for (let i = 0; i < sections.length - 1; i++) {
    transitions.push({
      id: newId("tr"),
      from_section_id: sections[i].id,
      to_section_id: sections[i + 1].id,
      type: "cut",
      duration_s: 0,
    });
  }

  const duration_s = sections.reduce((acc, s) => acc + s.duration_s, 0);
  const name = storyboard.source_name.replace(/\.[^.]+$/, "") || "Storyboard";

  const vo_segments: VOSegment[] =
    opts.voFromTranscript && storyboard.transcript && storyboard.transcript.length > 0
      ? storyboard.transcript.map((seg) => ({
          id: newId("vo"),
          text: seg.text,
          voice: "default",
          start_s: seg.start_s,
          duration_s: seg.duration_s,
        }))
      : [];

  return {
    ...base,
    id: newId("project"),
    name,
    duration_s,
    status: "draft",
    revision: 1,
    sections,
    transitions,
    vo_segments,
    graphics: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}
