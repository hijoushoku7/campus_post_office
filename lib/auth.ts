import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { verify } from "@node-rs/argon2";
import { z } from "zod";
import { authConfig } from "./auth.config";
import { prisma } from "./db";
import { writeAudit } from "./audit";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// JWT はステートレスなため、無効化(isActive=false)・削除済みユーザーでも
// 有効期限内の Cookie で通ってしまう。この間隔ごとに DB で実在・有効性を再検証する。
const DB_REVALIDATE_MS = 10 * 60 * 1000;

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user }) {
      // ログイン直後: authorize が返した role を取り込み、検証時刻を記録
      if (user) {
        token.role = (user as { role?: "ADMIN" | "MEMBER" }).role;
        token.dbCheckedAt = Date.now();
        return token;
      }

      // 前回検証から一定時間経過していたら DB を再確認。
      // 無効化・削除されたユーザーは null を返してセッションを無効化する。
      if (Date.now() - (token.dbCheckedAt ?? 0) > DB_REVALIDATE_MS) {
        if (!token.sub) return null;
        const dbUser = await prisma.user.findUnique({
          where: { id: token.sub },
          select: { isActive: true, role: true },
        });
        if (!dbUser?.isActive) return null;
        token.role = dbUser.role;
        token.dbCheckedAt = Date.now();
      }
      return token;
    },
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (raw) => {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.isActive) {
          await writeAudit({ action: "LOGIN_FAILED", result: "denied", detail: { email } });
          return null;
        }

        const ok = await verify(user.passwordHash, password);
        if (!ok) {
          await writeAudit({
            userId: user.id,
            action: "LOGIN_FAILED",
            result: "denied",
            detail: { email },
          });
          return null;
        }

        await writeAudit({ userId: user.id, action: "LOGIN_SUCCESS", result: "ok" });
        return { id: user.id, email: user.email, role: user.role };
      },
    }),
  ],
});

export function isAdmin(session: { user?: { role?: string } } | null): boolean {
  return session?.user?.role === "ADMIN";
}
