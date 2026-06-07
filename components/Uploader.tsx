"use client";

import { useCallback, useRef, useState } from "react";
import * as tus from "tus-js-client";
import { useRouter } from "next/navigation";

// Cloudflare の 1リクエスト 100MB 制約に収まるよう 50MB チャンクで送信
const CHUNK_SIZE = 50 * 1024 * 1024;

interface UploadItem {
  name: string;
  progress: number;
  status: "uploading" | "done" | "error";
  error?: string;
}

export function Uploader() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);

  const startUpload = useCallback(
    (file: File) => {
      let index = -1;
      setItems((prev) => {
        index = prev.length;
        return [...prev, { name: file.name, progress: 0, status: "uploading" }];
      });

      const upload = new tus.Upload(file, {
        endpoint: "/api/upload",
        chunkSize: CHUNK_SIZE,
        retryDelays: [0, 3000, 5000, 10000, 20000],
        metadata: {
          filename: file.name,
          filetype: file.type || "application/octet-stream",
        },
        onError(error) {
          setItems((prev) =>
            prev.map((it, i) =>
              i === index ? { ...it, status: "error", error: error.message } : it,
            ),
          );
        },
        onProgress(sent, total) {
          const pct = Math.round((sent / total) * 100);
          setItems((prev) =>
            prev.map((it, i) => (i === index ? { ...it, progress: pct } : it)),
          );
        },
        onSuccess() {
          setItems((prev) =>
            prev.map((it, i) =>
              i === index ? { ...it, progress: 100, status: "done" } : it,
            ),
          );
          router.refresh();
        },
      });

      // 中断したアップロードがあれば続きから再開
      upload.findPreviousUploads().then((prev) => {
        if (prev.length) upload.resumeFromPreviousUpload(prev[0]);
        upload.start();
      });
    },
    [router],
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
            またはクリックして選択 · 最大10GB · 中断しても再開できます
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={onSelect}
          />
        </div>

        {items.length > 0 ? (
          <ul className="mt-5 space-y-3">
            {items.map((it, i) => (
              <li key={i}>
                <div className="flex justify-between font-mono text-[11px]">
                  <span className="truncate text-ink">{it.name}</span>
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
                        : `${it.progress}%`}
                  </span>
                </div>
                <div className="mt-1.5 h-px w-full bg-line">
                  <div
                    className={`h-px transition-all duration-300 ${
                      it.status === "error" ? "bg-postal" : "bg-stamp"
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
