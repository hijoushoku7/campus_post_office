import type { AuditAction, Prisma } from "@prisma/client";
import { prisma } from "./db";

export interface AuditEntry {
  userId?: string | null;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  ip?: string;
  userAgent?: string;
  result?: "ok" | "denied" | "error";
  detail?: Prisma.InputJsonValue;
}

/** 監査ログを記録。失敗してもアプリ本処理を止めない。 */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: entry.userId ?? undefined,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        ip: entry.ip,
        userAgent: entry.userAgent,
        result: entry.result ?? "ok",
        detail: entry.detail,
      },
    });
  } catch (err) {
    console.error("[audit] failed to write audit log", err);
  }
}
