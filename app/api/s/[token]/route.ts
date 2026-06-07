import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkShare } from "@/lib/share";

// 共有メタ情報（ログイン必須）
export async function GET(
  _req: Request,
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
  return NextResponse.json({
    file: {
      originalName: share.file.originalName,
      size: share.file.size.toString(),
      expiresAt: share.expiresAt,
    },
  });
}
