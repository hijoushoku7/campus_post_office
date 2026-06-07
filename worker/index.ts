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

    if (result.clean) {
      await prisma.file.update({ where: { id: fileId }, data: { status: "READY" } });
      console.log(`[scan] clean: ${file.originalName} (${fileId})`);
      return;
    }

    // 感染検出 → 自動削除 + 監査記録（管理者はアプリ内で確認）
    await deleteStorageFile(file.storagePath);
    await prisma.file.update({ where: { id: fileId }, data: { status: "INFECTED" } });
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
