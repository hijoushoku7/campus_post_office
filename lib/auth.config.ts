import type { NextAuthConfig } from "next-auth";

/**
 * Edge ランタイム(middleware)でも読み込める共通設定。
 * ここには Prisma / argon2 などの Node 専用依存を含めないこと。
 * Credentials プロバイダ本体は lib/auth.ts 側で追加する。
 */
export const authConfig = {
  trustHost: true,
  session: { strategy: "jwt" }, // Credentials プロバイダは JWT 必須
  pages: { signIn: "/login" },
  providers: [], // 実体は lib/auth.ts で注入
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = (user as { role?: "ADMIN" | "MEMBER" }).role;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub as string;
        session.user.role = (token.role as "ADMIN" | "MEMBER") ?? "MEMBER";
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
