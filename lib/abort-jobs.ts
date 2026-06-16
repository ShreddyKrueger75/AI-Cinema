"use client";

// Session-scoped registry of AbortController instances for in-flight
// generation jobs. Keyed by the same job key the genstate store uses
// (stillJobKey / motionJobKey / `vo:<id>` / `music:<id>`).
//
// Used so:
//  - Cancel buttons in the editor modals can abort the underlying fetch
//    without going through React state churn.
//  - Result handlers can check `signal.aborted` before writing back to
//    the project — late writes after user cancellation no longer
//    reanimate deleted sections or stomp fresh edits.

const controllers = new Map<string, AbortController>();

export function startJob(key: string): AbortController {
  const existing = controllers.get(key);
  if (existing) {
    try { existing.abort(); } catch { /* ignore */ }
  }
  const ctrl = new AbortController();
  controllers.set(key, ctrl);
  return ctrl;
}

export function abortJob(key: string): void {
  const ctrl = controllers.get(key);
  if (ctrl) {
    try { ctrl.abort(); } catch { /* ignore */ }
    controllers.delete(key);
  }
}

export function endJob(key: string): void {
  controllers.delete(key);
}

export function hasJob(key: string): boolean {
  return controllers.has(key);
}
