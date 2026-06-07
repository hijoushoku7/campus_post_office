import { randomBytes } from "node:crypto";
import { mkdir, statfs, unlink } from "node:fs/promises";
import path from "node:path";
import { config } from "./config";

/** アップロードディレクトリを保証 */
export async function ensureUploadDir(): Promise<void> {
  await mkdir(config.uploadDir, { recursive: true });
}

/** ランダムなストレージ用ファイル名を生成（原名はDBで保持） */
export function newStorageName(): string {
  return randomBytes(24).toString("hex");
}

/** storagePath（相対キー）から絶対パスを安全に解決。パストラバーサル防止。 */
export function resolveStoragePath(storageKey: string): string {
  const base = path.resolve(config.uploadDir);
  const resolved = path.resolve(base, storageKey);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error("Invalid storage path");
  }
  return resolved;
}

/** 空き容量（バイト）を返す */
export async function getFreeSpace(): Promise<number> {
  const s = await statfs(config.uploadDir);
  return s.bavail * s.bsize;
}

/** アップロード受理に十分な空き容量があるか */
export async function hasFreeSpaceFor(size: number): Promise<boolean> {
  const free = await getFreeSpace();
  return free - size >= config.minFreeSpace;
}

/** ファイル実体を削除（存在しなくてもエラーにしない） */
export async function deleteStorageFile(storageKey: string): Promise<void> {
  try {
    await unlink(resolveStoragePath(storageKey));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
  }
}
