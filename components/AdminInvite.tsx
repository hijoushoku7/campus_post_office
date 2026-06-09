"use client";

import { useState } from "react";

export function AdminInvite() {
  const [busy, setBusy] = useState(false);
  const [asAdmin, setAsAdmin] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function copyLink(link: string) {
    const ok = await navigator.clipboard
      .writeText(link)
      .then(() => true)
      .catch(() => false);
    setCopied(ok);
  }

  async function createInvite() {
    setBusy(true);
    setError(null);
    setUrl(null);
    setCopied(false);
    const res = await fetch("/api/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: asAdmin ? "ADMIN" : "MEMBER" }),
    });
    setBusy(false);
    if (!res.ok) {
      setError("招待リンクの作成に失敗しました");
      return;
    }
    const data = await res.json();
    setUrl(data.invite.url);
    await copyLink(data.invite.url);
  }

  return (
    <div className="card-paper p-5">
      <div className="flex flex-wrap items-center gap-4">
        <button onClick={createInvite} disabled={busy} className="btn-wax py-2.5">
          {busy ? "発行中…" : "招待リンクを発行"}
        </button>
        <label className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
          <input
            type="checkbox"
            checked={asAdmin}
            onChange={(e) => setAsAdmin(e.target.checked)}
            className="accent-postal"
          />
          管理者として招待
        </label>
      </div>

      <p className="mt-3 font-body text-xs italic text-muted">
        リンクは1回のみ・有効期限内に限りアカウント登録できます。
      </p>

      {error ? (
        <p className="mt-3 border-l-2 border-postal bg-postal/5 px-3 py-2 font-mono text-xs text-postal-deep">
          {error}
        </p>
      ) : null}

      {url ? (
        <div className="mt-3 flex items-center gap-2 border-l-2 border-stamp bg-stamp/5 px-2 py-1">
          <p className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink">
            {copied ? "✓ コピー済み — " : ""}
            {url}
          </p>
          <button onClick={() => copyLink(url)} className="btn-ghost shrink-0 py-1">
            {copied ? "再コピー" : "コピー"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
