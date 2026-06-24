import { Hono } from "hono";
import { handle } from "hono/vercel";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { Role } from "@prisma/client";
import { isAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { visibleFileWhere } from "@/lib/file-query";
import { buildDownloadResponse } from "@/lib/download";
import { deleteStorageFile, storageFileExists } from "@/lib/storage";
import { generateToken } from "@/lib/token";
import { checkShare } from "@/lib/share";
import { checkInvite } from "@/lib/invite";
import { writeAudit } from "@/lib/audit";
import { config } from "@/lib/config";
import { hash } from "@node-rs/argon2";
import type { ApiEnv } from "@/lib/api/types";
import {
  requireAuth,
  requireAdmin,
  requireFileOwner,
  requireReady,
  requireShareOwner,
} from "@/lib/api/middleware";

// すべての API は Next.js を介して catch-all Route Handler に集約。
// 例外: /api/upload*（tus, server.ts 直結）と /api/auth/*（NextAuth の固有ルート）は
// この catch-all より具体的に解決されるため、ここには到達しない。
const app = new Hono<ApiEnv>().basePath("/api");

// ── バリデーション失敗時のエラー整形（旧ハンドラの形状を踏襲）────────────────
const invalidBody = (
  result: { success: boolean },
  c: import("hono").Context,
) => {
  if (!result.success) return c.json({ error: "invalid body" }, 400);
};

// ── スキーマ ──────────────────────────────────────────────────────────────
const createShareSchema = z.object({
  expiresAt: z.string().datetime().optional(),
  maxDownloads: z.number().int().positive().optional(),
});

const createInviteSchema = z.object({
  email: z.string().email().optional(),
  role: z.nativeEnum(Role).optional(),
});

const acceptSchema = z.object({
  email: z.string().email().optional(),
  password: z.string().min(8, "パスワードは8文字以上にしてください"),
});

// ── ファイル一覧 ──────────────────────────────────────────────────────────
app.get("/files", requireAuth, async (c) => {
  const session = c.get("session");
  const all = c.req.query("all") === "true" && isAdmin(session);

  const files = await prisma.file.findMany({
    where: visibleFileWhere(all ? undefined : session.user.id),
    orderBy: { createdAt: "desc" },
    take: 1000, // 安全弁: 無制限取得を防ぐ（UIページネーションは今後の課題）
    select: {
      id: true,
      originalName: true,
      size: true,
      status: true,
      expiresAt: true,
      createdAt: true,
      ownerId: true,
      owner: { select: { email: true } },
    },
  });

  return c.json({
    files: files.map(({ owner, ...f }) => ({
      ...f,
      size: f.size.toString(),
      ownerEmail: owner?.email ?? null,
    })),
  });
});

// ── ファイル削除（論理削除 + 実体削除）────────────────────────────────────
app.delete("/files/:id", requireAuth, requireFileOwner, async (c) => {
  const session = c.get("session");
  const file = c.get("file");

  await deleteStorageFile(file.storagePath);
  await prisma.file.update({ where: { id: file.id }, data: { status: "DELETED" } });
  await writeAudit({
    userId: session.user.id,
    action: "FILE_DELETED",
    targetType: "file",
    targetId: file.id,
    result: "ok",
  });

  return c.json({ ok: true });
});

// ── ファイルダウンロード（Range 対応）──────────────────────────────────────
app.get(
  "/files/:id/download",
  requireAuth,
  requireFileOwner,
  requireReady,
  async (c) => {
    const session = c.get("session");
    const file = c.get("file");

    await writeAudit({
      userId: session.user.id,
      action: "FILE_DOWNLOADED",
      targetType: "file",
      targetId: file.id,
      result: "ok",
    });

    return buildDownloadResponse(
      file.storagePath,
      file.originalName,
      file.mimeType,
      c.req.header("range") ?? null,
    );
  },
);

// ── 共有リンク一覧 ────────────────────────────────────────────────────────
app.get("/files/:id/shares", requireAuth, requireFileOwner, async (c) => {
  const shares = await prisma.shareLink.findMany({
    where: { fileId: c.req.param("id") },
    orderBy: { createdAt: "desc" },
  });
  return c.json({
    shares: shares.map((s) => ({
      ...s,
      url: `${config.publicBaseUrl}/s/${s.token}`,
    })),
  });
});

// ── 共有リンク発行 ────────────────────────────────────────────────────────
app.post(
  "/files/:id/shares",
  requireAuth,
  requireFileOwner,
  zValidator("json", createShareSchema, invalidBody),
  async (c) => {
    const session = c.get("session");
    const file = c.get("file");
    const data = c.req.valid("json");

    // 共有リンクの期限はファイル期限を上限とする
    const requested = data.expiresAt ? new Date(data.expiresAt) : file.expiresAt;
    const expiresAt = requested > file.expiresAt ? file.expiresAt : requested;

    const share = await prisma.shareLink.create({
      data: {
        fileId: file.id,
        token: generateToken(),
        expiresAt,
        maxDownloads: data.maxDownloads,
        createdById: session.user.id,
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "SHARE_CREATED",
      targetType: "share",
      targetId: share.id,
      result: "ok",
      detail: { fileId: file.id },
    });

    return c.json({
      share: { ...share, url: `${config.publicBaseUrl}/s/${share.token}` },
    });
  },
);

// ── 共有リンク無効化 ──────────────────────────────────────────────────────
app.delete("/shares/:id", requireAuth, requireShareOwner, async (c) => {
  const session = c.get("session");
  const share = c.get("share");

  await prisma.shareLink.update({
    where: { id: share.id },
    data: { revokedAt: new Date() },
  });
  await writeAudit({
    userId: session.user.id,
    action: "SHARE_REVOKED",
    targetType: "share",
    targetId: share.id,
    result: "ok",
  });

  return c.json({ ok: true });
});

// ── 招待リンク発行（管理者のみ）────────────────────────────────────────────
app.post(
  "/invitations",
  requireAuth,
  requireAdmin,
  zValidator("json", createInviteSchema, invalidBody),
  async (c) => {
    const session = c.get("session");
    const data = c.req.valid("json");

    // JWT は署名が有効でも、ユーザがDBから消えている（DB再作成後の古いCookie等）
    // 場合がある。Invitation 作成時の外部キー制約違反を避けるため実在を確認する。
    const creator = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true },
    });
    if (!creator) return c.json({ error: "session invalid" }, 401);

    const expiresAt = new Date(Date.now() + config.inviteExpiryHours * 60 * 60 * 1000);
    const invite = await prisma.invitation.create({
      data: {
        email: data.email,
        role: data.role ?? Role.MEMBER,
        token: generateToken(),
        expiresAt,
        createdById: session.user.id,
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "USER_INVITED",
      targetType: "user",
      targetId: invite.id,
      result: "ok",
      detail: { email: data.email ?? null, role: invite.role },
    });

    return c.json({
      invite: {
        url: `${config.publicBaseUrl}/invite/${invite.token}`,
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expiresAt,
      },
    });
  },
);

