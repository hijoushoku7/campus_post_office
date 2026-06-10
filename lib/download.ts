import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { resolveStoragePath } from "./storage";

/**
 * ローカルFS上のファイルを Range 対応でストリーミング配信する Response を生成。
 * 大容量(10GB)を低メモリで配信し、再開DLにも対応する。
 */
export async function buildDownloadResponse(
  storageKey: string,
  originalName: string,
  mimeType: string | null,
  rangeHeader: string | null,
): Promise<Response> {
  const absPath = resolveStoragePath(storageKey);

  // 実体が無い（クリーンアップとのレース・ディスク異常など）場合は 500 にせず 404 を返す
  let size: number;
  try {
    ({ size } = await stat(absPath));
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return Response.json({ error: "file missing" }, { status: 404 });
    }
    throw err;
  }

  const contentType = mimeType || "application/octet-stream";
  const dispositionName = encodeURIComponent(originalName);
  const baseHeaders: Record<string, string> = {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename*=UTF-8''${dispositionName}`,
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  };

  // Range リクエスト（部分・再開DL）
  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (match) {
      let start = match[1] ? parseInt(match[1], 10) : 0;
      let end = match[2] ? parseInt(match[2], 10) : size - 1;
      if (Number.isNaN(start)) start = 0;
      if (Number.isNaN(end) || end >= size) end = size - 1;

      if (start > end || start >= size) {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${size}` },
        });
      }

      const stream = createReadStream(absPath, { start, end });
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 206,
        headers: {
          ...baseHeaders,
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Content-Length": String(end - start + 1),
        },
      });
    }
  }

  // 全体配信
  const stream = createReadStream(absPath);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: { ...baseHeaders, "Content-Length": String(size) },
  });
}
