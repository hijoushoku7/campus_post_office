"use client";

import { useState } from "react";
import { FILES_CHANGED_EVENT } from "./FileList";

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
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const badge = STATUS[file.status] ?? STATUS.UPLOADING;

  async function copyLink(url: string) {
    const ok = await navigator.clipboard
      .writeText(url)
      .then(() => true)
      .catch(() => false);
    setCopied(ok);
  }

  async function createShare() {
    setBusy(true);
    const res = await fetch(`/api/files/${file.id}/shares`, { method: "POST" });
    setBusy(false);
    if (res.ok) {
      const data = await res.json();
      setShareUrl(data.share.url);
      await copyLink(data.share.url);
    }
  }

  async function remove() {
    setBusy(true);
    setDeleteError(null);
    const res = await fetch(`/api/files/${file.id}`, { method: "DELETE" });
    if (!res.ok) {
      // 削除に失敗したら行は消さず、エラーを提示
      setBusy(false);
      setDeleteError("削除に失敗しました。時間をおいて再度お試しください。");
      return;
    }
    // 行を畳むアニメーションを見せてから一覧を更新
    setRemoving(true);
    setTimeout(() => router.refresh(), 320);
  }

  return (
    <li
      className={`group overflow-hidden px-5 py-4 transition-colors hover:bg-paper-deep/40 ${
        removing ? "animate-fade-collapse pointer-events-none" : ""
      }`}
    >
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

        {/* 削除：確認はネイティブ alert ではなくインラインの伝票風パネルで */}
        {confirming ? null : (
          <button
            onClick={() => setConfirming(true)}
            disabled={busy}
            className="btn-ghost ml-auto border-postal/30 text-postal hover:border-postal hover:bg-postal/5"
          >
            削除
          </button>
        )}
      </div>

      {confirming ? (
        <div className="animate-rise-in mt-3 flex flex-wrap items-center gap-3 border-l-2 border-postal bg-postal/5 px-3 py-2.5">
          <p className="font-body text-[13px] text-postal-deep">
            {deleteError ?? "「" + file.originalName + "」を削除します。元に戻せません。"}
          </p>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="btn-ghost"
            >
              キャンセル
            </button>
            <button
              onClick={remove}
              disabled={busy}
              className="btn-wax px-4 py-1.5"
            >
              {busy ? "削除中…" : "削除する"}
            </button>
          </div>
        </div>
      ) : null}

      {shareUrl ? (
        <div className="mt-2 flex items-center gap-2 border-l-2 border-stamp bg-stamp/5 px-2 py-1">
          <p className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink">
            {copied ? "✓ コピー済み — " : ""}
            {shareUrl}
          </p>
          <button
            onClick={() => copyLink(shareUrl)}
            className="btn-ghost shrink-0 py-1"
          >
            {copied ? "再コピー" : "コピー"}
          </button>
        </div>
      ) : null}
    </li>
  );
}
