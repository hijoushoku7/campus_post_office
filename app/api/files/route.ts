import { NextResponse } from "next/server";
import { auth, isAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { visibleFileWhere } from "@/lib/file-query";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const all = url.searchParams.get("all") === "true" && isAdmin(session);

  const files = await prisma.file.findMany({
    where: visibleFileWhere(all ? undefined : session.user.id),
    orderBy: { createdAt: "desc" },
    take: 1000, // 安全弁: 無制限取得を防ぐ（UIページネーションは今後の課題）
    select: {
      id: true,
      originalName: true,
      size: true,
      status: true,
      expiresAt: true,
      createdAt: true,
      ownerId: true,
    },
  });

  return NextResponse.json({
    files: files.map((f) => ({ ...f, size: f.size.toString() })),
  });
}
