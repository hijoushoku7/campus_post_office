"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  // オープンリダイレクト対策：サイト内パス（"/" 始まり、"//" 始まりは除外）のみ許可
  const rawCallbackUrl = params.get("callbackUrl");
  const callbackUrl =
    rawCallbackUrl && rawCallbackUrl.startsWith("/") && !rawCallbackUrl.startsWith("//")
      ? rawCallbackUrl
      : "/files";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    setLoading(false);
    if (res?.error) {
      setError("メールアドレスまたはパスワードが正しくありません");
      return;
    }
    router.push(callbackUrl);
    router.refresh();
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-6">
      {/* 背景の薄い消印スタンプ群 */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-16 select-none font-display text-[24rem] leading-none text-ink/[0.03]"
      >
        ✉
      </div>

      <div className="relative w-full max-w-md animate-rise-in">
        {/* 封筒の上端：エアメールストライプ */}
        <div className="airmail-edge h-3 rounded-t-sm" />

        <form
          onSubmit={onSubmit}
          className="card-paper space-y-7 rounded-t-none p-9"
        >
          <header className="space-y-1">
            <div className="flex items-center justify-between">
              <p className="field-label">Campus Post Office</p>
              <span className="postmark px-2 py-0.5 text-[10px]">PO</span>
            </div>
            <h1 className="font-display text-4xl font-semibold tracking-tight">
              ログイン
            </h1>
            <p className="font-body text-sm text-muted">
              登録済みのメンバーのみログインできます。
            </p>
          </header>

          <div className="space-y-5">
            <label className="block space-y-1.5">
              <span className="field-label">メールアドレス</span>
              <input
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="ledger-input"
                placeholder="you@example.com"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="field-label">パスワード</span>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="ledger-input"
                placeholder="••••••••"
              />
            </label>
          </div>

          {error ? (
            <p className="border-l-2 border-postal bg-postal/5 px-3 py-2 font-mono text-xs text-postal-deep">
              {error}
            </p>
          ) : null}

          <button type="submit" disabled={loading} className="btn-wax w-full py-3">
            {loading ? "確認中…" : "ログイン"}
          </button>
        </form>

        {/* 封筒下端の目打ち風 */}
        <div className="airmail-edge h-3 rounded-b-sm opacity-70" />
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
