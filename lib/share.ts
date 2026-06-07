import { prisma } from "./db";

export type ShareCheck =
  | { ok: true; share: NonNullable<Awaited<ReturnType<typeof loadShare>>> }
  | { ok: false; reason: "not_found" | "revoked" | "expired" | "limit" | "unavailable" };

async function loadShare(token: string) {
  return prisma.shareLink.findUnique({
    where: { token },
    include: { file: true },
  });
}

/** 共有リンクの有効性を検証（ログイン済み前提の呼び出し） */
export async function checkShare(token: string): Promise<ShareCheck> {
  const share = await loadShare(token);
  if (!share) return { ok: false, reason: "not_found" };
  if (share.revokedAt) return { ok: false, reason: "revoked" };
  if (share.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };
  if (share.maxDownloads != null && share.downloadCount >= share.maxDownloads) {
    return { ok: false, reason: "limit" };
  }
  if (share.file.status !== "READY") return { ok: false, reason: "unavailable" };
  return { ok: true, share };
}
