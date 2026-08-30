"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { useProjectLibrary } from "@/lib/projects";
import { useCosts } from "@/lib/costs";
import { formatCost } from "@/components/lib";
import { Popover } from "@/components/ui";

export function Footer() {
  const project = useStore((s) => s.project);
  const projectOrder = useProjectLibrary((s) => s.order);
  const savedProjectsMap = useProjectLibrary((s) => s.projects);
  const projectStubs = useMemo(
    () => projectOrder.map((id) => savedProjectsMap[id]).filter(Boolean),
    [projectOrder, savedProjectsMap],
  );

  const costEvents = useCosts((s) => s.events);
  const resetCosts = useCosts((s) => s.reset);
  const [spendOpen, setSpendOpen] = useState(false);
  const spentTotal = useMemo(
    () => costEvents.reduce((sum, e) => sum + e.est_usd, 0),
    [costEvents],
  );
  const spentByProvider = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const e of costEvents) totals[e.provider] = (totals[e.provider] ?? 0) + e.est_usd;
    return Object.entries(totals).sort((a, b) => b[1] - a[1]);
  }, [costEvents]);

  return (
      <div className="footstrip">
        <span>// AI CINEMA · BUILT FOR THE LOVE OF THE GAME · MIT</span>
        <span className="footstrip-mid">
          {project.sections.length} SECTIONS · {project.vo_segments.length} VO · {projectStubs.length} SAVED ·{" "}
          <span className="popover-anchor">
            <button
              type="button"
              className="status-link"
              onClick={() => setSpendOpen((o) => !o)}
              title="Estimated provider spend recorded in this browser — click for the breakdown"
            >
              SPENT {formatCost(spentTotal)} EST
            </button>
            <Popover open={spendOpen} onClose={() => setSpendOpen(false)} className="spend-popover" align="center">
              <div className="spend-title">// EST SPEND · THIS BROWSER</div>
              {spentByProvider.length === 0 ? (
                <div className="spend-empty">NO PAID GENERATIONS RECORDED</div>
              ) : (
                spentByProvider.map(([provider, usd]) => (
                  <div key={provider} className="spend-row">
                    <span className="spend-provider">{provider}</span>
                    <span className="spend-usd">{formatCost(usd)}</span>
                  </div>
                ))
              )}
              <div className="spend-foot">
                <span className="spend-note">Estimates only — check your provider dashboards.</span>
                <button
                  type="button"
                  className="spend-reset"
                  onClick={() => {
                    resetCosts();
                    setSpendOpen(false);
                  }}
                >
                  ⟲ RESET
                </button>
              </div>
            </Popover>
          </span>
        </span>
        <span>BLOODY FINGERS SOFTWARE — 2026</span>
      </div>
  );
}
