"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function InviteForm({
  token,
  fixedEmail,
}: {
  token: string;
  fixedEmail: string | null;
}) {
  const router = useRouter();
  const [email, setEmail] = useState(fixedEmail ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("パスワードが一致しません");
      return;
    }
    setLoading(true);
    const res = await fetch(`/api/register/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: fixedEmail ? undefined : email, password }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "登録に失敗しました");
      return;
    }
    setDone(true);
    setTimeout(() => router.push("/login"), 1400);
  }

  if (done) {
    return (
      <div className="text-center">
        <div className="postmark animate-stamp-in mx-auto mb-4 flex h-16 w-16 items-center justify-center text-3xl text-stamp">
          ✓
        </div>
        <h1 className="font-display text-2xl">登録が完了しました</h1>
        <p className="mt-2 font-body italic text-muted">
          ログイン画面へ移動します…
        </p>
        <a href="/login" className="btn-wax mt-6 w-full py-3">
          ログインへ
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="space-y-5">
        <label className="block space-y-1.5">
          <span className="field-label">メールアドレス</span>
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            disabled={!!fixedEmail}
            onChange={(e) => setEmail(e.target.value)}
            className="ledger-input disabled:opacity-60"
            placeholder="you@example.com"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="field-label">パスワード（8文字以上）</span>
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="ledger-input"
            placeholder="••••••••"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="field-label">パスワード（確認）</span>
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
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
        {loading ? "登録中…" : "アカウントを作成"}
      </button>
    </form>
  );
}
