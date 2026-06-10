import type { IncomingMessage } from "node:http";
import { Server, type Upload } from "@tus/server";
import { FileStore } from "@tus/file-store";
import { getToken } from "next-auth/jwt";
import { config, expiryFromNow } from "./config";
import { ensureUploadDir, hasFreeSpaceFor } from "./storage";
import { prisma } from "./db";
import { enqueueScan } from "./queue";
import { writeAudit } from "./audit";

const TUS_PATH = "/api/upload";
const isHttps = config.publicBaseUrl.startsWith("https");

/**
 * クライアント指定の保管期限（日数）を検証してクランプする。
 * メタデータは信用できないため、サーバ側で 1..maxExpiryDays に丸める。
 */
function resolveExpiryDays(raw: string | null | undefined): number {
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || n < 1) return config.defaultExpiryDays;
  return Math.min(n, config.maxExpiryDays);
}

/**
 * Promise にタイムアウトを付与する。依存サービス(Redis等)が応答しない場合でも
 * onUploadFinish が無限に待たず、アップロード完了応答を返せるようにする。
 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

class TusError extends Error {
  status_code: number;
  body: string;
  constructor(status: number, message: string) {
    super(message);
    this.status_code = status;
    this.body = message;
  }
}

async function getUserId(req: IncomingMessage): Promise<string | null> {
  const token = await getToken({
    req: req as never,
    secret: process.env.AUTH_SECRET,
    secureCookie: isHttps,
  });
  return (token?.sub as string) ?? null;
}

/** tus サーバを生成（カスタムサーバ server.ts からマウント） */
export async function createTusServer(): Promise<Server> {
  await ensureUploadDir();

  const datastore = new FileStore({ directory: config.uploadDir });

  const server = new Server({
    path: TUS_PATH,
    datastore,
    maxSize: config.maxFileSize,
    respectForwardedHeaders: true,
    // 完了済みアップロードの実体は File レコードが参照する本体ファイルなので、
    // クライアントの DELETE(キャンセル)で削除されないようにする。
    disableTerminationForFinishedUploads: true,

    // 全メソッド共通の認証。これが無いと既存アップロードへの
    // HEAD/PATCH/DELETE が無認証で通ってしまう。
    async onIncomingRequest(req, _res, uploadId) {
      if (req.method === "OPTIONS") return;
      const userId = await getUserId(req);
      if (!userId) throw new TusError(401, "ログインが必要です");

      // 既存アップロードへの操作（再開・キャンセル等）は所有者のみ許可
      if (uploadId && req.method !== "POST") {
        const upload = await datastore.getUpload(uploadId).catch(() => null);
        if (upload?.metadata?.ownerId && upload.metadata.ownerId !== userId) {
          throw new TusError(403, "このアップロードを操作する権限がありません");
        }
      }
    },

    async onUploadCreate(req, res, upload: Upload) {
      const userId = await getUserId(req);
      if (!userId) throw new TusError(401, "ログインが必要です");

      // JWT は署名が有効でも、ユーザがDBから消えている（DB再作成後の古いCookie等）
      // 場合がある。File 作成時の外部キー制約違反を避けるため、ここで実在を確認する。
      const owner = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, isActive: true },
      });
      if (!owner || !owner.isActive) {
        throw new TusError(401, "セッションが無効です。再度ログインしてください");
      }

      const size = upload.size ?? 0;
      if (size <= 0) throw new TusError(400, "ファイルサイズが不明です");
      if (size > config.maxFileSize) {
        throw new TusError(413, "ファイルサイズが上限を超えています");
      }
      if (!(await hasFreeSpaceFor(size))) {
        throw new TusError(507, "サーバの空き容量が不足しています");
      }

      return { res, metadata: { ...upload.metadata, ownerId: userId } };
    },

    async onUploadFinish(_req, res, upload: Upload) {
      const ownerId = upload.metadata?.ownerId;
      if (!ownerId) {
        // owner不明: 不正なアップロードとして実体は FileStore に残るが File は作らない
        console.error("[tus] upload finished without ownerId", upload.id);
        return { res };
      }

      // アップロード完了は時間がかかるため、その間にユーザが削除/無効化される
      // 可能性がある。外部キー制約違反でサーバを落とさないよう実在を再確認する。
      const owner = await prisma.user.findUnique({
        where: { id: ownerId },
        select: { id: true },
      });
      if (!owner) {
        console.error("[tus] upload finished for missing owner", ownerId, upload.id);
        return { res };
      }

      const originalName = upload.metadata?.filename || upload.id;
      const mimeType = upload.metadata?.filetype || null;
      const expiryDays = resolveExpiryDays(upload.metadata?.expiryDays);

      const file = await prisma.file.create({
        data: {
          ownerId,
          originalName,
          mimeType,
          size: BigInt(upload.size ?? 0),
          storagePath: upload.id, // FileStore は upload.id 名で保存
          status: "SCANNING",
          expiresAt: expiryFromNow(expiryDays),
        },
      });

      // File は作成済み（= 真実の状態）。スキャン投入・監査の遅延/失敗で
      // tus の完了応答(204)をブロックし、クライアントのアップロードが永久に
      // 終わらなくなることを防ぐ。失敗は握りつぶさず必ずログに残す。
      try {
        await withTimeout(enqueueScan(file.id), 10_000, "enqueueScan");
      } catch (err) {
        console.error("[tus] enqueueScan failed", file.id, err);
      }
      try {
        await withTimeout(
          writeAudit({
            userId: ownerId,
            action: "FILE_UPLOADED",
            targetType: "file",
            targetId: file.id,
            result: "ok",
            detail: { originalName, size: String(upload.size ?? 0) },
          }),
          10_000,
          "writeAudit",
        );
      } catch (err) {
        console.error("[tus] writeAudit failed", file.id, err);
      }

      return { res };
    },
  });

  return server;
}

export { TUS_PATH };
