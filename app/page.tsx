"use client";

import { useEffect, useMemo, useState } from "react";
import { selectActiveSection, useStore } from "@/lib/store";
import type { Project, Section } from "@/lib/types";
import { downloadProjectJSON, pickProjectJSONFile } from "@/lib/serialize";
import {
  DURATION_OPTIONS_S,
  IMAGE_MODELS,
  MOTION_MODELS,
  imageModelCost,
  isImageModelFree,
  isMotionModelFree,
  motionModelCost,
} from "@/lib/models";
import { kenBurnsFromPrompt, newSeed, pollinationsUrl } from "@/lib/generate";

function formatTimecode(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatTransition(type: string, duration: number): string {
  if (type === "cut") return "Cut";
  if (type === "fade_black") return "Fade to black";
  return `Crossfade ${duration.toFixed(1)}s`;
}

function formatInputRef(ref: string | null | undefined): string {
  if (!ref) return "none";
  const m = ref.match(/^section:section_(\d+):last_frame$/);
  if (m) return `${m[1]} last frame`;
  return ref;
}

function formatCost(c: number): string {
  return c >= 1 ? `~ $${c.toFixed(2)}` : `~ $${c.toFixed(3)}`;
}

export default function HomePage() {
  const project = useStore((s) => s.project);
  const activeSectionId = useStore((s) => s.activeSectionId);
  const activeSection = useStore(selectActiveSection);
  const setActiveSection = useStore((s) => s.setActiveSection);
  const setProject = useStore((s) => s.setProject);

  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    Promise.resolve(useStore.persist.rehydrate()).finally(() => setHydrated(true));
  }, []);

  const transitionsByTo = useMemo(() => {
    const m = new Map<string, { label: string; type: string }>();
    for (const t of project.transitions) {
      m.set(t.to_section_id, { label: formatTransition(t.type, t.duration_s), type: t.type });
    }
    return m;
  }, [project.transitions]);

  const clipsCount = project.sections.length;

  const handleExport = () => downloadProjectJSON(project);
  const handleImport = async () => {
    const result = await pickProjectJSONFile();
    if (result.ok) setProject(result.project);
    else alert(result.error);
  };

  return (
    <>
      <div className="statusbar">
        <div className="left">
          <span><span className="dot" />SYSTEM // ONLINE</span>
          <span>BUILD 0.0.1</span>
          <span>FREE PREVIEW · NO KEY NEEDED</span>
        </div>
        <div className="right">
          <span>{hydrated ? "STATE // PERSISTED" : "STATE // EPHEMERAL"}</span>
          <span>HELLO@JOHNLACROIX.COM</span>
        </div>
      </div>

      <div className="wordmark">
        <span className="painted">AI Cinema</span>
        <span className="lockup">by Bloody Finger</span>
      </div>
      <div className="tagline">Cinematic video, made easy. Bring your own model.</div>

      <div className="project-head">
        <div className="project-meta">
          <h1><span className="slash">//</span> {project.name}</h1>
          <div className="specs">
            <span>{project.duration_s.toFixed(1)}s</span>
            <span>{project.aspect.replace(":", " : ")}</span>
            <span>{clipsCount} clips</span>
            <span>v{project.revision} / {project.status}</span>
          </div>
        </div>
        <div className="project-actions">
          <button type="button" className="btn ghost" onClick={handleImport}>Import</button>
          <button type="button" className="btn ghost" onClick={handleExport}>Export</button>
          <button type="button" className="btn">Preview</button>
          <button type="button" className="btn primary">▶︎ Render</button>
        </div>
      </div>

      <div className="lookbar">
        <div className="slot">
          <div className="label">// BRIEF</div>
          <div className="value">{project.brief?.name ?? "—"} <span className="caret">▾</span></div>
        </div>
        <div className="slot">
          <div className="label">// GRADE</div>
          <div className="value">{project.grade?.name ?? "—"} <span className="caret">▾</span></div>
        </div>
        <div className="slot">
          <div className="label">// MUSIC</div>
          <div className="value">{project.music_track?.name ?? "—"} <span className="caret">▾</span></div>
        </div>
        <div className="slot">
          <div className="label">// TITLE STYLE</div>
          <div className="value">{project.title_settings?.name ?? "—"} <span className="caret">▾</span></div>
        </div>
      </div>

      <div className="timeline-wrap">
        <div className="tl-label">
          <span>// TIMELINE</span>
          <span>Click a clip to open the flow · Click ◇ to set transitions</span>
        </div>

        <div className="ruler">
          {Array.from({ length: clipsCount }, (_, i) => (
            <span key={i}>{formatTimecode(i * 3)}</span>
          ))}
        </div>

        <div className="clips-row">
          {project.sections.map((section) => {
            const isActive = section.id === activeSectionId;
            const versionIdx = section.versions.findIndex((v) => v.id === section.active_version_id);
            const empty = versionIdx < 0;
            const versionLabel = empty ? "— not yet" : `v${versionIdx + 1} ▾`;
            const trans = transitionsByTo.get(section.id);
            return (
              <div
                key={section.id}
                className={`clip${isActive ? " active" : ""}${empty ? " empty" : ""}`}
                onClick={() => setActiveSection(section.id)}
              >
                {trans ? (
                  <div
                    className="trans-marker"
                    data-type={trans.type === "crossfade" || trans.type === "fade_black" ? "fade" : undefined}
                    title={trans.label}
                  >
                    ◇
                  </div>
                ) : null}
                <div className="clip-num">{section.index.toString().padStart(2, "0")} // {section.type.toUpperCase()}</div>
                <div className="clip-title">{section.title}</div>
                <div className="clip-meta">
                  <span className="clip-version">{versionLabel}</span>
                  <span className="clip-dur">{section.duration_s.toFixed(1)}s</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="audio-row" style={{ marginTop: 14 }}>
          <div className="track-label">VO</div>
          {project.vo_segments.map((seg, i) => {
            const startCol = Math.floor(seg.start_s / 3) + 1;
            const endCol = startCol + Math.max(1, Math.round(seg.duration_s / 3));
            return (
              <div key={seg.id} className="vo-seg" style={{ gridColumn: `${startCol} / ${endCol}` }}>
                v{i + 1} — <span className="vo-text">&ldquo;{seg.text}&rdquo;</span>
              </div>
            );
          })}
          <div className="vo-seg" style={{ gridColumn: "5 / 7", opacity: 0.5 }}>— pending</div>
        </div>

        <div className="audio-row" style={{ marginTop: 8 }}>
          <div className="track-label">MUSIC</div>
          <div className="music-bed">
            <span>
              <strong>{project.music_track?.name ?? "—"}</strong> · {project.music_track?.model ?? "—"} · v1 · {project.duration_s.toFixed(1)}s · auto-ducks under VO −6dB
            </span>
            <span>♪ ▾</span>
          </div>
        </div>

        <div className="audio-row" style={{ marginTop: 12 }}>
          <div className="grade-strip">
            <span>
              Final pass · <strong>{project.grade?.name ?? "—"}</strong> · exposure +{project.grade?.adjustments.exposure} · contrast +{project.grade?.adjustments.contrast} · warm mids · crushed blacks · teal shadow
            </span>
            <span>⤓ EXPORT LUT</span>
          </div>
        </div>
      </div>

      {activeSection ? <FlowPanel section={activeSection} project={project} /> : null}

      <div className="footstrip">
        <span>// AI CINEMA · BUILT FOR THE LOVE OF THE GAME · MIT</span>
        <span>BLOODY FINGER SOFTWARE — 2026</span>
      </div>
    </>
  );
}

function FlowPanel({ section, project }: { section: Section; project: Project }) {
  const setActiveSection = useStore((s) => s.setActiveSection);
  const setActiveVersion = useStore((s) => s.setActiveVersion);
  const setActiveStill = useStore((s) => s.setActiveStill);
  const updateStill = useStore((s) => s.updateStill);
  const addStill = useStore((s) => s.addStill);
  const removeStill = useStore((s) => s.removeStill);
  const updateClipVersion = useStore((s) => s.updateClipVersion);
  const addClipVersion = useStore((s) => s.addClipVersion);
  const removeClipVersion = useStore((s) => s.removeClipVersion);

  const startTime = (section.index - 1) * 3;
  const activeVersion = section.versions.find((v) => v.id === section.active_version_id);
  const activeStill = section.stills.find((s) => s.id === section.active_still_id);

  const priorClipSections = project.sections.filter(
    (s) => s.type === "clip" && s.index < section.index,
  );

  const referencedStill =
    activeVersion && activeVersion.kind === "clip" && activeVersion.still_ref
      ? section.stills.find((s) => s.id === activeVersion.still_ref) ?? activeStill
      : activeStill;

  const handleGenerateStill = () => {
    if (!activeStill) return;
    if (!isImageModelFree(activeStill.model)) {
      alert(
        `${activeStill.model} needs an API key. Switch to "Pollinations (free)" to generate without one.`,
      );
      return;
    }
    const url = pollinationsUrl(
      activeStill.image_prompt,
      project.aspect,
      newSeed(),
      project.brief?.visual,
    );
    updateStill(section.id, activeStill.id, { output_url: url });
  };

  const handleGenerateMotion = () => {
    if (!activeVersion || activeVersion.kind !== "clip") return;
    if (!isMotionModelFree(activeVersion.motion.model)) {
      alert(
        `${activeVersion.motion.model} needs an API key. Switch to "Ken Burns (free)" to preview motion without one.`,
      );
      return;
    }
    const stillToUse = referencedStill;
    if (stillToUse && !stillToUse.output_url && isImageModelFree(stillToUse.model)) {
      const url = pollinationsUrl(
        stillToUse.image_prompt,
        project.aspect,
        newSeed(),
        project.brief?.visual,
      );
      updateStill(section.id, stillToUse.id, { output_url: url });
    }
    const direction = kenBurnsFromPrompt(activeVersion.motion.prompt);
    updateClipVersion(section.id, activeVersion.id, {
      output_url: `kenburns:${direction}`,
      still_ref: activeVersion.still_ref ?? activeStill?.id ?? null,
    });
  };

  const motionDirection =
    activeVersion && activeVersion.kind === "clip" && activeVersion.output_url?.startsWith("kenburns:")
      ? (activeVersion.output_url.slice("kenburns:".length) as "in" | "out" | "left" | "right")
      : null;

  const motionStillUrl = motionDirection && referencedStill?.output_url ? referencedStill.output_url : null;

  if (section.type === "title") {
    return (
      <div className="flow-panel">
        <div className="flow-head">
          <div className="title">
            <span className="slash">//</span> {section.index.toString().padStart(2, "0")} — {section.title}
            <span className="timecode">{formatTimecode(startTime)} — {formatTimecode(startTime + section.duration_s)}</span>
          </div>
          <div className="right">
            <button type="button" className="btn ghost" onClick={() => setActiveSection(null)}>✕ Close</button>
          </div>
        </div>
        <div className="flow-body" style={{ gridTemplateColumns: "1fr" }}>
          <div className="stage" style={{ paddingLeft: 0, paddingRight: 0, borderRight: "none" }}>
            <div className="stage-title"><span className="num">01</span>TITLE CARD</div>
            <div className="field">
              <div className="field-label">Text</div>
              <div className="field-input tall">
                {activeVersion && activeVersion.kind === "title" ? activeVersion.text : ""}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const stillCost = activeStill ? imageModelCost(activeStill.model) : 0;
  const motionCost = activeVersion && activeVersion.kind === "clip"
    ? motionModelCost(activeVersion.motion.model, activeVersion.motion.duration_s)
    : 0;

  return (
    <div className="flow-panel">
      <div className="flow-head">
        <div className="title">
          <span className="slash">//</span> {section.index.toString().padStart(2, "0")} — {section.title}
          <span className="timecode">{formatTimecode(startTime)} — {formatTimecode(startTime + section.duration_s)}</span>
        </div>
        <div className="right">
          {activeVersion ? (
            <div className="version-dd">
              <span>v{section.versions.findIndex((v) => v.id === activeVersion.id) + 1}</span>
              <span>{activeVersion.label}</span>
              <span className="caret">▾</span>
            </div>
          ) : null}
          <button type="button" className="btn ghost" onClick={() => setActiveSection(null)}>✕ Close</button>
        </div>
      </div>

      <div className="flow-body">
        {/* STAGE 1 — STILL */}
        <div className="stage">
          <div className="stage-title"><span className="num">01</span>STILL</div>

          <div className="field">
            <div className="field-label">Image prompt</div>
            <textarea
              className="field-input tall"
              rows={3}
              value={activeStill?.image_prompt ?? ""}
              disabled={!activeStill}
              placeholder={activeStill ? "" : "+ new still to start"}
              onChange={(e) => activeStill && updateStill(section.id, activeStill.id, { image_prompt: e.target.value })}
            />
          </div>

          <div className="field-row three">
            <div className="field">
              <div className="field-label">Model</div>
              <div className="field-pill">
                <select
                  value={activeStill?.model ?? "flux-1.1-pro"}
                  disabled={!activeStill}
                  onChange={(e) => activeStill && updateStill(section.id, activeStill.id, { model: e.target.value })}
                >
                  {IMAGE_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
                <span className="caret">▾</span>
              </div>
            </div>
            <div className="field">
              <div className="field-label">Input</div>
              <div className="field-pill">
                <select
                  value={activeStill?.input_ref ?? ""}
                  disabled={!activeStill}
                  onChange={(e) => activeStill && updateStill(section.id, activeStill.id, { input_ref: e.target.value || null })}
                >
                  <option value="">none</option>
                  {priorClipSections.map((s) => (
                    <option key={s.id} value={`section:${s.id}:last_frame`}>
                      {s.index.toString().padStart(2, "0")} last frame
                    </option>
                  ))}
                </select>
                <span className="caret">▾</span>
              </div>
            </div>
            <div className="field">
              <div className="field-label">Cost</div>
              <div className="field-pill cost">{formatCost(stillCost)}</div>
            </div>
          </div>

          <div className="preview-row">
            <div className={`preview-box${activeStill?.output_url ? " has-image" : ""}`}>
              {activeStill?.output_url ? (
                <img
                  key={activeStill.output_url}
                  src={activeStill.output_url}
                  alt={activeStill.label}
                  className="preview-img"
                />
              ) : null}
              {activeStill ? (
                <span className="vbadge">s{section.stills.findIndex((s) => s.id === activeStill.id) + 1} · active</span>
              ) : null}
              <span className="play">▶︎</span>
              <span className="time">still</span>
            </div>
            <div className="versions-list">
              {section.stills.map((still, i) => {
                const isActive = still.id === section.active_still_id;
                const canRemove = section.stills.length > 1;
                return (
                  <div
                    key={still.id}
                    className={`vrow${isActive ? " active" : ""}`}
                    onClick={() => setActiveStill(section.id, still.id)}
                  >
                    <div className="vlabel">
                      <span className="vid">s{i + 1}</span>
                      <span className="vdesc">{still.label}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      {canRemove ? (
                        <button
                          type="button"
                          className="vrow-remove"
                          title="Remove still"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeStill(section.id, still.id);
                          }}
                        >
                          ✕
                        </button>
                      ) : null}
                      <span className={`vmark ${isActive ? "active" : "muted"}`}>{isActive ? "●" : "↻"}</span>
                    </div>
                  </div>
                );
              })}
              <div className="vrow add" onClick={() => addStill(section.id)}>+ new still</div>
            </div>
          </div>

          <div className="gen-row">
            <span className="gen-cost">{formatCost(stillCost)} per still</span>
            <button type="button" className="btn primary" disabled={!activeStill} onClick={handleGenerateStill}>
              ⏵ Generate still
            </button>
          </div>
        </div>

        {/* STAGE 2 — MOTION */}
        <div className="stage">
          <div className="stage-title"><span className="num">02</span>MOTION</div>

          <div className="field">
            <div className="field-label">Motion prompt</div>
            <textarea
              className="field-input tall"
              rows={3}
              value={activeVersion && activeVersion.kind === "clip" ? activeVersion.motion.prompt : ""}
              disabled={!activeVersion || activeVersion.kind !== "clip"}
              placeholder={activeVersion ? "" : "+ new version to start"}
              onChange={(e) =>
                activeVersion &&
                activeVersion.kind === "clip" &&
                updateClipVersion(section.id, activeVersion.id, { motion: { prompt: e.target.value } })
              }
            />
          </div>

          <div className="field-row three">
            <div className="field">
              <div className="field-label">Model</div>
              <div className="field-pill">
                <select
                  value={activeVersion && activeVersion.kind === "clip" ? activeVersion.motion.model : "runway-gen4"}
                  disabled={!activeVersion || activeVersion.kind !== "clip"}
                  onChange={(e) =>
                    activeVersion &&
                    activeVersion.kind === "clip" &&
                    updateClipVersion(section.id, activeVersion.id, { motion: { model: e.target.value } })
                  }
                >
                  {MOTION_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
                <span className="caret">▾</span>
              </div>
            </div>
            <div className="field">
              <div className="field-label">Duration</div>
              <div className="field-pill">
                <select
                  value={activeVersion && activeVersion.kind === "clip" ? activeVersion.motion.duration_s : section.duration_s}
                  disabled={!activeVersion || activeVersion.kind !== "clip"}
                  onChange={(e) =>
                    activeVersion &&
                    activeVersion.kind === "clip" &&
                    updateClipVersion(section.id, activeVersion.id, {
                      motion: { duration_s: Number(e.target.value) },
                    })
                  }
                >
                  {DURATION_OPTIONS_S.map((d) => (
                    <option key={d} value={d}>{d.toFixed(1)}s</option>
                  ))}
                </select>
                <span className="caret">▾</span>
              </div>
            </div>
            <div className="field">
              <div className="field-label">Cost</div>
              <div className="field-pill cost">{formatCost(motionCost)}</div>
            </div>
          </div>

          <div className="preview-row">
            <div className={`preview-box motion${motionStillUrl ? " has-image" : ""}`}>
              {motionStillUrl ? (
                <img
                  key={`${motionStillUrl}|${motionDirection}|${activeVersion && activeVersion.kind === "clip" ? activeVersion.motion.duration_s : 0}`}
                  src={motionStillUrl}
                  alt="motion preview"
                  className={`preview-img kb kb-${motionDirection}`}
                  style={{
                    animationDuration: `${
                      activeVersion && activeVersion.kind === "clip" ? activeVersion.motion.duration_s : 3
                    }s`,
                  }}
                />
              ) : null}
              {activeVersion ? (
                <span className="vbadge">v{section.versions.findIndex((v) => v.id === activeVersion.id) + 1} · active</span>
              ) : null}
              <span className="play">▶︎</span>
              <span className="time">0:00 / {activeVersion && activeVersion.kind === "clip" ? activeVersion.motion.duration_s.toFixed(1) : section.duration_s.toFixed(1)}</span>
            </div>
            <div className="versions-list">
              {section.versions.map((v, i) => {
                const isActive = v.id === section.active_version_id;
                const canRemove = section.versions.length > 1;
                return (
                  <div
                    key={v.id}
                    className={`vrow${isActive ? " active" : ""}`}
                    onClick={() => setActiveVersion(section.id, v.id)}
                  >
                    <div className="vlabel">
                      <span className="vid">v{i + 1}</span>
                      <span className="vdesc">{v.label}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      {canRemove ? (
                        <button
                          type="button"
                          className="vrow-remove"
                          title="Remove version"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeClipVersion(section.id, v.id);
                          }}
                        >
                          ✕
                        </button>
                      ) : null}
                      <span className={`vmark ${isActive ? "active" : "muted"}`}>{isActive ? "●" : "↻"}</span>
                    </div>
                  </div>
                );
              })}
              <div className="vrow add" onClick={() => addClipVersion(section.id)}>+ new version</div>
            </div>
          </div>

          <div className="gen-row">
            <span className="gen-cost">{formatCost(motionCost)} per version</span>
            <button
              type="button"
              className="btn primary"
              disabled={!activeVersion}
              onClick={handleGenerateMotion}
            >
              ⏵ Generate motion
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

