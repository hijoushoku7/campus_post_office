"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface FileItem {
  id: string;
  originalName: string;
  sizeLabel: string;
  status: string;
  remaining: string;
}

const STATUS: Record<string, { text: string; cls: string }> = {
  UPLOADING: { text: "アップロード中", cls: "text-muted border-line" },
  SCANNING: { text: "チェック中", cls: "text-airmail border-airmail/40" },
  READY: { text: "利用可能", cls: "text-stamp border-stamp/50" },
  INFECTED: { text: "ブロック", cls: "text-postal border-postal/50" },
};

export function FileRow({ file }: { file: FileItem }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const badge = STATUS[file.status] ?? STATUS.UPLOADING;

  async function createShare() {
    setBusy(true);
    const res = await fetch(`/api/files/${file.id}/shares`, { method: "POST" });
    setBusy(false);
    if (res.ok) {
      const data = await res.json();
      setShareUrl(data.share.url);
      const ok = await navigator.clipboard
        .writeText(data.share.url)
        .then(() => true)
        .catch(() => false);
      setCopied(ok);
    }
  }

  async function remove() {
    if (!confirm(`「${file.originalName}」を削除しますか？`)) return;
    setBusy(true);
    await fetch(`/api/files/${file.id}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  }

  return (
    <li className="group px-5 py-4 transition-colors hover:bg-paper-deep/40">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-body text-[15px] font-medium text-ink">
            {file.originalName}
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-muted">
            {file.sizeLabel} · {file.remaining}
          </p>
        </div>

        {/* 消印風ステータス印 */}
        <span
          className={`shrink-0 rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.15em] ${badge.cls}`}
        >
          {badge.text}
        </span>
      </div>

      <div className="mt-3 flex items-center gap-2">
        {file.status === "READY" ? (
          <>
            <a href={`/api/files/${file.id}/download`} className="btn-ghost">
              ダウンロード
            </a>
            <button onClick={createShare} disabled={busy} className="btn-ghost">
              {busy ? "作成中…" : "共有リンク"}
            </button>
          </>
        ) : null}
        <button
          onClick={remove}
          disabled={busy}
          className="btn-ghost ml-auto border-postal/30 text-postal hover:border-postal hover:bg-postal/5"
        >
          削除
        </button>
      </div>

      {shareUrl ? (
        <p className="mt-2 truncate border-l-2 border-stamp bg-stamp/5 px-2 py-1 font-mono text-[11px] text-ink">
          {copied ? "✓ 共有リンクをコピーしました — " : ""}
          {shareUrl}
        </p>
      ) : null}
    </li>
  );
}
