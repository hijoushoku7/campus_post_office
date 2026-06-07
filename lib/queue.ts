import { Queue } from "bullmq";
import IORedis from "ioredis";
import { config } from "./config";

// BullMQ は maxRetriesPerRequest=null が必要
export const connection = new IORedis(config.redisUrl, {
  maxRetriesPerRequest: null,
});

export const SCAN_QUEUE = "scan";
export const CLEANUP_QUEUE = "cleanup";

export interface ScanJobData {
  fileId: string;
}

export const scanQueue = new Queue<ScanJobData>(SCAN_QUEUE, { connection });
export const cleanupQueue = new Queue(CLEANUP_QUEUE, { connection });

/** スキャンジョブを投入 */
export async function enqueueScan(fileId: string): Promise<void> {
  await scanQueue.add(
    "scan",
    { fileId },
    {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  );
}
