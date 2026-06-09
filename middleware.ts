import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

// Edge セーフな設定だけで NextAuth を生成（Prisma/argon2 を読み込まない）
const { auth } = NextAuth(authConfig);

// 認証必須ルートを保護。未ログインは /login へ。
export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const { pathname } = req.nextUrl;

  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/invite") ||
    pathname.startsWith("/api/register") ||
    pathname.startsWith("/api/auth");

  if (!isLoggedIn && !isPublic) {
    const url = new URL("/login", req.nextUrl.origin);
    url.searchParams.set("callbackUrl", pathname + req.nextUrl.search);
    return Response.redirect(url);
  }
});

export const config = {
  // 静的アセットと tus エンドポイント(カスタムサーバで認証)を除外
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/upload).*)"],
};
