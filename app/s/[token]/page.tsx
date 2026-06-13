import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { checkShare } from "@/lib/share";
import { formatBytes } from "@/lib/format";

const REASON_TEXT: Record<string, string> = {
  not_found: "リンクが見つかりません",
  revoked: "このリンクは無効化されています",
  expired: "このリンクは有効期限が切れています",
  limit: "ダウンロード回数の上限に達しました",
  unavailable: "このファイルは現在ダウンロードできません（チェック中など）",
};

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const session = await auth();
  const { token } = await params;
  if (!session?.user) redirect(`/login?callbackUrl=/s/${token}`);

  const check = await checkShare(token);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md animate-rise-in">
        <div className="airmail-edge h-3 rounded-t-sm" />
        <div className="card-paper rounded-t-none p-9 text-center">
          <div className="mb-5 flex items-center justify-between">
            <p className="field-label">ShareMon Center</p>
            <span className="postmark px-2 py-0.5 text-[10px]">DL</span>
          </div>

          {!check.ok ? (
            <>
              <div className="postmark mx-auto mb-4 flex h-16 w-16 items-center justify-center text-3xl text-muted">
                ✕
              </div>
              <h1 className="font-display text-2xl">ダウンロードできません</h1>
              <p className="mt-2 font-body italic text-muted">
                {REASON_TEXT[check.reason] ?? "エラーが発生しました"}
              </p>
            </>
          ) : (
            <>
              <div className="postmark animate-stamp-in mx-auto mb-4 flex h-16 w-16 items-center justify-center text-3xl">
                ✉
              </div>
              <h1 className="truncate font-display text-2xl" title={check.share.file.originalName}>
                {check.share.file.originalName}
              </h1>
              <p className="mt-1 font-mono text-xs text-muted">
                {formatBytes(check.share.file.size)}
              </p>
              <a
                href={`/api/s/${token}/download`}
                className="btn-wax mt-7 w-full py-3"
              >
                ダウンロード
              </a>
              <p className="mt-3 font-body text-xs italic text-muted">
                このリンクはログインした人だけがダウンロードできます。
              </p>
            </>
          )}

          <Link href="/files" className="btn-ghost mt-6 w-full py-2.5">
            ホームへ戻る
          </Link>
        </div>
        <div className="airmail-edge h-3 rounded-b-sm opacity-70" />
      </div>
    </main>
  );
}
