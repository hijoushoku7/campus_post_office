import { redirect } from "next/navigation";
import Link from "next/link";
import { auth, signOut } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { visibleFileWhere } from "@/lib/file-query";
import { formatBytes, remainingTime } from "@/lib/format";
import { config } from "@/lib/config";
import { Uploader } from "@/components/Uploader";
import { FileList } from "@/components/FileList";
import { RevealOverlay } from "@/components/RevealOverlay";
import type { FileItem } from "@/components/FileRow";

export default async function FilesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const files = await prisma.file.findMany({
    where: visibleFileWhere(session.user.id),
    orderBy: { createdAt: "desc" },
    take: 1000, // 安全弁: 無制限取得を防ぐ（UIページネーションは今後の課題）
    select: {
      id: true,
      originalName: true,
      size: true,
      status: true,
      expiresAt: true,
    },
  });

  // クライアントには表示に必要な最小データのみ渡す（RSC境界の最小シリアライズ）
  const items: FileItem[] = files.map((f) => ({
    id: f.id,
    originalName: f.originalName,
    sizeLabel: formatBytes(f.size),
    status: f.status,
    remaining: remainingTime(f.expiresAt),
  }));

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      {/* ローディング幕（loading.tsx）から中身へ 0.5s でフェードアウト */}
      <RevealOverlay caption="sorting the mail" />
      {/* ヘッダ */}
      <header className="mb-10 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6">
        <div className="animate-rise-in">
          <p className="field-label">Campus Post Office</p>
          <h1 className="mt-1 font-display text-5xl font-semibold tracking-tight">
            マイファイル
          </h1>
          <p className="mt-1 font-body italic text-muted">
            ファイルをアップロードして、メンバーと安全に共有できます。
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="field-label">ログイン中</p>
            <p className="font-mono text-sm text-ink">{session.user.email}</p>
          </div>
          {session.user.role === "ADMIN" ? (
            <Link href="/admin" className="btn-ghost">
              管理
            </Link>
          ) : null}
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button className="btn-ghost">ログアウト</button>
          </form>
        </div>
      </header>

      <div className="grid gap-10 lg:grid-cols-[1fr_1.4fr]">
        {/* アップロード */}
        <section className="animate-rise-in" style={{ animationDelay: "60ms" }}>
          <div className="mb-3 flex items-center gap-2">
            <span className="postmark px-2 py-0.5 text-[10px]">Up</span>
            <h2 className="font-display text-xl">アップロード</h2>
          </div>
          <Uploader
            defaultExpiryDays={config.defaultExpiryDays}
            maxExpiryDays={config.maxExpiryDays}
          />
        </section>

        {/* ファイル一覧（クライアントでポーリングしてスキャン状況を反映） */}
        <section className="animate-rise-in" style={{ animationDelay: "120ms" }}>
          <FileList initialItems={items} />
        </section>
      </div>
    </main>
  );
}
