import { redirect } from "next/navigation";
import Link from "next/link";
import { auth, isAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { visibleFileWhere } from "@/lib/file-query";
import { formatBytes, remainingTime } from "@/lib/format";
import { FileList } from "@/components/FileList";
import type { FileItem } from "@/components/FileRow";

export default async function AdminFilesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!isAdmin(session)) redirect("/files");

  // ownerId を渡さず visibleFileWhere(undefined) で全ユーザーのファイルを取得。
  // GET /api/files?all=true（クライアントのポーリング）と同一の where 句。
  const files = await prisma.file.findMany({
    where: visibleFileWhere(),
    orderBy: { createdAt: "desc" },
    take: 1000, // 安全弁: 無制限取得を防ぐ（UIページネーションは今後の課題）
    select: {
      id: true,
      originalName: true,
      size: true,
      status: true,
      expiresAt: true,
      owner: { select: { email: true } },
    },
  });

  // クライアントには表示に必要な最小データのみ渡す（RSC境界の最小シリアライズ）
  const items: FileItem[] = files.map((f) => ({
    id: f.id,
    originalName: f.originalName,
    sizeLabel: formatBytes(f.size),
    status: f.status,
    remaining: remainingTime(f.expiresAt),
    ownerEmail: f.owner?.email ?? null,
  }));

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-10 flex items-end justify-between border-b border-line pb-6">
        <div className="animate-rise-in">
          <p className="field-label">ShareMon Center · 管理</p>
          <h1 className="mt-1 font-display text-5xl font-semibold tracking-tight">
            全ファイル
          </h1>
          <p className="mt-1 font-body italic text-muted">
            全ユーザーのファイルを閲覧・管理できます。
          </p>
        </div>
        <Link href="/admin" className="btn-ghost">
          管理へ戻る
        </Link>
      </header>

      <FileList initialItems={items} all />
    </main>
  );
}
