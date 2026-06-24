import { createMiddleware } from "hono/factory";
import { auth, isAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { ApiEnv } from "./types";

/**
 * 認証必須。NextAuth の auth() でセッションを解決し、後段へ渡す。
 * auth() は next/headers 依存だが、catch-all Route Handler 経由（Next のリクエスト
 * ライフサイクル内）で実行されるため動作する。
 */
export const requireAuth = createMiddleware<ApiEnv>(async (c, next) => {
  const session = await auth();
  if (!session?.user) return c.json({ error: "unauthorized" }, 401);
  c.set("session", session);
  await next();
});

/** 管理者必須（requireAuth の後段で使う）。 */
export const requireAdmin = createMiddleware<ApiEnv>(async (c, next) => {
  if (!isAdmin(c.get("session"))) return c.json({ error: "forbidden" }, 403);
  await next();
});

/**
 * パスパラメータ :id のファイルを引き、所有者 or 管理者のみ許可。
 * 解決したファイルを c.set("file") で後段へ渡し、download/delete/shares の重複を集約する。
 * （旧 loadOwnedFile 相当。ステータスでの絞り込みはせず実在のみ確認＝旧挙動を踏襲）
 */
export const requireFileOwner = createMiddleware<ApiEnv>(async (c, next) => {
  const session = c.get("session");
  const file = await prisma.file.findUnique({ where: { id: c.req.param("id") } });
  if (!file) return c.json({ error: "not found" }, 404);
  if (file.ownerId !== session.user.id && !isAdmin(session)) {
    return c.json({ error: "forbidden" }, 403);
  }
  c.set("file", file);
  await next();
});

/**
 * c.get("file") が配信可能（READY）であることを保証（requireFileOwner の後段）。
 * 旧 /files/[id]/download の status 判定をそのまま移設。
 */
export const requireReady = createMiddleware<ApiEnv>(async (c, next) => {
  const file = c.get("file");
  if (file.status === "DELETED" || file.status === "EXPIRED") {
    return c.json({ error: "not found" }, 404);
  }
  if (file.status !== "READY") {
    return c.json({ error: "file not ready", status: file.status }, 409);
  }
  await next();
});

/**
 * パスパラメータ :id の共有リンク（+ファイル）を引き、ファイル所有者 or 管理者のみ許可。
 * 解決した共有リンクを c.set("share") で後段へ渡す。
 */
export const requireShareOwner = createMiddleware<ApiEnv>(async (c, next) => {
  const session = c.get("session");
  const share = await prisma.shareLink.findUnique({
    where: { id: c.req.param("id") },
    include: { file: true },
  });
  if (!share) return c.json({ error: "not found" }, 404);
  if (share.file.ownerId !== session.user.id && !isAdmin(session)) {
    return c.json({ error: "forbidden" }, 403);
  }
  c.set("share", share);
  await next();
});
