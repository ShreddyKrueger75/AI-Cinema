"use client";

import { create } from "zustand";

export type ConfirmPrompt = {
  id: string;
  title: string;
  message: string;
  confirm_label: string;
  cancel_label: string;
  destructive: boolean;
  onConfirm: () => void | Promise<void>;
  alt_label?: string;
  onAlt?: () => void | Promise<void>;
};

export type ConfirmState = {
  prompt: ConfirmPrompt | null;
  ask: (
    p: Omit<ConfirmPrompt, "id" | "confirm_label" | "cancel_label" | "destructive"> & {
      confirm_label?: string;
      cancel_label?: string;
      destructive?: boolean;
      alt_label?: string;
      onAlt?: () => void | Promise<void>;
    },
  ) => void;
  resolve: () => Promise<void>;
  resolveAlt: () => Promise<void>;
  cancel: () => void;
};

function newId(): string {
  const u = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return `c_${u.slice(0, 8)}`;
}

export const useConfirm = create<ConfirmState>((set, get) => ({
  prompt: null,
  ask: (p) =>
    set({
      prompt: {
        id: newId(),
        title: p.title,
        message: p.message,
        confirm_label: p.confirm_label ?? "Confirm",
        cancel_label: p.cancel_label ?? "Cancel",
        destructive: p.destructive ?? false,
        onConfirm: p.onConfirm,
        alt_label: p.alt_label,
        onAlt: p.onAlt,
      },
    }),
  resolve: async () => {
    const current = get().prompt;
    if (!current) return;
    set({ prompt: null });
    await current.onConfirm();
  },
  resolveAlt: async () => {
    const current = get().prompt;
    if (!current || !current.onAlt) return;
    set({ prompt: null });
    await current.onAlt();
  },
  cancel: () => set({ prompt: null }),
}));

export const confirmAsk = (
  args: Parameters<ConfirmState["ask"]>[0],
) => useConfirm.getState().ask(args);
