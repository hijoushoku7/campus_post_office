import type { Session } from "next-auth";
import type { File as DbFile, ShareLink } from "@prisma/client";

/** 共有リンク + 紐づくファイル（requireShareOwner が解決して渡す） */
export type ShareWithFile = ShareLink & { file: DbFile };

/**
 * Hono アプリの型付きコンテキスト。
 * ミドルウェアが c.set した値を、後段のミドルウェア/ハンドラが c.get で型安全に取り出す。
 */
export type ApiEnv = {
  Variables: {
    session: Session;
    file: DbFile;
    share: ShareWithFile;
  };
};
