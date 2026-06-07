import { NextResponse } from "next/server";
import { auth, isAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { buildDownloadResponse } from "@/lib/download";
import { writeAudit } from "@/lib/audit";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const file = await prisma.file.findUnique({ where: { id } });
  if (!file || file.status === "DELETED" || file.status === "EXPIRED") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (file.ownerId !== session.user.id && !isAdmin(session)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (file.status !== "READY") {
    return NextResponse.json(
      { error: "file not ready", status: file.status },
      { status: 409 },
    );
  }

  await writeAudit({
    userId: session.user.id,
    action: "FILE_DOWNLOADED",
    targetType: "file",
    targetId: id,
    result: "ok",
  });

  return buildDownloadResponse(
    file.storagePath,
    file.originalName,
    file.mimeType,
    req.headers.get("range"),
  );
}
