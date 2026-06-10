import type { Prisma } from "@prisma/client";

/** 一覧・取得系で使う「表示対象ファイル」の共通 where 句（DELETED/EXPIRED を除外） */
export function visibleFileWhere(ownerId?: string): Prisma.FileWhereInput {
  return {
    ...(ownerId ? { ownerId } : {}),
    status: { notIn: ["DELETED", "EXPIRED"] },
  };
}
