import { NextResponse } from "next/server";
import { auth, isAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const all = url.searchParams.get("all") === "true" && isAdmin(session);

  const files = await prisma.file.findMany({
    where: {
      ...(all ? {} : { ownerId: session.user.id }),
      status: { notIn: ["DELETED", "EXPIRED"] },
    },
    orderBy: { createdAt: "desc" },
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
