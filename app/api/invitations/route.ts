import { NextResponse } from "next/server";
import { z } from "zod";
import { Role } from "@prisma/client";
import { auth, isAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { generateToken } from "@/lib/token";
import { config } from "@/lib/config";
import { writeAudit } from "@/lib/audit";

const createSchema = z.object({
  email: z.string().email().optional(),
  role: z.nativeEnum(Role).optional(),
});

/** 招待リンクを発行（管理者のみ）。1リンク＝1アカウント、有効期限内のみ。 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdmin(session)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const expiresAt = new Date(Date.now() + config.inviteExpiryHours * 60 * 60 * 1000);
  const invite = await prisma.invitation.create({
    data: {
      email: parsed.data.email,
      role: parsed.data.role ?? Role.MEMBER,
      token: generateToken(),
      expiresAt,
      createdById: session.user.id,
    },
  });

  await writeAudit({
    userId: session.user.id,
    action: "USER_INVITED",
    targetType: "user",
    targetId: invite.id,
    result: "ok",
    detail: { email: parsed.data.email ?? null, role: invite.role },
  });

  return NextResponse.json({
    invite: {
      url: `${config.publicBaseUrl}/invite/${invite.token}`,
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expiresAt,
    },
  });
}
