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

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
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
