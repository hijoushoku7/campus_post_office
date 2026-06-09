import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth, isAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { generateToken } from "@/lib/token";
import { config } from "@/lib/config";
import { writeAudit } from "@/lib/audit";

const createSchema = z.object({
  expiresAt: z.string().datetime().optional(),
  maxDownloads: z.number().int().positive().optional(),
});

type LoadResult =
  | { file: NonNullable<Awaited<ReturnType<typeof prisma.file.findUnique>>>; error?: undefined }
  | { file?: undefined; error: NextResponse };

async function loadOwnedFile(id: string, session: Session): Promise<LoadResult> {
  const file = await prisma.file.findUnique({ where: { id } });
  if (!file) return { error: NextResponse.json({ error: "not found" }, { status: 404 }) };
  if (file.ownerId !== session.user.id && !isAdmin(session)) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { file };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const { error } = await loadOwnedFile(id, session);
  if (error) return error;

  const shares = await prisma.shareLink.findMany({
    where: { fileId: id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({
    shares: shares.map((s) => ({
      ...s,
      url: `${config.publicBaseUrl}/s/${s.token}`,
    })),
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const { file, error } = await loadOwnedFile(id, session);
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  // 共有リンクの期限はファイル期限を上限とする
  const requested = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : file!.expiresAt;
  const expiresAt = requested > file!.expiresAt ? file!.expiresAt : requested;

  const share = await prisma.shareLink.create({
    data: {
      fileId: id,
      token: generateToken(),
      expiresAt,
      maxDownloads: parsed.data.maxDownloads,
      createdById: session.user.id,
    },
  });

  await writeAudit({
    userId: session.user.id,
    action: "SHARE_CREATED",
    targetType: "share",
    targetId: share.id,
    result: "ok",
    detail: { fileId: id },
  });

  return NextResponse.json({
    share: { ...share, url: `${config.publicBaseUrl}/s/${share.token}` },
  });
}
