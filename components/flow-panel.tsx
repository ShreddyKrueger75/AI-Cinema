"use client";

import { useCallback, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import type { Project, Section, Version } from "@/lib/types";
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
import { PROVIDERS, providerForModel, type ProviderId } from "@/lib/providers";
import { toast } from "@/lib/toast";
import { useGenState, stillJobKey, motionJobKey, type GenSlot } from "@/lib/genstate";
import {
  composePromptWithBrief,
  fetchAsDataUrl,
  imageModelSupportsReference,
  isReplicateImageModel,
  isReplicateMotionModel,
  runReplicateImage,
  runReplicateMotion,
} from "@/lib/replicate";
import { isRunwayMotionModel, runRunwayMotion } from "@/lib/runway";
import { extractLastFrameDataUrl, parseLastFrameRef } from "@/lib/video";
import {
  SECTION_DURATION_OPTIONS_S,
  blobToDataUrl,
  formatCost,
  formatTimecode,
} from "@/components/lib";
import { Field, InlineText, Popover } from "@/components/ui";

/* ───────────── FLOW PANEL ───────────── */

export function FlowPanel({
  section,
  project,
  providerKeys,
  onOpenProviders,
  onProviderKeyMissing,
}: {
  section: Section;
  project: Project;
  providerKeys: Partial<Record<ProviderId, string>>;
  onOpenProviders: () => void;
  onProviderKeyMissing: () => void;
}) {
  const setActiveSection = useStore((s) => s.setActiveSection);
  const setActiveVersion = useStore((s) => s.setActiveVersion);
  const setActiveStill = useStore((s) => s.setActiveStill);
  const updateStill = useStore((s) => s.updateStill);
  const addStill = useStore((s) => s.addStill);
  const removeStill = useStore((s) => s.removeStill);
  const updateClipVersion = useStore((s) => s.updateClipVersion);
  const addClipVersion = useStore((s) => s.addClipVersion);
  const removeClipVersion = useStore((s) => s.removeClipVersion);
  const updateTitleVersion = useStore((s) => s.updateTitleVersion);
  const addTitleVersion = useStore((s) => s.addTitleVersion);
  const removeTitleVersion = useStore((s) => s.removeTitleVersion);
  const updateSection = useStore((s) => s.updateSection);

  const [versionMenuOpen, setVersionMenuOpen] = useState(false);
  const [durationMenuOpen, setDurationMenuOpen] = useState(false);

  const startTime = useMemo(
    () =>
      project.sections.slice(0, section.index - 1).reduce((a, s) => a + s.duration_s, 0),
    [project.sections, section.index],
  );

  const activeVersion = section.versions.find((v) => v.id === section.active_version_id) ?? null;
  const activeStill = section.stills.find((s) => s.id === section.active_still_id) ?? null;

  const priorClipSections = project.sections.filter(
    (s) => s.type === "clip" && s.index < section.index,
  );

  const referencedStill =
    activeVersion && activeVersion.kind === "clip" && activeVersion.still_ref
      ? section.stills.find((s) => s.id === activeVersion.still_ref) ?? activeStill
      : activeStill;

  const setJob = useGenState((s) => s.setJob);
  const clearJob = useGenState((s) => s.clearJob);
  const jobs = useGenState((s) => s.jobs);

  const stillJob = activeStill ? jobs[stillJobKey(section.id, activeStill.id)] : undefined;
  const motionJob =
    activeVersion && activeVersion.kind === "clip"
      ? jobs[motionJobKey(section.id, activeVersion.id)]
      : undefined;

  const modelHasKey = (modelId: string): boolean => {
    const pid = providerForModel(modelId);
    return pid ? !!providerKeys[pid] : false;
  };
  const promptForKey = (providerName: string) => {
    if (
      confirm(
        `${providerName} needs an API key. Open Providers to add one? (Or switch to a free model.)`,
      )
    ) {
      onProviderKeyMissing();
    }
  };

  const COST_CAP = 0.5;

  const handleGenerateStill = async () => {
    if (!activeStill) return;
    const jobKey = stillJobKey(section.id, activeStill.id);
    if (jobs[jobKey]?.status === "running") return;

    const modelId = activeStill.model;
    const composedPrompt = composePromptWithBrief(
      activeStill.image_prompt,
      project.brief?.visual,
    );
    const estCost = imageModelCost(modelId);
    if (estCost > COST_CAP) {
      const ok = confirm(
        `Heads up — this still costs about $${estCost.toFixed(2)} (cap is $${COST_CAP.toFixed(2)}). Generate anyway?`,
      );
      if (!ok) return;
    }

    if (isImageModelFree(modelId)) {
      const url = pollinationsUrl(
        activeStill.image_prompt,
        project.aspect,
        newSeed(),
        project.brief?.visual,
        providerKeys.pollinations,
      );
      const jobKey = stillJobKey(section.id, activeStill.id);
      setJob(jobKey, { status: "running", startedAt: Date.now() });
      let throttled = false;
      try {
        const headers: HeadersInit = providerKeys.pollinations
          ? { "x-provider-key": providerKeys.pollinations }
          : {};
        const r = await fetch(url, { credentials: "omit", headers });
        if (!r.ok) {
          let detail = `HTTP ${r.status}`;
          try {
            const body = await r.text();
            const json = JSON.parse(body);
            if (json?.error) detail = json.error;
          } catch {
            // not JSON; keep status code
          }
          if (r.status === 402 || /queue/i.test(detail)) {
            throttled = true;
            throw new Error(
              `Pollinations free queue is full — ${detail}.`,
            );
          }
          throw new Error(`Pollinations ${r.status}: ${detail}`);
        }
        const blob = await r.blob();
        // Persist as a data URL — blob: URLs die on page refresh, breaking
        // every still on the next load. Pollinations stills are ~150KB so
        // 6 of them fit comfortably in localStorage.
        const dataUrl = await blobToDataUrl(blob);
        updateStill(section.id, activeStill.id, { output_url: dataUrl });
        clearJob(jobKey);
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const replicateToken = providerKeys.replicate;
        if (throttled && replicateToken) {
          toast.info("Pollinations queued", "Falling back to Flux Schnell · ~$0.003");
          try {
            const fallbackUrl = await runReplicateImage({
              model: "flux-schnell",
              prompt: composedPrompt,
              aspect: project.aspect,
              apiToken: replicateToken,
            });
            const fbDataUrl = await fetchAsDataUrl(fallbackUrl).catch(() => fallbackUrl);
            updateStill(section.id, activeStill.id, { output_url: fbDataUrl });
            clearJob(jobKey);
            toast.success("Fallback succeeded", "Generated on Flux Schnell · switch the still's model to make it stick");
            return;
          } catch (fallbackErr) {
            const fbMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
            setJob(jobKey, { status: "error", error: fbMsg });
            toast.error("Flux Schnell fallback failed", fbMsg);
            return;
          }
        }
        setJob(jobKey, { status: "error", error: message });
        toast.error(
          throttled ? "Free preview throttled" : "Generation failed",
          throttled
            ? `${message} Wait ~30s, add a Pollinations token (🔑 Keys → Pollinations) from enter.pollinations.ai, or add a Replicate key for automatic Flux Schnell fallback.`
            : message,
        );
      }
      return;
    }

    if (!modelHasKey(modelId)) {
      const pid = providerForModel(modelId);
      promptForKey(PROVIDERS.find((p) => p.id === pid)?.name ?? modelId);
      return;
    }

    const pid = providerForModel(modelId);
    if (pid === "replicate" && isReplicateImageModel(modelId)) {
      const token = providerKeys.replicate!;
      setJob(jobKey, { status: "running", startedAt: Date.now() });
      try {
        let referenceImageUrl: string | undefined;
        const refSectionId = parseLastFrameRef(activeStill.input_ref);
        if (refSectionId) {
          const refSection = project.sections.find((s) => s.id === refSectionId);
          const refVersion = refSection?.versions.find(
            (v) => v.id === refSection.active_version_id,
          );
          if (refVersion && refVersion.kind === "clip" && refVersion.output_url) {
            const out = refVersion.output_url;
            if (/^https?:\/\//.test(out)) {
              referenceImageUrl = await extractLastFrameDataUrl(out);
            } else if (out.startsWith("kenburns:")) {
              const stillRef = refVersion.still_ref ?? refSection?.active_still_id ?? null;
              const refStill = stillRef
                ? refSection?.stills.find((st) => st.id === stillRef)
                : undefined;
              referenceImageUrl = refStill?.output_url;
            }
          }
        }
        if (!referenceImageUrl && project.brief?.refs && project.brief.refs.length > 0) {
          referenceImageUrl = project.brief.refs[0];
        }
        if (referenceImageUrl && !imageModelSupportsReference(modelId)) {
          referenceImageUrl = undefined;
        }
        const url = await runReplicateImage({
          model: modelId,
          prompt: composedPrompt,
          aspect: project.aspect,
          apiToken: token,
          referenceImageUrl,
        });
        // Persist as a data URL — Replicate's signed delivery URLs expire
        // after ~24h, so storing the URL alone breaks every still tomorrow.
        const dataUrl = await fetchAsDataUrl(url).catch(() => url);
        updateStill(section.id, activeStill.id, { output_url: dataUrl });
        clearJob(jobKey);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setJob(jobKey, { status: "error", error: message });
      }
      return;
    }

    toast.info(
      `Live ${modelId} isn't wired yet`,
      "Switch to Pollinations (free) or Flux / Schnell / SDXL / Ideogram (Replicate).",
    );
  };

  const handleGenerateMotion = async () => {
    if (!activeVersion || activeVersion.kind !== "clip") return;
    const jobKey = motionJobKey(section.id, activeVersion.id);
    if (jobs[jobKey]?.status === "running") return;

    const modelId = activeVersion.motion.model;
    const estMotionCost = motionModelCost(modelId, activeVersion.motion.duration_s);
    if (estMotionCost > COST_CAP) {
      const ok = confirm(
        `Heads up — this motion costs about $${estMotionCost.toFixed(2)} (cap is $${COST_CAP.toFixed(2)}). Generate anyway?`,
      );
      if (!ok) return;
    }

    if (isMotionModelFree(modelId)) {
      const stillToUse = referencedStill;
      if (stillToUse && !stillToUse.output_url && isImageModelFree(stillToUse.model)) {
        // Store a direct (no-token) pollinations URL — <img> tags can't send
        // the x-provider-key header the proxy needs. Users who want reliable
        // stills should use the explicit Generate still path, which proxies.
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
      return;
    }

    if (!modelHasKey(modelId)) {
      const pid = providerForModel(modelId);
      promptForKey(PROVIDERS.find((p) => p.id === pid)?.name ?? modelId);
      return;
    }

    const pid = providerForModel(modelId);
    if (pid === "replicate" && isReplicateMotionModel(modelId)) {
      const stillToUse = referencedStill;
      if (!stillToUse?.output_url) {
        toast.warn(
          "Generate a still first",
          "Motion uses the active still as its first frame.",
        );
        return;
      }
      const token = providerKeys.replicate!;
      const composedPrompt = composePromptWithBrief(
        activeVersion.motion.prompt,
        project.brief?.visual,
      );
      setJob(jobKey, { status: "running", startedAt: Date.now() });
      try {
        const videoUrl = await runReplicateMotion({
          model: modelId,
          prompt: composedPrompt,
          firstFrameUrl: stillToUse.output_url,
          durationSeconds: activeVersion.motion.duration_s || section.duration_s,
          aspect: project.aspect,
          apiToken: token,
        });
        updateClipVersion(section.id, activeVersion.id, {
          output_url: videoUrl,
          still_ref: stillToUse.id,
        });
        clearJob(jobKey);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setJob(jobKey, { status: "error", error: message });
      }
      return;
    }

    if (pid === "runway" && isRunwayMotionModel(modelId)) {
      const stillToUse = referencedStill;
      if (!stillToUse?.output_url) {
        toast.warn(
          "Generate a still first",
          "Motion uses the active still as its first frame.",
        );
        return;
      }
      if (
        stillToUse.output_url.startsWith("blob:") ||
        stillToUse.output_url.startsWith("data:")
      ) {
        toast.warn(
          "Runway needs an internet-reachable still",
          "The current still is a browser-local blob (e.g. from Pollinations). Use a still generated by a Replicate model (Flux / SDXL) so its URL is on a public CDN, or re-host the still first.",
        );
        return;
      }
      const token = providerKeys.runway!;
      const composedPrompt = composePromptWithBrief(
        activeVersion.motion.prompt,
        project.brief?.visual,
      );
      setJob(jobKey, { status: "running", startedAt: Date.now() });
      try {
        const videoUrl = await runRunwayMotion({
          model: modelId,
          prompt: composedPrompt,
          firstFrameUrl: stillToUse.output_url,
          durationSeconds: activeVersion.motion.duration_s || section.duration_s,
          aspect: project.aspect,
          apiToken: token,
        });
        updateClipVersion(section.id, activeVersion.id, {
          output_url: videoUrl,
          still_ref: stillToUse.id,
        });
        clearJob(jobKey);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setJob(jobKey, { status: "error", error: message });
      }
      return;
    }

    toast.info(
      `Live ${modelId} isn't wired yet`,
      "Switch to Ken Burns (free), MiniMax Video-01 (Replicate), or a Runway Gen-3/Gen-4 model.",
    );
  };

  const dismissStillError = () => {
    if (!activeStill) return;
    clearJob(stillJobKey(section.id, activeStill.id));
  };
  const dismissMotionError = () => {
    if (!activeVersion) return;
    clearJob(motionJobKey(section.id, activeVersion.id));
  };

  const motionOutputUrl =
    activeVersion && activeVersion.kind === "clip" ? activeVersion.output_url : undefined;
  const motionVideoUrl =
    motionOutputUrl && /^https?:\/\//.test(motionOutputUrl) ? motionOutputUrl : null;
  const motionDirection =
    motionOutputUrl && motionOutputUrl.startsWith("kenburns:")
      ? (motionOutputUrl.slice("kenburns:".length) as "in" | "out" | "left" | "right")
      : null;

  const motionStillUrl = motionDirection && referencedStill?.output_url ? referencedStill.output_url : null;

  const versionIdx = activeVersion ? section.versions.findIndex((v) => v.id === activeVersion.id) : -1;

  return (
    <div className="flow-panel">
      <div className="flow-head">
        <div className="title">
          <span className="slash">//</span>{" "}
          {section.index.toString().padStart(2, "0")} —{" "}
          <InlineText
            value={section.title}
            onCommit={(title) => updateSection(section.id, { title })}
            ariaLabel="Section title"
            placeholder="Section name"
          />
          <span className="timecode">
            {formatTimecode(startTime)} — {formatTimecode(startTime + section.duration_s)}
          </span>
          <span className="popover-anchor">
            <button
              type="button"
              className="spec-pick small"
              onClick={() => setDurationMenuOpen((o) => !o)}
              title="Section duration"
            >
              {section.duration_s.toFixed(1)}s <span className="caret">▾</span>
            </button>
            <Popover
              open={durationMenuOpen}
              onClose={() => setDurationMenuOpen(false)}
              className="menu"
            >
              {SECTION_DURATION_OPTIONS_S.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`menu-item ${d === section.duration_s ? "active" : ""}`}
                  onClick={() => {
                    updateSection(section.id, { duration_s: d });
                    setDurationMenuOpen(false);
                  }}
                >
                  {d.toFixed(1)}s
                </button>
              ))}
            </Popover>
          </span>
        </div>
        <div className="right">
          {activeVersion ? (
            <span className="popover-anchor">
              <button
                type="button"
                className="version-dd"
                onClick={() => setVersionMenuOpen((o) => !o)}
              >
                <span>v{versionIdx + 1}</span>
                <span>{activeVersion.label}</span>
                <span className="caret">▾</span>
              </button>
              <Popover
                open={versionMenuOpen}
                onClose={() => setVersionMenuOpen(false)}
                className="menu wide"
              >
                {section.versions.map((v, i) => (
                  <button
                    key={v.id}
                    type="button"
                    className={`menu-item ${v.id === activeVersion.id ? "active" : ""}`}
                    onClick={() => {
                      setActiveVersion(section.id, v.id);
                      setVersionMenuOpen(false);
                    }}
                  >
                    <span className="mi-tag">v{i + 1}</span> {v.label}
                  </button>
                ))}
                <button
                  type="button"
                  className="menu-item add"
                  onClick={() => {
                    if (section.type === "clip") addClipVersion(section.id);
                    else addTitleVersion(section.id);
                    setVersionMenuOpen(false);
                  }}
                >
                  + new version
                </button>
              </Popover>
            </span>
          ) : null}
          <button type="button" className="btn ghost" onClick={() => setActiveSection(null)}>
            ✕ Close
          </button>
        </div>
      </div>

      <div className="flow-notes">
        <span className="flow-notes-label">💬 Director&apos;s note</span>
        <textarea
          className="flow-notes-input"
          rows={2}
          placeholder={
            section.type === "title"
              ? "Why this card? Beat, transition, payoff…"
              : "Continuity cues, blocking, the joke…"
          }
          value={section.notes ?? ""}
          onChange={(e) => updateSection(section.id, { notes: e.target.value })}
        />
      </div>

      {section.type === "title" ? (
        <TitleFlowBody
          section={section}
          activeVersion={activeVersion}
          onChangeTitleVersion={(patch) =>
            activeVersion && updateTitleVersion(section.id, activeVersion.id, patch)
          }
          onSelectVersion={(id) => setActiveVersion(section.id, id)}
          onAddVersion={() => addTitleVersion(section.id)}
          onRemoveVersion={(id) => removeTitleVersion(section.id, id)}
          titleStyleName={project.title_settings?.name}
        />
      ) : (
        <ClipFlowBody
          section={section}
          project={project}
          activeStill={activeStill}
          activeVersion={activeVersion && activeVersion.kind === "clip" ? activeVersion : null}
          motionDirection={motionDirection}
          motionStillUrl={motionStillUrl}
          motionVideoUrl={motionVideoUrl}
          priorClipSections={priorClipSections}
          modelHasKey={modelHasKey}
          stillJob={stillJob}
          motionJob={motionJob}
          onUpdateStill={(stillId, patch) => updateStill(section.id, stillId, patch)}
          onAddStill={() => addStill(section.id)}
          onRemoveStill={(stillId) => removeStill(section.id, stillId)}
          onSelectStill={(stillId) => setActiveStill(section.id, stillId)}
          onUpdateClipVersion={(versionId, patch) =>
            updateClipVersion(section.id, versionId, patch)
          }
          onAddClipVersion={() => addClipVersion(section.id)}
          onRemoveClipVersion={(versionId) => removeClipVersion(section.id, versionId)}
          onSelectVersion={(versionId) => setActiveVersion(section.id, versionId)}
          onGenerateStill={handleGenerateStill}
          onGenerateMotion={handleGenerateMotion}
          onDismissStillError={dismissStillError}
          onDismissMotionError={dismissMotionError}
          onOpenProviders={onOpenProviders}
        />
      )}
    </div>
  );
}

