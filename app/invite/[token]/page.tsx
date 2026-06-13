import Link from "next/link";
import { checkInvite } from "@/lib/invite";
import { InviteForm } from "@/components/InviteForm";

const REASON_TEXT: Record<string, string> = {
  not_found: "招待リンクが見つかりません",
  accepted: "この招待リンクは既に使用されています",
  expired: "この招待リンクは有効期限が切れています",
};

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const check = await checkInvite(token);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-16 select-none font-display text-[24rem] leading-none text-ink/[0.03]"
      >
        ✉
      </div>

      <div className="relative w-full max-w-md animate-rise-in">
        <div className="airmail-edge h-3 rounded-t-sm" />
        <div className="card-paper rounded-t-none p-9">
          <header className="mb-7 space-y-1">
            <div className="flex items-center justify-between">
              <p className="field-label">ShareMon Center</p>
              <span className="postmark px-2 py-0.5 text-[10px]">Invite</span>
            </div>
            <h1 className="font-display text-4xl font-semibold tracking-tight">
              アカウント登録
            </h1>
            <p className="font-body text-sm text-muted">
              招待リンクからアカウントを作成します。
            </p>
          </header>

          {!check.ok ? (
            <div className="text-center">
              <div className="postmark mx-auto mb-4 flex h-16 w-16 items-center justify-center text-3xl text-muted">
                ✕
              </div>
              <p className="font-body italic text-muted">
                {REASON_TEXT[check.reason] ?? "エラーが発生しました"}
              </p>
              <Link href="/login" className="btn-ghost mt-6 w-full py-2.5">
                ログインへ
              </Link>
            </div>
          ) : (
            <InviteForm token={token} fixedEmail={check.invite.email} />
          )}
        </div>
        <div className="airmail-edge h-3 rounded-b-sm opacity-70" />
      </div>
    </main>
  );
}
