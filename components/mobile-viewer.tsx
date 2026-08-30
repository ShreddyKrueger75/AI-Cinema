"use client";

import { useState } from "react";
import type { Project } from "@/lib/types";

/* ───────────── MOBILE VIEWER (read-only, <900px) ───────────── */

export function MobileViewer({ project }: { project: Project }) {
  const [noteDismissed, setNoteDismissed] = useState(false);
  return (
    <div className="mobile-viewer">
      {!noteDismissed ? (
        <div className="mv-note">
          <span>
            // BEST ON DESKTOP — editing needs a 900px-wide window. This is a read-only view.
          </span>
          <button
            type="button"
            className="mv-note-close"
            onClick={() => setNoteDismissed(true)}
            aria-label="Dismiss desktop note"
          >
            ✕
          </button>
        </div>
      ) : null}

      <div className="mv-brand"><span className="ai">AI</span> Cinema</div>
      <h1 className="mv-name">
        <span className="slash">//</span> {project.name}
      </h1>
      <div className="mv-specs">
        <span>{project.duration_s.toFixed(1)}s</span>
        <span>{project.aspect.replace(":", " : ")}</span>
        <span>{project.sections.length} section{project.sections.length === 1 ? "" : "s"}</span>
      </div>

      <div className="lib-section-title">// SECTIONS</div>
      <div className="mv-list">
        {project.sections.map((s) => {
          const activeStill = s.stills.find((st) => st.id === s.active_still_id);
          return (
            <div key={s.id} className="mv-row">
              {activeStill?.output_url ? (
                <img className="mv-thumb" src={activeStill.output_url} alt="" />
              ) : (
                <div className="mv-thumb empty" aria-hidden>
                  {s.type === "title" ? "T" : "—"}
                </div>
              )}
              <div className="mv-row-body">
                <div className="mv-row-title">
                  {s.index.toString().padStart(2, "0")} — {s.title}
                </div>
                <div className="mv-row-meta">
                  {s.type.toUpperCase()} · {s.duration_s.toFixed(1)}s
                </div>
              </div>
            </div>
          );
        })}
        {project.sections.length === 0 ? (
          <div className="mv-empty">NO SECTIONS YET</div>
        ) : null}
      </div>

      <div className="lib-section-title">// AUDIO</div>
      <div className="mv-audio">
        <span>
          {project.vo_segments.length} VO LINE{project.vo_segments.length === 1 ? "" : "S"}
        </span>
        {project.music_track ? <span>MUSIC · {project.music_track.name}</span> : null}
      </div>
    </div>
  );
}
