"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as tus from "tus-js-client";
import { FILES_CHANGED_EVENT } from "./FileList";
import { formatBytes } from "@/lib/format";

// Cloudflare の 1リクエスト 100MB 制約に収まるよう 50MB チャンクで送信
const CHUNK_SIZE = 50 * 1024 * 1024;

interface UploadItem {
  /** 採番カウンタ由来の安定 ID（uploadsRef のキーと同一） */
  id: number;
  name: string;
  progress: number;
  status: "uploading" | "done" | "error" | "canceled";
  error?: string;
}

// 保管期限の選択肢（日数）。maxExpiryDays を超えるものは除外して表示する。
const EXPIRY_OPTIONS = [1, 3, 7, 14, 30];

export function Uploader({
  defaultExpiryDays = 7,
  maxExpiryDays = 30,
  maxFileSize = 10 * 1024 * 1024 * 1024,
}: {
  defaultExpiryDays?: number;
  maxExpiryDays?: number;
  maxFileSize?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [expiryDays, setExpiryDays] = useState(defaultExpiryDays);

  // 選択肢は上限以内に絞り、既定値が無ければ補う
  const options = Array.from(
    new Set([...EXPIRY_OPTIONS.filter((d) => d <= maxExpiryDays), defaultExpiryDays]),
  ).sort((a, b) => a - b);

  // 最新の選択値を常に参照できるよう ref に同期（startUpload を作り直さない）。
  // ref は startUpload（ユーザー操作のコールバック）でのみ参照するため、
  // レンダー中の代入ではなく effect で同期する（react-hooks/refs）。
  const expiryRef = useRef(expiryDays);
  useEffect(() => {
    expiryRef.current = expiryDays;
  }, [expiryDays]);

  // 進行中の tus アップロード実体（キャンセル用）。items の index をキーにする。
  const uploadsRef = useRef(new Map<number, tus.Upload>());
  const nextIndexRef = useRef(0);

  const cancelUpload = useCallback(async (index: number) => {
    const upload = uploadsRef.current.get(index);
    if (!upload) return;
    uploadsRef.current.delete(index);
    // 先に UI をキャンセル表示にする（terminate の往復を待たせない）
    setItems((prev) =>
      prev.map((it) => (it.id === index ? { ...it, status: "canceled" } : it)),
    );
    try {
      // abort(true) = サーバへ DELETE を送り、部分データと再開情報を削除する
      await upload.abort(true);
    } catch {
      // 通信不良などで terminate できなくても、残骸はワーカーの定期掃除で削除される
    }
  }, []);

  const startUpload = useCallback(
    (file: File) => {
      // items は追記のみなので、採番カウンタが配列 index と一致する
      const index = nextIndexRef.current++;
      if (file.size > maxFileSize) {
        setItems((prev) => [
          ...prev,
          {
            id: index,
            name: file.name,
            progress: 0,
            status: "error",
            error: `ファイルサイズ上限（${formatBytes(maxFileSize)}）を超えています`,
          },
        ]);
        return;
      }

      setItems((prev) => [
        ...prev,
        { id: index, name: file.name, progress: 0, status: "uploading" },
      ]);

      const upload = new tus.Upload(file, {
        endpoint: "/api/upload",
        chunkSize: CHUNK_SIZE,
        retryDelays: [0, 3000, 5000, 10000, 20000],
        metadata: {
          filename: file.name,
          filetype: file.type || "application/octet-stream",
          expiryDays: String(expiryRef.current),
        },
        onError(error) {
          // キャンセル済みなら無視（abort に伴うエラーで表示を上書きしない）
          if (!uploadsRef.current.has(index)) return;
          uploadsRef.current.delete(index);
          setItems((prev) =>
            prev.map((it) =>
              it.id === index ? { ...it, status: "error", error: error.message } : it,
            ),
          );
        },
        onProgress(sent, total) {
          const pct = Math.round((sent / total) * 100);
          setItems((prev) =>
            prev.map((it) => (it.id === index ? { ...it, progress: pct } : it)),
          );
        },
        onSuccess() {
          uploadsRef.current.delete(index);
          setItems((prev) =>
            prev.map((it) =>
              it.id === index ? { ...it, progress: 100, status: "done" } : it,
            ),
          );
          // 一覧をすぐ更新（チェック中として表示 → 完了後 利用可能 に変わる）
          window.dispatchEvent(new Event(FILES_CHANGED_EVENT));
        },
      });

      uploadsRef.current.set(index, upload);

      // 中断したアップロードがあれば続きから再開
      upload.findPreviousUploads().then((prev) => {
        // start 前にキャンセルされていたら開始しない
        if (!uploadsRef.current.has(index)) return;
        if (prev.length) upload.resumeFromPreviousUpload(prev[0]);
        upload.start();
      });
    },
    [maxFileSize],
  );

  const onSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files) Array.from(files).forEach(startUpload);
      e.target.value = "";
    },
    [startUpload],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      Array.from(e.dataTransfer.files).forEach(startUpload);
    },
    [startUpload],
  );

  return (
    <div className="card-paper overflow-hidden">
      <div className="airmail-edge h-2 opacity-60" />
      <div className="p-5">
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-sm border-2 border-dashed p-10 text-center transition-colors ${
            dragging
              ? "border-postal bg-postal/5"
              : "border-line hover:border-ink hover:bg-paper-deep/40"
          }`}
        >
          <div className="postmark animate-stamp-in mb-3 flex h-14 w-14 items-center justify-center text-2xl">
            ✉
          </div>
          <p className="font-display text-lg">ここにファイルをドロップ</p>
          <p className="mt-1 font-mono text-[11px] text-muted">
            またはクリックして選択 · 最大{formatBytes(maxFileSize)} · 中断しても再開できます
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={onSelect}
          />
        </div>

        {/* 保管期限の指定（アップロード時に適用） */}
        <div
          className="mt-4 flex items-center justify-between gap-3"
          onClick={(e) => e.stopPropagation()}
        >
          <label htmlFor="expiry" className="field-label">
            保管期限
          </label>
          <select
            id="expiry"
            value={expiryDays}
            onChange={(e) => setExpiryDays(Number(e.target.value))}
            className="ledger-input w-auto cursor-pointer border border-line px-2 py-1.5"
          >
            {options.map((d) => (
              <option key={d} value={d}>
                {d}日後に削除
              </option>
            ))}
          </select>
        </div>

        {items.length > 0 ? (
          <ul className="mt-5 space-y-3">
            {items.map((it) => (
              <li key={it.id}>
                <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                  <span className="truncate text-ink">{it.name}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span
                      className={
                        it.status === "error"
                          ? "text-postal"
                          : it.status === "done"
                            ? "text-stamp"
                            : "text-muted"
                      }
                    >
                      {it.status === "error"
                        ? "× 失敗"
                        : it.status === "done"
                          ? "✓ 完了（ウイルスチェック中）"
                          : it.status === "canceled"
                            ? "− キャンセル済み"
                            : `${it.progress}%`}
                    </span>
                    {it.status === "uploading" ? (
                      <button
                        onClick={() => void cancelUpload(it.id)}
                        className="btn-ghost px-2 py-0.5 text-[10px]"
                      >
                        キャンセル
                      </button>
                    ) : null}
                  </span>
                </div>
                <div className="mt-1.5 h-px w-full bg-line">
                  <div
                    className={`h-px transition-all duration-300 ${
                      it.status === "error"
                        ? "bg-postal"
                        : it.status === "canceled"
                          ? "bg-line"
                          : "bg-stamp"
                    }`}
                    style={{
                      width: `${it.progress}%`,
                      height: "2px",
                      marginTop: "-0.5px",
                    }}
                  />
                </div>
                {it.status === "error" && it.error ? (
                  <p className="mt-1 font-mono text-[10px] text-postal/80">
                    {it.error}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
