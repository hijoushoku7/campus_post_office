import { readdir, stat } from "node:fs/promises";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { cleanupQueue, SCAN_QUEUE, CLEANUP_QUEUE, type ScanJobData } from "@/lib/queue";
import { config } from "@/lib/config";
import { prisma } from "@/lib/db";
import { scanPath, ping } from "@/lib/clamd";
import { resolveStoragePath, deleteStorageFile } from "@/lib/storage";
import { writeAudit } from "@/lib/audit";

// Worker はブロッキング処理のため Queue とは別の専用コネクションを使う
const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

// ---- スキャンワーカー ----
const scanWorker = new Worker<ScanJobData>(
  SCAN_QUEUE,
  async (job) => {
    const { fileId } = job.data;
    const file = await prisma.file.findUnique({ where: { id: fileId } });
    if (!file || file.status !== "SCANNING") return;

    const absPath = resolveStoragePath(file.storagePath);
    const result = await scanPath(absPath);

    // スキャン中(最大30分)にユーザーが削除している可能性があるため、
    // SCANNING のままの場合だけ状態を進める（DELETED → READY への復活を防ぐ）。
    if (result.clean) {
      const updated = await prisma.file.updateMany({
        where: { id: fileId, status: "SCANNING" },
        data: { status: "READY" },
      });
      if (updated.count > 0) console.log(`[scan] clean: ${file.originalName} (${fileId})`);
      return;
    }

    // 感染検出 → 自動削除 + 監査記録（管理者はアプリ内で確認）
    await deleteStorageFile(file.storagePath);
    const updated = await prisma.file.updateMany({
      where: { id: fileId, status: "SCANNING" },
      data: { status: "INFECTED" },
    });
    if (updated.count === 0) return; // スキャン中に削除済み
    await writeAudit({
      userId: file.ownerId,
      action: "FILE_INFECTED",
      targetType: "file",
      targetId: fileId,
      result: "ok",
      detail: { signature: result.signature, originalName: file.originalName },
    });
    console.warn(`[scan] INFECTED & deleted: ${file.originalName} (${result.signature})`);
  },
  { connection, concurrency: 2 },
);

/**
 * 放棄された tus アップロードの掃除。
 * 未完了のままタブを閉じる/リロードすると、部分データ(<id>)と再開用メタ(<id>.json)が
 * File レコードを持たないまま残り、期限切れ処理の対象にならず永久に溜まる。
 * 一定時間(staleUploadHours)更新の無いものを放棄とみなして削除する。
 * 完了済みアップロードの .json メタも不要になった時点で削除する（実体は本体ファイルなので残す）。
 */
async function cleanupStaleUploads(): Promise<number> {
  const cutoff = Date.now() - config.staleUploadHours * 60 * 60 * 1000;
  const entries = await readdir(config.uploadDir);
  let removed = 0;

  const infoNames = entries.filter((n) => n.endsWith(".json"));
  if (infoNames.length === 0) return 0;

  // File レコードの有無は1クエリでまとめて引いて Set 照合する（N+1 回避）
  const ids = infoNames.map((n) => n.slice(0, -".json".length));
  const rows = await prisma.file.findMany({
    where: { storagePath: { in: ids } },
    select: { storagePath: true },
  });
  const completed = new Set(rows.map((r) => r.storagePath));

  for (const name of infoNames) {
    const id = name.slice(0, -".json".length);

    // File レコードがある = アップロード完了済み。再開用メタだけ片付ける。
    if (completed.has(id)) {
      await deleteStorageFile(name);
      continue;
    }

    // 未完了アップロード: 最終更新が cutoff より古ければ放棄とみなす
    // （新しいものはユーザーが再開する可能性があるので残す）
    const blobStat = await stat(resolveStoragePath(id)).catch(() => null);
    const infoStat = await stat(resolveStoragePath(name)).catch(() => null);
    const newest = Math.max(blobStat?.mtimeMs ?? 0, infoStat?.mtimeMs ?? 0);
    if (newest < cutoff) {
      await deleteStorageFile(id);
      await deleteStorageFile(name);
      removed++;
    }
  }
  return removed;
}

// ---- 期限切れ削除ワーカー ----
const cleanupWorker = new Worker(
  CLEANUP_QUEUE,
  async () => {
    const expired = await prisma.file.findMany({
      where: {
        expiresAt: { lt: new Date() },
        status: { notIn: ["EXPIRED", "DELETED"] },
      },
      select: { id: true, storagePath: true, ownerId: true },
    });

    for (const f of expired) {
      await deleteStorageFile(f.storagePath);
      await prisma.file.update({ where: { id: f.id }, data: { status: "EXPIRED" } });
      await writeAudit({
        userId: f.ownerId,
        action: "FILE_EXPIRED",
        targetType: "file",
        targetId: f.id,
        result: "ok",
      });
    }
    if (expired.length) console.log(`[cleanup] expired ${expired.length} file(s)`);

    const stale = await cleanupStaleUploads();
    if (stale) console.log(`[cleanup] removed ${stale} stale upload(s)`);

    // 保持期限を過ぎた監査ログを削除（無限肥大の防止）
    const auditCutoff = new Date(Date.now() - config.auditRetentionDays * 24 * 60 * 60 * 1000);
    const prunedAudit = await prisma.auditLog.deleteMany({
      where: { createdAt: { lt: auditCutoff } },
    });
    if (prunedAudit.count) console.log(`[cleanup] pruned ${prunedAudit.count} audit log(s)`);
  },
  { connection },
);

scanWorker.on("failed", (job, err) =>
  console.error(`[scan] job ${job?.id} failed:`, err.message),
);
cleanupWorker.on("failed", (job, err) =>
  console.error(`[cleanup] job ${job?.id} failed:`, err.message),
);

async function bootstrap() {
  const alive = await ping();
  console.log(`[worker] started. clamd: ${alive ? "OK" : "unreachable"}`);

  // 期限切れ削除を10分毎に実行（繰り返しジョブ）
  await cleanupQueue.add(
    "cleanup",
    {},
    {
      repeat: { every: 10 * 60 * 1000 },
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});

async function shutdown() {
  await Promise.all([scanWorker.close(), cleanupWorker.close()]);
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
