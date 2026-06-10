/**
 * DB取得の診断スクリプト群。
 *
 *   npx tsx scripts/diag-files.ts            # 全体サマリ + 全ユーザー分の取得テスト
 *   npx tsx scripts/diag-files.ts <email>    # 特定ユーザーに絞って検証
 *
 * 目的: /files と /api/files が {"files":[]} になる原因の切り分け。
 *  1) File が存在するか
 *  2) File.ownerId が実在 User.id と一致しているか（orphan 検出）
 *  3) アプリと同一クエリで本当に 0 件になるか
 *  4) status 条件で除外されているだけではないか
 */
import { PrismaClient } from "@prisma/client";
import { visibleFileWhere } from "../lib/file-query";

const prisma = new PrismaClient();

async function listUsersAndFiles() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, isActive: true },
  });
  const files = await prisma.file.findMany({
    select: { id: true, ownerId: true, status: true, originalName: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return { users, files };
}

/** 1) File.ownerId が User.id 集合に存在するか（orphan 検出） */
function reportOrphans(
  users: { id: string; email: string }[],
  files: { ownerId: string; status: string; originalName: string }[],
) {
  const userIds = new Set(users.map((u) => u.id));
  console.log("\n=== FILES (ownerId 突き合わせ) ===");
  if (files.length === 0) console.log("(File テーブルは空)");
  let orphans = 0;
  for (const f of files) {
    const ok = userIds.has(f.ownerId);
    if (!ok) orphans++;
    console.log(
      `${f.status.padEnd(9)} owner=${f.ownerId} ${ok ? "OK" : "★ORPHAN"} - ${f.originalName}`,
    );
  }
  return orphans;
}

/** 3)+4) アプリ同一クエリの件数と、status を外した件数を比較 */
async function testRetrieval(ownerId: string, label: string) {
  const appCount = await prisma.file.count({ where: visibleFileWhere(ownerId) });
  const ignoringStatus = await prisma.file.count({ where: { ownerId } });
  console.log(
    `  ${label}: アプリクエリ=${appCount} 件 / status無視=${ignoringStatus} 件` +
      (appCount === 0 && ignoringStatus > 0
        ? "  → status(DELETED/EXPIRED)で全除外されている可能性"
        : ""),
  );
  return appCount;
}

async function main() {
  const targetEmail = process.argv[2];
  const { users, files } = await listUsersAndFiles();

  console.log("=== USERS ===");
  if (users.length === 0) console.log("(User テーブルは空)");
  for (const u of users) console.log(`${u.id}  ${u.email}  active=${u.isActive}`);

  const orphans = reportOrphans(users, files);

  console.log("\n=== 取得テスト（アプリと同一クエリを再現） ===");
  const targets = targetEmail
    ? users.filter((u) => u.email === targetEmail)
    : users;
  if (targetEmail && targets.length === 0) {
    console.log(`★ email=${targetEmail} のユーザーが存在しません`);
  }
  for (const u of targets) {
    await testRetrieval(u.id, u.email);
  }

  console.log("\n=== サマリ ===");
  console.log(`Users: ${users.length}  Files: ${files.length}  Orphan files: ${orphans}`);
  if (orphans > 0) {
    console.log(
      "★ orphan あり: アップロード時の ownerId と、ログイン中の session.user.id が不一致。" +
        "\n  典型例: DB再作成/seed のやり直しで User.id が変わったのに、古いJWT Cookie が残っている。" +
        "\n  対処: 一度ログアウト→再ログインして新しい token.sub を取得する。",
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
