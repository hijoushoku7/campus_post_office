import { randomBytes } from "node:crypto";

/** 推測困難なトークン（共有リンク・招待用）。32バイト base64url。 */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}