/* ───────────── TITLE FLOW BODY ───────────── */

function TitleFlowBody({
  section,
  activeVersion,
  onChangeTitleVersion,
  onSelectVersion,
  onAddVersion,
  onRemoveVersion,
  titleStyleName,
}: {
  section: Section;
  activeVersion: Version | null;
  onChangeTitleVersion: (patch: { label?: string; text?: string }) => void;
  onSelectVersion: (id: string) => void;
  onAddVersion: () => void;
  onRemoveVersion: (id: string) => void;
  titleStyleName?: string;
}) {
  const titleVersion = activeVersion && activeVersion.kind === "title" ? activeVersion : null;
  return (
    <div className="flow-body single">
      <div className="stage full">
        <div className="stage-title"><span className="num">01</span><span className="stage-title-icon" aria-hidden>T</span>GRAPHIC</div>
        <Field label="Text">
          <textarea
            className="field-input tall"
            rows={3}
            value={titleVersion?.text ?? ""}
            disabled={!titleVersion}
            placeholder={titleVersion ? "Graphic text" : "+ new version to start"}
            onChange={(e) => onChangeTitleVersion({ text: e.target.value })}
          />
        </Field>
        <Field label="Version label">
          <input
            className="field-input"
            value={titleVersion?.label ?? ""}
            disabled={!titleVersion}
            onChange={(e) => onChangeTitleVersion({ label: e.target.value })}
            placeholder="default style"
          />
        </Field>
        <Field label="Title style">
          <div className="field-input read">{titleStyleName ?? "—"}</div>
        </Field>

        <div className="versions-list">
          {section.versions.map((v, i) => {
            const isActive = v.id === section.active_version_id;
            const canRemove = section.versions.length > 1;
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
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {canRemove ? (
                    <button
                      type="button"
                      className="vrow-remove"
                      title="Remove version"
                      aria-label={`Remove version ${v.label}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveVersion(v.id);
                      }}
                    >
                      ✕
                    </button>
                  ) : null}
                  <span className={`vmark ${isActive ? "active" : "muted"}`}>
                    {isActive ? "●" : "↻"}
                  </span>
                </div>
              </div>
            );
          })}
          <div className="vrow add" onClick={onAddVersion}>+ new version</div>
        </div>
      </div>
    </div>
  );
}

/* ───────────── CLIP FLOW BODY ───────────── */

type ClipFlowBodyProps = {
  section: Section;
  project: Project;
  activeStill: NonNullable<Section["stills"][number]> | null;
  activeVersion:
    | (Section["versions"][number] & { kind: "clip" })
    | null;
  motionDirection: "in" | "out" | "left" | "right" | null;
  motionStillUrl: string | null;
  motionVideoUrl: string | null;
  priorClipSections: Section[];
  modelHasKey: (modelId: string) => boolean;
  stillJob?: GenSlot;
  motionJob?: GenSlot;
  onUpdateStill: (
    stillId: string,
    patch: Partial<Omit<Section["stills"][number], "id">>,
  ) => void;
  onAddStill: () => void;
  onRemoveStill: (stillId: string) => void;
  onSelectStill: (stillId: string) => void;
  onUpdateClipVersion: (
    versionId: string,
    patch: {
      label?: string;
      motion?: Partial<{ prompt: string; model: string; duration_s: number }>;
      still_ref?: string | null;
      output_url?: string;
    },
  ) => void;
  onAddClipVersion: () => void;
  onRemoveClipVersion: (versionId: string) => void;
  onSelectVersion: (versionId: string) => void;
  onGenerateStill: () => void;
  onGenerateMotion: () => void;
  onDismissStillError: () => void;
  onDismissMotionError: () => void;
  onOpenProviders: () => void;
};

function ClipFlowBody({
  section,
  project,
  activeStill,
  activeVersion,
  motionDirection,
  motionStillUrl,
  motionVideoUrl,
  priorClipSections,
  modelHasKey,
  stillJob,
  motionJob,
  onUpdateStill,
  onAddStill,
  onRemoveStill,
  onSelectStill,
  onUpdateClipVersion,
  onAddClipVersion,
  onRemoveClipVersion,
  onSelectVersion,
  onGenerateStill,
  onGenerateMotion,
  onDismissStillError,
  onDismissMotionError,
  onOpenProviders,
}: ClipFlowBodyProps) {
  const stillCost = activeStill ? imageModelCost(activeStill.model) : 0;
  const motionCost = activeVersion
    ? motionModelCost(activeVersion.motion.model, activeVersion.motion.duration_s)
    : 0;
  const stillNeedsKey =
    activeStill && !isImageModelFree(activeStill.model) && !modelHasKey(activeStill.model);
  const motionNeedsKey =
    activeVersion &&
    !isMotionModelFree(activeVersion.motion.model) &&
    !modelHasKey(activeVersion.motion.model);
  const stillProviderName = activeStill
    ? PROVIDERS.find((p) => p.id === providerForModel(activeStill.model))?.name ?? null
    : null;
  const motionProviderName = activeVersion
    ? PROVIDERS.find((p) => p.id === providerForModel(activeVersion.motion.model))?.name ?? null
    : null;

  const updateStillLabel = useCallback(
    (label: string) => activeStill && onUpdateStill(activeStill.id, { label }),
    [activeStill, onUpdateStill],
  );
  const updateVersionLabel = useCallback(
    (label: string) => activeVersion && onUpdateClipVersion(activeVersion.id, { label }),
    [activeVersion, onUpdateClipVersion],
  );

  return (
    <div className="flow-body">
      {/* STAGE 1 — STILL */}
      <div className="stage">
        <div className="stage-title"><span className="num">01</span><span className="stage-title-icon" aria-hidden>▣</span>STILL</div>

        <Field label="Image prompt">
          <textarea
            className="field-input tall"
            rows={3}
            value={activeStill?.image_prompt ?? ""}
            placeholder={activeStill ? "" : "start typing — a still will be created"}
            onFocus={() => {
              if (!activeStill) onAddStill();
            }}
            onChange={(e) => {
              const value = e.target.value;
              if (activeStill) {
                onUpdateStill(activeStill.id, { image_prompt: value });
                return;
              }
              useStore.getState().addStill(section.id);
              const after = useStore
                .getState()
                .project.sections.find((s) => s.id === section.id);
              const newStill =
                after?.active_still_id
                  ? after.stills.find((s) => s.id === after.active_still_id)
                  : null;
              if (newStill) {
                useStore
                  .getState()
                  .updateStill(section.id, newStill.id, { image_prompt: value });
              }
            }}
          />
        </Field>

        <Field label="Still label">
          <input
            className="field-input"
            value={activeStill?.label ?? ""}
            disabled={!activeStill}
            onChange={(e) => updateStillLabel(e.target.value)}
            placeholder="describe this still"
          />
        </Field>

        <div className="field-row three">
          <Field label="Model">
            <div className="field-pill">
              <select
                value={activeStill?.model ?? "pollinations"}
                disabled={!activeStill}
                onChange={(e) =>
                  activeStill && onUpdateStill(activeStill.id, { model: e.target.value })
                }
              >
                {IMAGE_MODELS.map((m) => {
                  const needsKey = !m.free && !modelHasKey(m.id);
                  return (
                    <option key={m.id} value={m.id}>
                      {m.label}{needsKey ? "  (key required)" : ""}
                    </option>
                  );
                })}
              </select>
              <span className="caret">▾</span>
            </div>
          </Field>
          <Field label="Input">
            <div className="field-pill">
              <select
                value={activeStill?.input_ref ?? ""}
                disabled={!activeStill}
                onChange={(e) =>
                  activeStill &&
                  onUpdateStill(activeStill.id, { input_ref: e.target.value || null })
                }
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
          </Field>
          <Field label="Cost">
            <div className="field-pill cost">{formatCost(stillCost)}</div>
          </Field>
        </div>
        {activeStill ? (() => {
          const refSectionId = parseLastFrameRef(activeStill.input_ref);
          const briefRef = project.brief?.refs?.[0];
          const supports = imageModelSupportsReference(activeStill.model as never);
          let text: string | null = null;
          if (refSectionId) {
            const sec = project.sections.find((s) => s.id === refSectionId);
            const label = sec ? `${sec.index.toString().padStart(2, "0")} last frame` : "previous frame";
            text = supports
              ? `→ ${label} feeds into the still as init image (prompt_strength 0.68)`
              : `→ ${label} captured but ignored; switch to SDXL for init-image continuity`;
          } else if (briefRef) {
            text = supports
              ? `→ brief reference image used as init (prompt_strength 0.68)`
              : `→ brief reference image ignored; SDXL accepts an init image`;
          }
          if (!text) return null;
          if (supports) return <div className="ref-hint">{text}</div>;
          return (
            <button
              type="button"
              className="ref-hint"
              title="Switch model to SDXL so the reference image is used as an init image"
              aria-label="Switch model to SDXL to use reference image"
              onClick={() => {
                onUpdateStill(activeStill.id, { model: "sdxl" });
                toast.success("Model switched", "SDXL accepts init images · regenerate to apply");
              }}
            >
              {text}
            </button>
          );
        })() : null}

        <div className="preview-row">
          <div
            className={`preview-box aspect-${project.aspect.replace(":", "-")}${
              activeStill?.output_url ? " has-image" : ""
            }${stillJob?.status === "running" ? " busy" : ""}${
              stillJob?.status === "error" ? " errored" : ""
            }`}
          >
            {activeStill?.output_url ? (
              <img
                key={activeStill.output_url}
                src={activeStill.output_url}
                alt={activeStill.label}
                className="preview-img"
                onError={() =>
                  toast.error(
                    "Image didn't load",
                    "The upstream returned an error before any bytes arrived. Free Pollinations is queued — try again, sign up at enter.pollinations.ai, or add a Replicate key.",
                  )
                }
              />
            ) : null}
            {activeStill ? (
              <span className="vbadge">
                s{section.stills.findIndex((s) => s.id === activeStill.id) + 1} · active
              </span>
            ) : null}
            {stillJob?.status === "running" ? (
              <div className="gen-overlay">
                <span className="gen-spinner" />
                <span className="gen-label">Generating still…</span>
              </div>
            ) : null}
            {stillJob?.status === "error" ? (
              <div className="gen-overlay error">
                <span className="gen-label">Error: {stillJob.error}</span>
                <button
                  type="button"
                  className="btn ghost gen-dismiss"
                  onClick={onDismissStillError}
                >
                  Dismiss
                </button>
              </div>
            ) : null}
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
                  onClick={() => onSelectStill(still.id)}
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
                        aria-label={`Remove still ${still.label}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveStill(still.id);
                        }}
                      >
                        ✕
                      </button>
                    ) : null}
                    <span className={`vmark ${isActive ? "active" : "muted"}`}>
                      {isActive ? "●" : "↻"}
                    </span>
                  </div>
                </div>
              );
            })}
            <div className="vrow add" onClick={onAddStill}>+ new still</div>
          </div>
        </div>

        <div className="gen-row">
          {stillNeedsKey ? (
            <button
              type="button"
              className="gen-cost warn gen-cost-link"
              onClick={onOpenProviders}
              title={`Open Providers to add a ${stillProviderName ?? "provider"} key`}
              aria-label={`Open Providers to add a ${stillProviderName ?? "provider"} key`}
            >
              ⊘ Needs {stillProviderName ?? "API"} key →
            </button>
          ) : (
            <span className="gen-cost">{formatCost(stillCost)} per still</span>
          )}
          <button
            type="button"
            className="btn primary"
            disabled={stillJob?.status === "running"}
            onClick={
              stillJob?.status === "running"
                ? undefined
                : !activeStill
                  ? onAddStill
                  : stillNeedsKey
                    ? onOpenProviders
                    : onGenerateStill
            }
            title={
              !activeStill
                ? "Add a still to start"
                : stillNeedsKey
                  ? `Open Providers to add a ${stillProviderName ?? "provider"} key`
                  : undefined
            }
            aria-label={
              !activeStill
                ? "Add a new still"
                : stillNeedsKey
                  ? `Open Providers to add a ${stillProviderName ?? "provider"} key`
                  : "Generate still"
            }
          >
            {stillJob?.status === "running"
              ? "● Generating…"
              : !activeStill
                ? "+ Add still first"
                : stillNeedsKey
                  ? `🔑 Add ${stillProviderName ?? "provider"} key`
                : "✦ Generate still"}
          </button>
        </div>
      </div>

      {/* STAGE 2 — MOTION */}
      <div className="stage">
        <div className="stage-title"><span className="num">02</span><span className="stage-title-icon" aria-hidden>◐</span>MOTION</div>

        <Field label="Motion prompt">
          <textarea
            className="field-input tall"
            rows={3}
            value={activeVersion?.motion.prompt ?? ""}
            disabled={!activeVersion}
            placeholder={activeVersion ? "" : "+ new version to start"}
            onChange={(e) =>
              activeVersion &&
              onUpdateClipVersion(activeVersion.id, { motion: { prompt: e.target.value } })
            }
          />
        </Field>

        <Field label="Version label">
          <input
            className="field-input"
            value={activeVersion?.label ?? ""}
            disabled={!activeVersion}
            onChange={(e) => updateVersionLabel(e.target.value)}
            placeholder="describe this take"
          />
        </Field>

        <div className="field-row three">
          <Field label="Model">
            <div className="field-pill">
              <select
                value={activeVersion?.motion.model ?? "runway-gen4"}
                disabled={!activeVersion}
                onChange={(e) =>
                  activeVersion &&
                  onUpdateClipVersion(activeVersion.id, { motion: { model: e.target.value } })
                }
              >
                {MOTION_MODELS.map((m) => {
                  const needsKey = !m.free && !modelHasKey(m.id);
                  return (
                    <option key={m.id} value={m.id}>
                      {m.label}{needsKey ? "  (key required)" : ""}
                    </option>
                  );
                })}
              </select>
              <span className="caret">▾</span>
            </div>
          </Field>
          <Field label="Duration">
            <div className="field-pill">
              <select
                value={activeVersion?.motion.duration_s ?? section.duration_s}
                disabled={!activeVersion}
                onChange={(e) =>
                  activeVersion &&
                  onUpdateClipVersion(activeVersion.id, {
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
          </Field>
          <Field label="Cost">
            <div className="field-pill cost">{formatCost(motionCost)}</div>
          </Field>
        </div>

        <div className="preview-row">
          <div
            className={`preview-box motion aspect-${project.aspect.replace(":", "-")}${
              motionStillUrl || motionVideoUrl ? " has-image" : ""
            }${motionJob?.status === "running" ? " busy" : ""}${
              motionJob?.status === "error" ? " errored" : ""
            }`}
          >
            {motionVideoUrl ? (
              <video
                key={motionVideoUrl}
                src={motionVideoUrl}
                className="preview-video"
                autoPlay
                loop
                muted
                playsInline
                controls
              />
            ) : motionStillUrl ? (
              <img
                key={`${motionStillUrl}|${motionDirection}|${activeVersion?.motion.duration_s ?? 0}`}
                src={motionStillUrl}
                alt="motion preview"
                className={`preview-img kb kb-${motionDirection}`}
                style={{ animationDuration: `${activeVersion?.motion.duration_s ?? 3}s` }}
              />
            ) : null}
            {activeVersion ? (
              <span className="vbadge">
                v{section.versions.findIndex((v) => v.id === activeVersion.id) + 1} · active
              </span>
            ) : null}
            {motionJob?.status === "running" ? (
              <div className="gen-overlay">
                <span className="gen-spinner" />
                <span className="gen-label">Generating motion…</span>
              </div>
            ) : null}
            {motionJob?.status === "error" ? (
              <div className="gen-overlay error">
                <span className="gen-label">Error: {motionJob.error}</span>
                <button
                  type="button"
                  className="btn ghost gen-dismiss"
                  onClick={onDismissMotionError}
                >
                  Dismiss
                </button>
              </div>
            ) : null}
            {motionVideoUrl ? null : (
              <span className="time">
                0:00 / {(activeVersion?.motion.duration_s ?? section.duration_s).toFixed(1)}
              </span>
            )}
          </div>
          <div className="versions-list">
            {section.versions.map((v, i) => {
              const isActive = v.id === section.active_version_id;
              const canRemove = section.versions.length > 1;
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
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    {canRemove ? (
                      <button
                        type="button"
                        className="vrow-remove"
                        title="Remove version"
                        aria-label={`Remove version ${v.label}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveClipVersion(v.id);
                        }}
                      >
                        ✕
                      </button>
                    ) : null}
                    <span className={`vmark ${isActive ? "active" : "muted"}`}>
                      {isActive ? "●" : "↻"}
                    </span>
                  </div>
                </div>
              );
            })}
            <div className="vrow add" onClick={onAddClipVersion}>+ new version</div>
          </div>
        </div>

        <div className="gen-row">
          {motionNeedsKey ? (
            <button
              type="button"
              className="gen-cost warn gen-cost-link"
              onClick={onOpenProviders}
              title={`Open Providers to add a ${motionProviderName ?? "provider"} key`}
              aria-label={`Open Providers to add a ${motionProviderName ?? "provider"} key`}
            >
              ⊘ Needs {motionProviderName ?? "API"} key →
            </button>
          ) : (
            <span className="gen-cost">{formatCost(motionCost)} per version</span>
          )}
          <button
            type="button"
            className="btn primary"
            disabled={!activeVersion || motionJob?.status === "running"}
            onClick={motionNeedsKey ? onOpenProviders : onGenerateMotion}
            title={
              motionNeedsKey
                ? `Open Providers to add a ${motionProviderName ?? "provider"} key`
                : undefined
            }
          >
            {motionJob?.status === "running"
              ? "● Generating…"
              : motionNeedsKey
                ? `🔑 Add ${motionProviderName ?? "provider"} key`
                : "✦ Generate motion"}
          </button>
        </div>
      </div>
    </div>
  );
}
