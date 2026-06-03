"use client";

import { useEffect, useMemo, useState } from "react";
import { selectActiveSection, useStore } from "@/lib/store";
import type { Section, Still } from "@/lib/types";
import { downloadProjectJSON, pickProjectJSONFile } from "@/lib/serialize";

function formatTimecode(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function transitionTitle(type: string, duration: number): string {
  if (type === "cut") return "Cut";
  if (type === "fade_black") return "Fade to black";
  return `Crossfade ${duration.toFixed(1)}s`;
}

export default function HomePage() {
  const project = useStore((s) => s.project);
  const activeSectionId = useStore((s) => s.activeSectionId);
  const activeSection = useStore(selectActiveSection);
  const setActiveSection = useStore((s) => s.setActiveSection);
  const setActiveVersion = useStore((s) => s.setActiveVersion);
  const setActiveStill = useStore((s) => s.setActiveStill);
  const setProject = useStore((s) => s.setProject);

  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    Promise.resolve(useStore.persist.rehydrate()).finally(() => setHydrated(true));
  }, []);

  const transitionsByTo = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of project.transitions) m.set(t.to_section_id, transitionTitle(t.type, t.duration_s));
    return m;
  }, [project.transitions]);

  const transitionTypeByTo = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of project.transitions) m.set(t.to_section_id, t.type);
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
      {/* STATUS */}
      <div className="statusbar">
        <div className="left">
          <span><span className="dot" />SYSTEM // ONLINE</span>
          <span>BUILD 0.0.1 — MOCKUP</span>
          <span>BYOM — KEYS LOCAL</span>
        </div>
        <div className="right">
          <span>{hydrated ? "STATE // PERSISTED" : "STATE // EPHEMERAL"}</span>
          <span>HELLO@JOHNLACROIX.COM</span>
        </div>
      </div>

      {/* WORDMARK */}
      <div className="wordmark">
        <span className="painted">AI Cinema</span>
        <span className="lockup">by Bloody Finger</span>
      </div>
      <div className="tagline">Cinematic video, made easy. Bring your own model.</div>

      {/* PROJECT HEADER */}
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

      {/* LOOK BAR */}
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

      {/* TIMELINE */}
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
            const transType = transitionTypeByTo.get(section.id);
            return (
              <div
                key={section.id}
                className={`clip${isActive ? " active" : ""}${empty ? " empty" : ""}`}
                onClick={() => setActiveSection(section.id)}
              >
                {trans ? (
                  <div
                    className="trans-marker"
                    data-type={transType === "crossfade" || transType === "fade_black" ? "fade" : undefined}
                    title={trans}
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

      {/* FLOW PANEL */}
      {activeSection ? (
        <FlowPanel
          section={activeSection}
          startTime={(activeSection.index - 1) * 3}
          onClose={() => setActiveSection(null)}
          onSelectVersion={(vid) => setActiveVersion(activeSection.id, vid)}
          onSelectStill={(sid) => setActiveStill(activeSection.id, sid)}
        />
      ) : null}

      {/* FOOTER */}
      <div className="footstrip">
        <span>// AI CINEMA · BUILT FOR THE LOVE OF THE GAME · MIT</span>
        <span>BLOODY FINGER SOFTWARE — 2026</span>
      </div>
    </>
  );
}

function FlowPanel({
  section,
  startTime,
  onClose,
  onSelectVersion,
  onSelectStill,
}: {
  section: Section;
  startTime: number;
  onClose: () => void;
  onSelectVersion: (id: string) => void;
  onSelectStill: (id: string) => void;
}) {
  const activeVersion = section.versions.find((v) => v.id === section.active_version_id);
  const activeStill = section.stills.find((s) => s.id === section.active_still_id);

  if (section.type === "title") {
    return (
      <div className="flow-panel">
        <div className="flow-head">
          <div className="title">
            <span className="slash">//</span> {section.index.toString().padStart(2, "0")} — {section.title}
            <span className="timecode">{formatTimecode(startTime)} — {formatTimecode(startTime + section.duration_s)}</span>
          </div>
          <div className="right">
            <button type="button" className="btn ghost" onClick={onClose}>✕ Close</button>
          </div>
        </div>
        <div className="flow-body" style={{ gridTemplateColumns: "1fr" }}>
          <div className="stage" style={{ paddingLeft: 0, paddingRight: 0, borderRight: "none" }}>
            <div className="stage-title"><span className="num">01</span>TITLE CARD</div>
            <div className="field">
              <div className="field-label">Text</div>
              <div className="field-input tall">{activeVersion && "text" in activeVersion ? activeVersion.text : ""}</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

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
          <button type="button" className="btn ghost" onClick={onClose}>✕ Close</button>
        </div>
      </div>

      <div className="flow-body">
        {/* STAGE 1 — STILL */}
        <div className="stage">
          <div className="stage-title"><span className="num">01</span>STILL</div>

          <div className="field">
            <div className="field-label">Image prompt</div>
            <div className="field-input tall">{activeStill?.image_prompt ?? "—"}</div>
          </div>

          <div className="field-row three">
            <div className="field">
              <div className="field-label">Model</div>
              <div className="field-pill">{activeStill?.model ?? "—"} <span className="caret">▾</span></div>
            </div>
            <div className="field">
              <div className="field-label">Input</div>
              <div className="field-pill">{formatInputRef(activeStill?.input_ref)} <span className="caret">▾</span></div>
            </div>
            <div className="field">
              <div className="field-label">Cost</div>
              <div className="field-pill cost">~ $0.04</div>
            </div>
          </div>

          <div className="preview-row">
            <div className="preview-box">
              {activeStill ? <span className="vbadge">{stillBadge(section, activeStill)} · active</span> : null}
              <span className="play">▶︎</span>
              <span className="time">still</span>
            </div>
            <div className="versions-list">
              {section.stills.map((still, i) => {
                const isActive = still.id === section.active_still_id;
                return (
                  <div
                    key={still.id}
                    className={`vrow${isActive ? " active" : ""}`}
                    onClick={() => onSelectStill(still.id)}
                  >
                    <div className="vlabel">
                      <span className="vid">s{i + 1}</span>
                      <span className="vdesc">{still.label}</span>
                    </div>
                    <span className={`vmark ${isActive ? "active" : "muted"}`}>{isActive ? "●" : "↻"}</span>
                  </div>
                );
              })}
              <div className="vrow add">+ new still</div>
            </div>
          </div>

          <div className="gen-row">
            <span className="gen-cost">~ $0.04 per still</span>
            <button type="button" className="btn primary">⏵ Generate still</button>
          </div>
        </div>

        {/* STAGE 2 — MOTION */}
        <div className="stage">
          <div className="stage-title"><span className="num">02</span>MOTION</div>

          <div className="field">
            <div className="field-label">Motion prompt</div>
            <div className="field-input tall">
              {activeVersion && "motion" in activeVersion ? activeVersion.motion.prompt : "—"}
            </div>
          </div>

          <div className="field-row three">
            <div className="field">
              <div className="field-label">Model</div>
              <div className="field-pill">
                {activeVersion && "motion" in activeVersion ? activeVersion.motion.model : "—"} <span className="caret">▾</span>
              </div>
            </div>
            <div className="field">
              <div className="field-label">Duration</div>
              <div className="field-pill">
                {activeVersion && "motion" in activeVersion ? activeVersion.motion.duration_s.toFixed(1) : "—"}s{" "}
                <span className="caret">▾</span>
              </div>
            </div>
            <div className="field">
              <div className="field-label">Cost</div>
              <div className="field-pill cost">~ $1.20</div>
            </div>
          </div>

          <div className="preview-row">
            <div className="preview-box motion">
              {activeVersion ? (
                <span className="vbadge">v{section.versions.findIndex((v) => v.id === activeVersion.id) + 1} · active</span>
              ) : null}
              <span className="play">▶︎</span>
              <span className="time">0:00 / {section.duration_s.toFixed(1)}</span>
            </div>
            <div className="versions-list">
              {section.versions.map((v, i) => {
                const isActive = v.id === section.active_version_id;
                return (
                  <div
                    key={v.id}
                    className={`vrow${isActive ? " active" : ""}`}
                    onClick={() => onSelectVersion(v.id)}
                  >
                    <div className="vlabel">
                      <span className="vid">v{i + 1}</span>
                      <span className="vdesc">{v.label}</span>
                    </div>
                    <span className={`vmark ${isActive ? "active" : "muted"}`}>{isActive ? "●" : "↻"}</span>
                  </div>
                );
              })}
              <div className="vrow add">+ new version</div>
            </div>
          </div>

          <div className="gen-row">
            <span className="gen-cost">~ $1.20 per version · project total $4.80 of $20.00 cap</span>
            <button type="button" className="btn primary">⏵ Generate v{section.versions.length + 1}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatInputRef(ref: string | null | undefined): string {
  if (!ref) return "none";
  const m = ref.match(/^section:section_(\d+):last_frame$/);
  if (m) return `${m[1]} last frame`;
  return ref;
}

function stillBadge(section: Section, still: Still): string {
  const i = section.stills.findIndex((s) => s.id === still.id);
  return `s${i + 1}`;
}
