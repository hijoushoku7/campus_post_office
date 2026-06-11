"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatBytes, remainingTime } from "@/lib/format";
import { FileRow, type FileItem } from "./FileRow";

/**
 * 一覧の更新を促すためのウィンドウイベント名。
 * アップロード完了(Uploader)や削除(FileRow)から dispatch される。
 */
export const FILES_CHANGED_EVENT = "cpo:files-changed";

// スキャン中など状態が変化しうる間は短間隔、安定したら長間隔でポーリングする。
const POLL_ACTIVE_MS = 3000;
const POLL_IDLE_MS = 20000;

interface ApiFile {
  id: string;
  originalName: string;
  size: string;
  status: string;
  expiresAt: string;
  ownerEmail?: string | null;
}

function toItem(f: ApiFile): FileItem {
  return {
    id: f.id,
    originalName: f.originalName,
    sizeLabel: formatBytes(Number(f.size)),
    status: f.status,
    remaining: remainingTime(new Date(f.expiresAt)),
    ownerEmail: f.ownerEmail ?? null,
  };
}

/** 処理中（一覧がまだ動く可能性がある）ファイルが存在するか */
function hasPending(items: FileItem[]): boolean {
  return items.some((f) => f.status === "UPLOADING" || f.status === "SCANNING");
}

export function FileList({
  initialItems,
  all = false,
}: {
  initialItems: FileItem[];
  /** admin の全ファイル閲覧。true なら ?all=true で全ユーザーのファイルを取得する */
  all?: boolean;
}) {
  const [items, setItems] = useState<FileItem[]>(initialItems);
  // 最新の items を参照しつつ、ポーリングのスケジュールを作り直さないための ref。
  // ref はポーリングの setTimeout コールバック内でのみ参照するため、
  // レンダー中の代入ではなく effect で同期する（react-hooks/refs）。
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(all ? "/api/files?all=true" : "/api/files", {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data: { files: ApiFile[] } = await res.json();
      setItems(data.files.map(toItem));
    } catch {
      // ネットワーク一時障害などは無視（次のポーリングで回復）
    }
  }, [all]);

  // 状態に応じた間隔で自動ポーリング。処理中ファイルが無くなれば間隔を広げる。
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    const tick = async () => {
      // タブが非表示の間は通信せず、次回のスケジュールだけ行う
      if (document.visibilityState !== "hidden") {
        await refresh();
      }
      if (cancelled) return;
      const delay = hasPending(itemsRef.current) ? POLL_ACTIVE_MS : POLL_IDLE_MS;
      timer = setTimeout(tick, delay);
    };

    // タブが再び表示されたら即時に更新する
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    timer = setTimeout(tick, hasPending(itemsRef.current) ? POLL_ACTIVE_MS : POLL_IDLE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  // アップロード完了・削除などの明示的な変更を受けて即時更新する。
  useEffect(() => {
    const handler = () => void refresh();
    window.addEventListener(FILES_CHANGED_EVENT, handler);
    return () => window.removeEventListener(FILES_CHANGED_EVENT, handler);
  }, [refresh]);

  const liveCount = items.filter((f) => f.status === "READY").length;

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="postmark px-2 py-0.5 text-[10px]">File</span>
          <h2 className="font-display text-xl">ファイル一覧</h2>
        </div>
        <span className="font-mono text-xs text-muted">
          共有可能 {liveCount} / 全 {items.length}
        </span>
      </div>

      <div className="card-paper overflow-hidden">
        <div className="airmail-edge h-2 opacity-60" />
        {items.length === 0 ? (
          <p className="px-5 py-16 text-center font-body italic text-muted">
            まだファイルがありません。最初のファイルをアップロードしましょう。
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((f) => (
              <FileRow key={f.id} file={f} />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
