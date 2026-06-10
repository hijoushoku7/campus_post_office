import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkShare } from "@/lib/share";
import { storageFileExists } from "@/lib/storage";
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

  // 実体が無い場合（クリーンアップとのレース等）はカウントを消費させない
  if (!(await storageFileExists(share.file.storagePath))) {
    return NextResponse.json({ error: "unavailable" }, { status: 410 });
  }

  // DL回数を原子的に加算し、加算後の値で上限を厳密に判定する。
  // checkShare → increment の間に並行リクエストが入っても上限超過の配信を防ぐ。
  const updated = await prisma.shareLink.update({
    where: { id: share.id },
    data: { downloadCount: { increment: 1 } },
  });
  if (updated.maxDownloads != null && updated.downloadCount > updated.maxDownloads) {
    return NextResponse.json({ error: "limit" }, { status: 410 });
  }

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
