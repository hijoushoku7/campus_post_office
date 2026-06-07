import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkShare } from "@/lib/share";
import { buildDownloadResponse } from "@/lib/download";
import { writeAudit } from "@/lib/audit";

// 共有リンク経由ダウンロード（ログイン必須）
export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { token } = await params;
  const check = await checkShare(token);
  if (!check.ok) {
    return NextResponse.json({ error: check.reason }, { status: 410 });
  }

  const { share } = check;

  // DL回数を加算（上限超過は次回以降 checkShare で弾かれる）
  await prisma.shareLink.update({
    where: { id: share.id },
    data: { downloadCount: { increment: 1 } },
  });

  await writeAudit({
    userId: session.user.id,
    action: "FILE_DOWNLOADED",
    targetType: "file",
    targetId: share.file.id,
    result: "ok",
    detail: { via: "share", shareId: share.id },
  });

  return buildDownloadResponse(
    share.file.storagePath,
    share.file.originalName,
    share.file.mimeType,
    req.headers.get("range"),
  );
}
