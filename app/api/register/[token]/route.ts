import { NextResponse } from "next/server";
import { z } from "zod";
import { hash } from "@node-rs/argon2";
import { prisma } from "@/lib/db";
import { checkInvite } from "@/lib/invite";
import { writeAudit } from "@/lib/audit";

const acceptSchema = z.object({
  email: z.string().email().optional(),
  password: z.string().min(8, "パスワードは8文字以上にしてください"),
});

/** 招待トークンからアカウント登録（未ログインで実行）。 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const check = await checkInvite(token);
  if (!check.ok) {
    return NextResponse.json({ error: "invalid_invite", reason: check.reason }, { status: 410 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = acceptSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid body" },
      { status: 400 },
    );
  }

  // メールは招待で固定されていればそれを優先。なければ入力必須。
  const email = check.invite.email ?? parsed.data.email;
  if (!email) {
    return NextResponse.json({ error: "メールアドレスを入力してください" }, { status: 400 });
  }

  const passwordHash = await hash(parsed.data.password);

  try {
    const user = await prisma.$transaction(async (tx) => {
      // 招待を「使用済み」として原子的に確保（同時アクセス時の二重登録防止）
      const claim = await tx.invitation.updateMany({
        where: { token, acceptedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (claim.count === 0) {
        throw new Error("ALREADY_USED");
      }

      const existing = await tx.user.findUnique({ where: { email } });
      if (existing) {
        throw new Error("EMAIL_TAKEN");
      }

      return tx.user.create({
        data: {
          email,
          passwordHash,
          role: check.invite.role,
          isActive: true,
        },
      });
    });

    await writeAudit({
      userId: user.id,
      action: "USER_CREATED",
      targetType: "user",
      targetId: user.id,
      result: "ok",
      detail: { email, role: user.role, inviteId: check.invite.id },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg === "ALREADY_USED") {
      return NextResponse.json({ error: "この招待リンクは既に使用されています" }, { status: 410 });
    }
    if (msg === "EMAIL_TAKEN") {
      return NextResponse.json({ error: "このメールアドレスは既に登録されています" }, { status: 409 });
    }
    console.error("[register] failed", err);
    return NextResponse.json({ error: "登録に失敗しました" }, { status: 500 });
  }
}
