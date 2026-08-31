"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Project, Transition } from "@/lib/types";
import { imageModelCost, motionModelCost } from "@/lib/models";
import { describeRenderPlan, renderProject, terminateFFmpeg, type RenderProgress } from "@/lib/render";
import { formatCost, formatTransition } from "@/components/lib";

/* ───────────── RENDER DIALOG ───────────── */

export function RenderDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const sections = project.sections;
  const transitions = project.transitions;
  const trByTo = useMemo(() => {
    const m = new Map<string, Transition>();
    for (const t of transitions) m.set(t.to_section_id, t);
    return m;
  }, [transitions]);

  const renderPlan = useMemo(() => describeRenderPlan(project), [project]);
  const [renderProgress, setRenderProgress] = useState<RenderProgress | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderUrl, setRenderUrl] = useState<string | null>(null);
  const [renderSize, setRenderSize] = useState<number>(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => {
    if (renderUrl) URL.revokeObjectURL(renderUrl);
  }, [renderUrl]);

  const handleRender = async () => {
    if (renderProgress) return;
    setRenderError(null);
    if (renderUrl) URL.revokeObjectURL(renderUrl);
    setRenderUrl(null);
    setRenderSize(0);
    abortRef.current = new AbortController();
    setRenderProgress({ phase: "loading-engine", pct: 0, message: "Starting…" });
    try {
      const result = await renderProject({
        project,
        onProgress: setRenderProgress,
        signal: abortRef.current.signal,
      });
      setRenderUrl(result.url);
      setRenderSize(result.sizeBytes);
      setRenderProgress({ phase: "done", pct: 100, message: "Render complete." });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRenderError(message);
      setRenderProgress(null);
    }
  };

  const handleCancelRender = async () => {
    abortRef.current?.abort();
    await terminateFFmpeg();
    setRenderProgress(null);
    setRenderError("Render cancelled.");
  };

  const handleDownload = () => {
    if (!renderUrl) return;
    const a = document.createElement("a");
    const safe = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "render";
    a.href = renderUrl;
    a.download = `${safe}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const planReady = renderPlan.ready && renderPlan.assets.length > 0;
  const isRunning = renderProgress !== null && renderProgress.phase !== "done";

  let stillCostTotal = 0;
  let motionCostTotal = 0;
  for (const s of sections) {
    if (s.type !== "clip") continue;
    for (const still of s.stills) {
      if (still.output_url) stillCostTotal += imageModelCost(still.model);
    }
    for (const v of s.versions) {
      if (v.kind === "clip" && v.output_url) {
        motionCostTotal += motionModelCost(v.motion.model, v.motion.duration_s);
      }
    }
  }
  const activeMotionCost = sections.reduce((acc, s) => {
    if (s.type !== "clip") return acc;
    const active = s.versions.find((v) => v.id === s.active_version_id);
    if (active && active.kind === "clip") {
      return acc + motionModelCost(active.motion.model, active.motion.duration_s);
    }
    return acc;
  }, 0);
  const activeStillCost = sections.reduce((acc, s) => {
    if (s.type !== "clip") return acc;
    const activeVer = s.versions.find((v) => v.id === s.active_version_id);
    const stillId = activeVer && activeVer.kind === "clip" ? activeVer.still_ref : s.active_still_id;
    const still = stillId ? s.stills.find((st) => st.id === stillId) : null;
    if (still) return acc + imageModelCost(still.model);
    return acc;
  }, 0);

  const readiness = sections.map((s) => {
    if (s.type === "title") {
      const v = s.versions.find((x) => x.id === s.active_version_id);
      const ready = v && v.kind === "title" && v.text.trim().length > 0;
      return { id: s.id, label: s.title, ready, reason: ready ? "graphic text set" : "missing graphic text" };
    }
    const v = s.versions.find((x) => x.id === s.active_version_id);
    if (!v || v.kind !== "clip") {
      return { id: s.id, label: s.title, ready: false, reason: "no active version" };
    }
    if (!v.output_url) {
      return { id: s.id, label: s.title, ready: false, reason: "motion not generated" };
    }
    return { id: s.id, label: s.title, ready: true, reason: "ready" };
  });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-title">// RENDER</div>
            <div className="modal-sub">
              {project.name} · {project.duration_s.toFixed(1)}s · {project.aspect.replace(":", " : ")} · {sections.length} sections
            </div>
          </div>
          <button type="button" className="btn ghost" onClick={onClose}>✕ Close</button>
        </div>

        <div className="modal-body">
          <div className="modal-section">
            <div className="modal-section-title">// SHOT LIST</div>
            <ol className="shot-list">
              {sections.map((s, i) => {
                const r = readiness[i];
                const tr = trByTo.get(s.id);
                const activeVer = s.versions.find((v) => v.id === s.active_version_id);
                const versionLabel =
                  activeVer
                    ? `v${s.versions.findIndex((v) => v.id === activeVer.id) + 1} — ${activeVer.label}`
                    : "—";
                return (
                  <li key={s.id} className={`shot-row ${r.ready ? "ok" : "miss"}`}>
                    <span className="shot-idx">{s.index.toString().padStart(2, "0")}</span>
                    <span className="shot-type">{s.type.toUpperCase()}</span>
                    <span className="shot-title">{s.title}</span>
                    <span className="shot-version">{versionLabel}</span>
                    <span className="shot-dur">{s.duration_s.toFixed(1)}s</span>
                    <span className="shot-trans">
                      {tr ? formatTransition(tr.type, tr.duration_s) : "—"}
                    </span>
                    <span className={`shot-status ${r.ready ? "ok" : "miss"}`}>
                      {r.ready ? "● ready" : "○ " + r.reason}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>

          <div className="modal-section">
            <div className="modal-section-title">// AUDIO</div>
            <div className="audio-summary">
              <div className="audio-line">
                <span className="al-label">VO</span>
                <span className="al-value">
                  {project.vo_segments.length} segment{project.vo_segments.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="audio-line">
                <span className="al-label">Music</span>
                <span className="al-value">
                  {project.music_track?.name ?? "—"} · {project.music_track?.model ?? "—"}
                </span>
              </div>
              <div className="audio-line">
                <span className="al-label">Grade</span>
                <span className="al-value">{project.grade?.name ?? "—"}</span>
              </div>
              <div className="audio-line">
                <span className="al-label">Brief</span>
                <span className="al-value">{project.brief?.name ?? "—"}</span>
              </div>
            </div>
          </div>

          <div className="modal-section">
            <div className="modal-section-title">// COST</div>
            <div className="cost-grid">
              <div>
                <div className="cost-label">Stills (active)</div>
                <div className="cost-value">{formatCost(activeStillCost)}</div>
              </div>
              <div>
                <div className="cost-label">Motion (active)</div>
                <div className="cost-value">{formatCost(activeMotionCost)}</div>
              </div>
              <div>
                <div className="cost-label">Spent total</div>
                <div className="cost-value muted">
                  {formatCost(stillCostTotal + motionCostTotal)}
                </div>
              </div>
            </div>
          </div>
        </div>

        {renderProgress || renderError || renderUrl ? (
          <div className="modal-section render-status-section">
            <div className="modal-section-title">// RENDER</div>
            {renderError ? (
              <div className="render-error">
                <strong>Render failed.</strong>
                <span>{renderError}</span>
              </div>
            ) : null}
            {renderProgress && !renderError ? (
              <>
                <div className="render-bar">
                  <div className="render-bar-fill" style={{ width: `${renderProgress.pct}%` }} />
                </div>
                <div className="render-progress-row">
                  <span>{renderProgress.phase.replace(/-/g, " ")}</span>
                  <span>{renderProgress.message}</span>
                  <span>{renderProgress.pct}%</span>
                </div>
              </>
            ) : null}
            {renderUrl ? (
              <div className="render-output">
                <video src={renderUrl} controls className="render-video" />
                <div className="render-meta">
                  <span>{(renderSize / (1024 * 1024)).toFixed(2)} MB</span>
                  <button type="button" className="btn primary" onClick={handleDownload}>
                    ⤓ Download MP4
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="modal-foot">
          <span className={`render-status ${planReady ? "ok" : "miss"}`}>
            {planReady
              ? `Plan ready · ${renderPlan.assets.length} segment${renderPlan.assets.length === 1 ? "" : "s"} · ${renderPlan.totalDuration.toFixed(1)}s`
              : renderPlan.issues.length > 0
                ? (() => {
                    const counts = new Map<string, number>();
                    for (const i of renderPlan.issues) {
                      counts.set(i.reason, (counts.get(i.reason) ?? 0) + 1);
                    }
                    const parts = Array.from(counts.entries()).map(
                      ([reason, n]) => `${n} ${reason}`,
                    );
                    return `${renderPlan.issues.length} section${renderPlan.issues.length === 1 ? "" : "s"} not renderable yet — ${parts.join(" · ")}`;
                  })()
                : "No assets to render"}
          </span>
          <div style={{ display: "flex", gap: 10 }}>
            {isRunning ? (
              <button type="button" className="btn ghost" onClick={handleCancelRender}>
                ■ Cancel render
              </button>
            ) : (
              <button type="button" className="btn ghost" onClick={onClose}>Close</button>
            )}
            <button
              type="button"
              className="btn primary"
              disabled={!planReady || isRunning}
              onClick={handleRender}
              title={
                planReady
                  ? "Concatenate active assets with ffmpeg.wasm and produce an MP4"
                  : renderPlan.issues.map((i) => `${i.title}: ${i.reason}`).join(" · ")
              }
            >
              {isRunning
                ? "● Rendering…"
                : renderUrl
                  ? "↻ Re-render"
                  : "⤓ Render MP4"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
