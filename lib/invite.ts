import { prisma } from "./db";

export type InviteCheck =
  | { ok: true; invite: NonNullable<Awaited<ReturnType<typeof loadInvite>>> }
  | { ok: false; reason: "not_found" | "accepted" | "expired" };

function loadInvite(token: string) {
  return prisma.invitation.findUnique({ where: { token } });
}

/** 招待トークンの有効性を検証（1回のみ・有効期限内）。 */
export async function checkInvite(token: string): Promise<InviteCheck> {
  const invite = await loadInvite(token);
  if (!invite) return { ok: false, reason: "not_found" };
  if (invite.acceptedAt) return { ok: false, reason: "accepted" };
  if (invite.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };
  return { ok: true, invite };
}
