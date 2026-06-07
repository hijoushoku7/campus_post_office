import { NextResponse } from "next/server";
import { auth, isAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const share = await prisma.shareLink.findUnique({
    where: { id },
    include: { file: true },
  });
  if (!share) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (share.file.ownerId !== session.user.id && !isAdmin(session)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await prisma.shareLink.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
  await writeAudit({
    userId: session.user.id,
    action: "SHARE_REVOKED",
    targetType: "share",
    targetId: id,
    result: "ok",
  });

  return NextResponse.json({ ok: true });
}
