"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Aspect, Brief, Grade, Project, Transition } from "@/lib/types";
import { confirmAsk } from "@/lib/confirm";
import { PROVIDERS, maskKey, type ProviderId } from "@/lib/providers";
import {
  describeRenderPlan,
  renderProject,
  terminateFFmpeg,
  type RenderProgress,
} from "@/lib/render";
import { imageModelCost, motionModelCost } from "@/lib/models";
import { formatCost, formatTransition } from "@/components/primitives";

type PaletteAction = {
  id: string;
  label: string;
  keywords?: string;
  run: () => void;
};

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

export function CommandPalette({
  actions,
  onClose,
}: {
  actions: PaletteAction[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions.slice(0, 60);
    const tokens = q.split(/\s+/);
    return actions
      .map((a) => {
        const hay = `${a.label} ${a.keywords ?? ""}`.toLowerCase();
        let score = 0;
        for (const t of tokens) {
          const idx = hay.indexOf(t);
          if (idx < 0) return null;
          score += 100 - Math.min(99, idx);
        }
        return { a, score };
      })
      .filter((x): x is { a: PaletteAction; score: number } => x !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 60)
      .map((x) => x.a);
  }, [query, actions]);

  useEffect(() => {
    setHighlightIdx(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${highlightIdx}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightIdx]);

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()} role="dialog">
        <input
          autoFocus
          className="palette-input"
          type="text"
          placeholder="Type a command…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlightIdx((i) => Math.min(filtered.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlightIdx((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const action = filtered[highlightIdx];
              if (action) {
                action.run();
                onClose();
              }
            }
          }}
        />
        <div className="palette-list" ref={listRef}>
          {filtered.length === 0 ? (
            <div className="palette-empty">No matches</div>
          ) : (
            filtered.map((a, i) => (
              <button
                key={a.id}
                data-idx={i}
                type="button"
                className={`palette-item ${i === highlightIdx ? "active" : ""}`}
                onMouseEnter={() => setHighlightIdx(i)}
                onClick={() => {
                  a.run();
                  onClose();
                }}
              >
                {a.label}
              </button>
            ))
          )}
        </div>
        <div className="palette-foot">
          <span>↑↓ navigate</span>
          <span>↵ run</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}

