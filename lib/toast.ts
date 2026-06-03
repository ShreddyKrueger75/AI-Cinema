"use client";

import { create } from "zustand";

export type ToastKind = "info" | "success" | "warn" | "error";

export type Toast = {
  id: string;
  kind: ToastKind;
  message: string;
  detail?: string;
  expires_at: number | null;
};

export type ToastState = {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id" | "expires_at"> & { duration_ms?: number | null }) => string;
  dismiss: (id: string) => void;
  clear: () => void;
};

function newId(): string {
  const u = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return `t_${u.slice(0, 8)}`;
}

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (toast) => {
    const id = newId();
    const duration = toast.duration_ms === undefined ? defaultDuration(toast.kind) : toast.duration_ms;
    const expires_at = duration === null ? null : Date.now() + duration;
    set((state) => ({
      toasts: [...state.toasts, { id, kind: toast.kind, message: toast.message, detail: toast.detail, expires_at }].slice(-6),
    }));
    if (duration !== null) {
      setTimeout(() => {
        const exists = get().toasts.some((t) => t.id === id);
        if (exists) get().dismiss(id);
      }, duration);
    }
    return id;
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

function defaultDuration(kind: ToastKind): number {
  if (kind === "error") return 8000;
  if (kind === "warn") return 6000;
  if (kind === "success") return 3500;
  return 4500;
}

export const toast = {
  info: (message: string, detail?: string) => useToasts.getState().push({ kind: "info", message, detail }),
  success: (message: string, detail?: string) => useToasts.getState().push({ kind: "success", message, detail }),
  warn: (message: string, detail?: string) => useToasts.getState().push({ kind: "warn", message, detail }),
  error: (message: string, detail?: string) => useToasts.getState().push({ kind: "error", message, detail }),
};
