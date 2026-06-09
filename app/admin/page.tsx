import { redirect } from "next/navigation";
import { auth, isAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getFreeSpace } from "@/lib/storage";
import { formatBytes, remainingTime } from "@/lib/format";
import { AdminInvite } from "@/components/AdminInvite";

export default async function AdminPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!isAdmin(session)) redirect("/files");

  // 独立した集計は並列実行（waterfall を避ける）
  const [activeCount, sizeAgg, infected, recentAudit, freeSpace] =
    await Promise.all([
      prisma.file.count({ where: { status: { in: ["READY", "SCANNING"] } } }),
      prisma.file.aggregate({
        _sum: { size: true },
        where: { status: { in: ["READY", "SCANNING"] } },
      }),
      prisma.file.findMany({
        where: { status: "INFECTED" },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, originalName: true, createdAt: true },
      }),
      prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 12,
        select: { id: true, action: true, createdAt: true, result: true },
      }),
      getFreeSpace().catch(() => 0),
    ]);

  const totalSize = sizeAgg._sum.size ?? BigInt(0);

  const stats = [
    { label: "保管中", value: String(activeCount), unit: "件" },
    { label: "使用容量", value: formatBytes(totalSize), unit: "" },
    { label: "空き容量", value: formatBytes(freeSpace), unit: "" },
    { label: "感染検出", value: String(infected.length), unit: "件" },
  ];

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-10 flex items-end justify-between border-b border-line pb-6">
        <div className="animate-rise-in">
          <p className="field-label">Campus Post Office · 管理</p>
          <h1 className="mt-1 font-display text-5xl font-semibold tracking-tight">
            管理
          </h1>
        </div>
        <a href="/files" className="btn-ghost">
          ファイルへ戻る
        </a>
      </header>

      {/* 集計の伝票カード */}
      <section className="mb-10 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((s, i) => (
          <div
            key={s.label}
            className="card-paper animate-rise-in p-5"
            style={{ animationDelay: `${i * 50}ms` }}
          >
            <p className="field-label">{s.label}</p>
            <p className="mt-2 font-display text-3xl">
              {s.value}
              <span className="ml-1 font-mono text-sm text-muted">{s.unit}</span>
            </p>
          </div>
        ))}
      </section>

      {/* ユーザー招待 */}
      <section className="mb-10">
        <div className="mb-3 flex items-center gap-2">
          <span className="postmark px-2 py-0.5 text-[10px]">User</span>
          <h2 className="font-display text-xl">ユーザーを追加</h2>
        </div>
        <AdminInvite />
      </section>

      <div className="grid gap-10 lg:grid-cols-2">
        {/* 感染アラート */}
        <section>
          <div className="mb-3 flex items-center gap-2">
            <span className="postmark border-postal px-2 py-0.5 text-[10px] text-postal">
              Alert
            </span>
            <h2 className="font-display text-xl">感染検出の履歴（自動削除済み）</h2>
          </div>
          <div className="card-paper p-5">
            {infected.length === 0 ? (
              <p className="font-body italic text-muted">感染は検出されていません。</p>
            ) : (
              <ul className="space-y-2">
                {infected.map((f) => (
                  <li key={f.id} className="flex justify-between font-mono text-xs">
                    <span className="truncate text-postal">{f.originalName}</span>
                    <span className="text-muted">{remainingTime(f.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* 監査ログ */}
        <section>
          <div className="mb-3 flex items-center gap-2">
            <span className="postmark px-2 py-0.5 text-[10px]">Log</span>
            <h2 className="font-display text-xl">最近の操作ログ</h2>
          </div>
          <div className="card-paper p-5">
            <ul className="space-y-2">
              {recentAudit.map((a) => (
                <li
                  key={a.id}
                  className="flex justify-between font-mono text-[11px] text-ink"
                >
                  <span>{a.action}</span>
                  <span className="text-muted">{a.result}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}