export function HelpDialog({ onClose }: { onClose: () => void }) {
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || "");
  const mod = isMac ? "⌘" : "Ctrl";
  const shortcutGroups: { title: string; items: { keys: string[]; label: string }[] }[] = [
    {
      title: "Editing",
      items: [
        { keys: [`${mod} Z`], label: "Undo" },
        { keys: [`⇧ ${mod} Z`, `${mod} Y`], label: "Redo" },
        { keys: [`${mod} S`], label: "Save project to library" },
        { keys: ["D"], label: "Duplicate active section" },
        { keys: ["Del", "⌫"], label: "Remove active section" },
      ],
    },
    {
      title: "Navigation",
      items: [
        { keys: ["←"], label: "Previous section" },
        { keys: ["→"], label: "Next section" },
        { keys: ["Esc"], label: "Close panel / dialog" },
      ],
    },
    {
      title: "Playback & command",
      items: [
        { keys: ["Space"], label: "Preview / stop timeline" },
        { keys: [`${mod} K`], label: "Command palette" },
        { keys: ["?", "/"], label: "Open this dialog" },
      ],
    },
  ];
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760 }}>
        <div className="modal-head">
          <div>
            <div className="modal-title">// HELP</div>
            <div className="modal-sub">How AI Cinema works · keys live in your browser · free to use</div>
          </div>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Close help">✕ Close</button>
        </div>
        <div className="modal-body help-body">
          <div className="modal-section">
            <div className="modal-section-title">// GETTING STARTED</div>
            <ol className="help-list">
              <li><strong>Pick a template</strong> in the // TEMPLATES list on the right sidebar — or start blank.</li>
              <li><strong>Set your aspect</strong> in // PROJECT SETTINGS (9:16 vertical, 16:9 wide, 1:1 square). All generation respects this.</li>
              <li><strong>Click any section</strong> on the timeline. The scene editor opens as a modal with two sides — STILL on the left, MOTION on the right.</li>
              <li><strong>Write a still prompt</strong>, pick a model, hit <span className="kbd">✦ Generate still</span>. Free Pollinations is the default; add a Replicate key for reliable Flux / SDXL.</li>
              <li><strong>Write a motion prompt</strong>, pick Ken Burns (free) or Runway / Replicate motion (paid keys), hit <span className="kbd">✦ Generate motion</span>.</li>
              <li><strong>Iterate</strong>: each section keeps multiple <em>versions</em> — try variants without losing the previous take.</li>
              <li><strong>Render</strong> the whole thing as MP4 via <span className="kbd">⤓ Render MP4</span> when the timeline is ready.</li>
            </ol>
          </div>

          <div className="modal-section">
            <div className="modal-section-title">// TOOLS</div>
            <dl className="help-defs">
              <dt><span className="slot-icon">✎</span> // BRIEF</dt>
              <dd>Project-wide visual direction (camera, lens, lighting, palette). Injected into every still prompt — set it once, every section inherits.</dd>
              <dt><span className="slot-icon">◐</span> // GRADE</dt>
              <dd>Final-pass color: exposure, contrast, warmth, crushed blacks. Applied via FFmpeg LUT at render time and exportable as a .cube file for Premiere / Resolve.</dd>
              <dt><span className="slot-icon">♫</span> // MUSIC</dt>
              <dd>Score for the whole project. Generate via ElevenLabs or Stable Audio, or <span className="kbd">▤ IMPORT</span> your own mp3/wav. Auto-ducks under VO at −6dB.</dd>
              <dt><span className="slot-icon">T</span> // GRAPHIC STYLE</dt>
              <dd>Font, color, and background for any title-card section. Pick from JetBrains Mono / Inter / Knewave.</dd>
              <dt><span className="lib-tab-icon">⊞</span> // PROJECTS</dt>
              <dd>Your saved projects. <span className="kbd">{mod} S</span> saves the current state; click a saved row to load it (the current project is auto-saved first).</dd>
              <dt><span className="lib-tab-icon">⚀</span> // TEMPLATES</dt>
              <dd>Starter timelines: Blank, Product Reveal, Title card, Tutorial 3-shot, Dark drop.</dd>
            </dl>
          </div>

          <div className="modal-section">
            <div className="modal-section-title">// IMPORT YOUR OWN MEDIA</div>
            <ul className="help-list">
              <li>Each clip card has a <span className="kbd">▤ IMPORT</span> chip — drop in an image to set the still or a video to bypass generation entirely.</li>
              <li>The music bed has its own <span className="kbd">▤ IMPORT</span> — the filename becomes the track name.</li>
              <li>VO segments get a <span className="kbd">▤ Import</span> action inside their editor — narrate yourself instead of generating.</li>
            </ul>
          </div>

          <div className="modal-section">
            <div className="modal-section-title">// PROVIDERS</div>
            <dl className="help-defs">
              <dt>Pollinations <span className="help-tag free">FREE</span></dt>
              <dd>Free Flux stills. Often queued (1 request per IP) — sign up at enter.pollinations.ai and paste the token via 🔑 Keys to skip the queue. Or add a Replicate key to auto-fall back to Flux Schnell.</dd>
              <dt>Replicate <span className="help-tag">KEY</span></dt>
              <dd>Flux 1.1 Pro, Flux Schnell, SDXL, Ideogram for stills; MiniMax, Kling, Pika, Luma for motion. ~$0.003–0.08 per still, ~$0.075–0.4 per motion second.</dd>
              <dt>Runway <span className="help-tag">KEY</span></dt>
              <dd>Gen-3 / Gen-4 motion. Best motion quality but hard-aspect-locked to specific resolutions. Calls go through a thin server proxy because Runway blocks browsers.</dd>
              <dt>ElevenLabs <span className="help-tag">KEY</span></dt>
              <dd>Voice generation for VO and music score generation.</dd>
            </dl>
            <p className="help-note">Keys live in your browser&apos;s localStorage. ElevenLabs and Pollinations are called direct. Replicate and Runway block browser CORS, so their requests are relayed through our server — the key transits per request and is never stored or logged. The app itself is completely free.</p>
          </div>

          <div className="modal-section">
            <div className="modal-section-title">// TIPS</div>
            <ul className="help-list">
              <li><strong>Aspect ratio applies to new generation.</strong> Switching after generating doesn&apos;t reshape existing previews — you&apos;ll need to re-render any clip you want at the new aspect.</li>
              <li><strong>Reference images flow into stills</strong> if the model supports init-image. SDXL does; the others ignore the reference. The <span className="kbd">→ ref hint</span> below the prompt is clickable to switch to SDXL.</li>
              <li><strong>Continuity across cuts:</strong> set a section&apos;s INPUT to the previous section&apos;s last frame and use SDXL for visual carry-over.</li>
              <li><strong>Cost cap</strong> warns at $0.50 per still — useful when you accidentally pick an expensive model.</li>
              <li><strong>Everything persists</strong> in localStorage. Export your project JSON for portability or to share.</li>
            </ul>
          </div>

          <div className="modal-section">
            <div className="modal-section-title">// KEYBOARD SHORTCUTS</div>
            <div className="help-shortcuts">
              {shortcutGroups.map((g) => (
                <div key={g.title} className="help-shortcut-group">
                  <div className="help-shortcut-group-title">{g.title}</div>
                  <div className="shortcut-grid">
                    {g.items.map((item) => (
                      <div key={item.label} className="shortcut-row">
                        <div className="shortcut-keys">
                          {item.keys.map((k, i) => (
                            <span key={i} className="kbd">{k}</span>
                          ))}
                        </div>
                        <div className="shortcut-label">{item.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="help-note">Shortcuts are ignored while you&apos;re typing in an input or textarea.</p>
          </div>
        </div>
        <div className="modal-foot">
          <span className="render-status">Bring your own model · cinematic by default · free to use</span>
          <button type="button" className="btn primary" onClick={onClose}>OK</button>
        </div>
      </div>
    </div>
  );
}

export function ProvidersDialog({
  keys,
  onSetKey,
  onRemoveKey,
  onClose,
}: {
  keys: Partial<Record<ProviderId, string>>;
  onSetKey: (id: ProviderId, key: string) => void;
  onRemoveKey: (id: ProviderId) => void;
  onClose: () => void;
}) {
  const [showExperimental, setShowExperimental] = useState(false);
  const stable = PROVIDERS.filter((p) => !p.experimental);
  const experimental = PROVIDERS.filter((p) => p.experimental);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-title">// PROVIDERS</div>
            <div className="modal-sub">
              Bring your own model · keys stay in your browser · calls go direct to the provider
            </div>
          </div>
          <button type="button" className="btn ghost" onClick={onClose}>✕ Close</button>
        </div>

        <div className="modal-body">
          <div className="providers-notice">
            <strong>Keys live in your browser&apos;s localStorage.</strong> Export does not include them.
            ElevenLabs and Pollinations are called <em>direct</em> from the browser. <strong>Replicate</strong>
            and <strong>Runway</strong> block cross-origin browser calls, so requests are <em>relayed</em>
            through our server — the key transits in memory per request and is never stored or logged.
          </div>

          <div className="providers-list">
            {stable.map((p) => {
              const stored = keys[p.id] ?? "";
              const connected = stored.trim().length > 0;
              return (
                <ProviderRow
                  key={p.id}
                  providerId={p.id}
                  name={p.name}
                  surfaces={p.surfaces}
                  signupUrl={p.signup_url}
                  notes={p.notes}
                  keyPrefix={p.key_prefix}
                  storedKey={stored}
                  connected={connected}
                  relayed={p.relayed}
                  onSetKey={(k) => onSetKey(p.id, k)}
                  onRemoveKey={() => onRemoveKey(p.id)}
                />
              );
            })}

            {experimental.length > 0 ? (
              <div className="providers-experimental">
                <button
                  type="button"
                  className="providers-experimental-toggle"
                  onClick={() => setShowExperimental((v) => !v)}
                >
                  {showExperimental ? "▾" : "▸"} // COMING IN v2 — {experimental.length} provider{experimental.length === 1 ? "" : "s"}
                </button>
                {showExperimental
                  ? experimental.map((p) => {
                      const stored = keys[p.id] ?? "";
                      const connected = stored.trim().length > 0;
                      return (
                        <ProviderRow
                          key={p.id}
                          providerId={p.id}
                          name={p.name}
                          surfaces={p.surfaces}
                          signupUrl={p.signup_url}
                          notes={p.notes}
                          keyPrefix={p.key_prefix}
                          storedKey={stored}
                          connected={connected}
                          onSetKey={(k) => onSetKey(p.id, k)}
                          onRemoveKey={() => onRemoveKey(p.id)}
                        />
                      );
                    })
                  : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="modal-foot">
          <span className="render-status">
            {
              PROVIDERS.filter((p) => !p.experimental && keys[p.id] && keys[p.id]!.trim()).length
            } of {PROVIDERS.filter((p) => !p.experimental).length} configured
          </span>
          <button type="button" className="btn ghost" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

export function ProviderRow({
  providerId,
  name,
  surfaces,
  signupUrl,
  notes,
  keyPrefix,
  storedKey,
  connected,
  relayed,
  onSetKey,
  onRemoveKey,
}: {
  providerId: ProviderId;
  name: string;
  surfaces: ("image" | "motion" | "voice" | "music" | "text")[];
  signupUrl: string;
  notes?: string;
  keyPrefix?: string;
  storedKey: string;
  connected: boolean;
  relayed?: boolean;
  onSetKey: (key: string) => void;
  onRemoveKey: () => void;
}) {
  const [editing, setEditing] = useState(!connected);
  const [draft, setDraft] = useState("");
  const [show, setShow] = useState(false);

  const malformedHint =
    draft.trim() && keyPrefix && !draft.trim().startsWith(keyPrefix)
      ? `Doesn't start with ${keyPrefix} — double-check before saving`
      : null;
  const commit = (force?: boolean) => {
    if (!draft.trim()) return;
    if (malformedHint && force !== true) {
      confirmAsk({
        title: "Key looks off",
        message: `${malformedHint}. Save anyway?`,
        confirm_label: "Save anyway",
        cancel_label: "Go back",
        onConfirm: () => commit(true),
      });
      return;
    }
    onSetKey(draft);
    setDraft("");
    setEditing(false);
    setShow(false);
  };

  return (
    <div className={`provider-row ${connected ? "connected" : ""}`}>
      <div className="provider-head">
        <div className="provider-id">
          <span className={`prov-dot ${connected ? "" : "warn"}`} />
          <span className="prov-name">{name}</span>
          <span className="prov-tag">{providerId}</span>
          {relayed ? (
            <span className="prov-relay" title="Calls are relayed through our server because this provider blocks browser CORS. Key transits in memory per request and is never stored.">RELAYED</span>
          ) : null}
        </div>
        <div className="provider-surfaces">
          {surfaces.map((s) => (
            <span key={s} className="surface-tag">{s}</span>
          ))}
        </div>
      </div>
      {notes ? <div className="provider-notes">{notes}</div> : null}
      {malformedHint && editing ? <div className="provider-warn">⚠ {malformedHint}</div> : null}
      <div className="provider-key">
        {editing ? (
          <>
            <input
              className="field-input"
              type={show ? "text" : "password"}
              autoFocus
              spellCheck={false}
              autoComplete="off"
              placeholder={keyPrefix ? `${keyPrefix}…` : "API key"}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commit();
                }
                if (e.key === "Escape") {
                  setEditing(connected ? false : true);
                  setDraft("");
                }
              }}
            />
            <button
              type="button"
              className="btn ghost provider-act"
              onClick={() => setShow((v) => !v)}
            >
              {show ? "Hide" : "Show"}
            </button>
            <button
              type="button"
              className="btn provider-act"
              disabled={!draft.trim()}
              onClick={() => commit()}
            >
              Save
            </button>
            {connected ? (
              <button
                type="button"
                className="btn ghost provider-act"
                onClick={() => {
                  setEditing(false);
                  setDraft("");
                }}
              >
                Cancel
              </button>
            ) : null}
          </>
        ) : (
          <>
            <div className="field-input read masked">{maskKey(storedKey)}</div>
            <button
              type="button"
              className="btn ghost provider-act"
              onClick={() => setEditing(true)}
            >
              Replace
            </button>
            <button
              type="button"
              className="btn ghost provider-act danger"
              onClick={() => {
                confirmAsk({
                  title: `Remove ${name} key?`,
                  message: `Removes the ${name} API key from this browser. You can add it back any time.`,
                  confirm_label: "Remove",
                  cancel_label: "Keep",
                  destructive: true,
                  onConfirm: () => onRemoveKey(),
                });
              }}
            >
              Remove
            </button>
          </>
        )}
      </div>
      <div className="provider-meta">
        <a className="provider-link" href={signupUrl} target="_blank" rel="noreferrer">
          Get a {name} key ↗
        </a>
      </div>
    </div>
  );
}
