import { NextResponse } from "next/server";
import { auth, isAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { deleteStorageFile } from "@/lib/storage";
import { writeAudit } from "@/lib/audit";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const file = await prisma.file.findUnique({ where: { id } });
  if (!file) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (file.ownerId !== session.user.id && !isAdmin(session)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await deleteStorageFile(file.storagePath);
  await prisma.file.update({
    where: { id },
    data: { status: "DELETED" },
  });
  await writeAudit({
    userId: session.user.id,
    action: "FILE_DELETED",
    targetType: "file",
    targetId: id,
    result: "ok",
  });

  return NextResponse.json({ ok: true });
}