// ── 共有メタ情報（ログイン必須）────────────────────────────────────────────
app.get("/s/:token", requireAuth, async (c) => {
  const check = await checkShare(c.req.param("token"));
  if (!check.ok) return c.json({ error: check.reason }, 410);

  const { share } = check;
  return c.json({
    file: {
      originalName: share.file.originalName,
      size: share.file.size.toString(),
      expiresAt: share.expiresAt,
    },
  });
});

// ── 共有リンク経由ダウンロード（ログイン必須）──────────────────────────────
app.get("/s/:token/download", requireAuth, async (c) => {
  const session = c.get("session");
  const check = await checkShare(c.req.param("token"));
  if (!check.ok) return c.json({ error: check.reason }, 410);

  const { share } = check;

  // 実体が無い場合（クリーンアップとのレース等）はカウントを消費させない
  if (!(await storageFileExists(share.file.storagePath))) {
    return c.json({ error: "unavailable" }, 410);
  }

  // DL回数を原子的に加算し、加算後の値で上限を厳密に判定する。
  // checkShare → increment の間に並行リクエストが入っても上限超過の配信を防ぐ。
  const updated = await prisma.shareLink.update({
    where: { id: share.id },
    data: { downloadCount: { increment: 1 } },
  });
  if (updated.maxDownloads != null && updated.downloadCount > updated.maxDownloads) {
    return c.json({ error: "limit" }, 410);
  }

  await writeAudit({
    userId: session.user.id,
    action: "FILE_DOWNLOADED",
    targetType: "file",
    targetId: share.file.id,
    result: "ok",
    detail: { via: "share", shareId: share.id },
  });

  return buildDownloadResponse(
    share.file.storagePath,
    share.file.originalName,
    share.file.mimeType,
    c.req.header("range") ?? null,
  );
});

// ── 招待トークンからアカウント登録（未ログインで実行）──────────────────────
app.post(
  "/register/:token",
  zValidator("json", acceptSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        { error: result.error.issues[0]?.message ?? "invalid body" },
        400,
      );
    }
  }),
  async (c) => {
    const token = c.req.param("token");

    const check = await checkInvite(token);
    if (!check.ok) {
      return c.json({ error: "invalid_invite", reason: check.reason }, 410);
    }

    const data = c.req.valid("json");

    // メールは招待で固定されていればそれを優先。なければ入力必須。
    const email = check.invite.email ?? data.email;
    if (!email) {
      return c.json({ error: "メールアドレスを入力してください" }, 400);
    }

    const passwordHash = await hash(data.password);

    try {
      const user = await prisma.$transaction(async (tx) => {
        // 招待を「使用済み」として原子的に確保（同時アクセス時の二重登録防止）
        const claim = await tx.invitation.updateMany({
          where: { token, acceptedAt: null },
          data: { acceptedAt: new Date() },
        });
        if (claim.count === 0) throw new Error("ALREADY_USED");

        const existing = await tx.user.findUnique({ where: { email } });
        if (existing) throw new Error("EMAIL_TAKEN");

        return tx.user.create({
          data: { email, passwordHash, role: check.invite.role, isActive: true },
        });
      });

      await writeAudit({
        userId: user.id,
        action: "USER_CREATED",
        targetType: "user",
        targetId: user.id,
        result: "ok",
        detail: { email, role: user.role, inviteId: check.invite.id },
      });

      return c.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg === "ALREADY_USED") {
        return c.json({ error: "この招待リンクは既に使用されています" }, 410);
      }
      if (msg === "EMAIL_TAKEN") {
        return c.json({ error: "このメールアドレスは既に登録されています" }, 409);
      }
      console.error("[register] failed", err);
      return c.json({ error: "登録に失敗しました" }, 500);
    }
  },
);

// ── 共通: 未定義ルート / 例外 ──────────────────────────────────────────────
app.notFound((c) => c.json({ error: "not found" }, 404));

app.onError((err, c) => {
  // 不正な JSON ボディ等、Hono が投げる HTTPException は JSON 形状で返す
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status as ContentfulStatusCode);
  }
  console.error("[api] unhandled error", err);
  return c.json({ error: "internal error" }, 500);
});

export const GET = handle(app);
export const POST = handle(app);
export const DELETE = handle(app);
