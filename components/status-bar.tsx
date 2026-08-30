"use client";

import { useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { useProviderKeys } from "@/lib/providers";
import { Popover } from "@/components/ui";

export function StatusBar({
  hydrated,
  onOpenProviders,
  onOpenHelp,
}: {
  hydrated: boolean;
  onOpenProviders: () => void;
  onOpenHelp: () => void;
}) {
  const providerKeys = useProviderKeys((s) => s.keys);
  const configuredKeyCount = Object.values(providerKeys).filter((v) => v && v.trim()).length;
  return (
    <div className="statusbar">
      <div className="left">
        <span><span className="dot" />SYSTEM // ONLINE</span>
        <span>BUILD 0.0.1</span>
        <button
          type="button"
          className="status-link"
          onClick={onOpenProviders}
          title="Manage provider API keys"
        >
          <span className={`dot ${configuredKeyCount === 0 ? "warn" : ""}`} />
          {configuredKeyCount === 0
            ? "FREE PREVIEW · POLLINATIONS QUEUED · ADD KEY FOR RELIABILITY"
            : `PROVIDERS // ${configuredKeyCount} KEY${configuredKeyCount === 1 ? "" : "S"}`}
        </button>
      </div>
      <div className="right">
        <button
          type="button"
          className="status-link"
          onClick={onOpenProviders}
          title="Manage provider API keys"
          aria-label="Open Providers"
        >
          🔑 KEYS{configuredKeyCount > 0 ? ` (${configuredKeyCount})` : ""}
        </button>
        <button
          type="button"
          className="status-link"
          onClick={onOpenHelp}
          title="Help & keyboard shortcuts"
          aria-label="Open help"
        >
          ?
        </button>
        <span>{hydrated ? "STATE // PERSISTED" : "STATE // EPHEMERAL"}</span>
        <UserStatusChip />
      </div>
    </div>
  );
}

function UserStatusChip() {
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);
  if (status === "loading") return <span>SESSION // …</span>;
  if (!session?.user) {
    return (
      <a href="/login" className="status-link">SIGN IN</a>
    );
  }
  const email = session.user.email ?? session.user.name ?? "";
  const initial = (session.user.name ?? email).slice(0, 1).toUpperCase();
  return (
    <span className="popover-anchor">
      <button
        type="button"
        className="user-chip"
        onClick={() => setOpen((o) => !o)}
        title="Account"
      >
        <span className="user-avatar">{initial}</span>
        <span className="user-email">{email}</span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="menu" align="right">
        <div className="user-menu-head">
          <strong>{session.user.name ?? email}</strong>
          {session.user.name ? <span>{email}</span> : null}
        </div>
        <button
          type="button"
          className="menu-item"
          onClick={async () => {
            setOpen(false);
            await signOut({ redirect: false });
          }}
        >
          Sign out
        </button>
      </Popover>
    </span>
  );
}
