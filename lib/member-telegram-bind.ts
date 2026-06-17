import crypto from "crypto";

export const MEMBER_TG_BIND_TOKEN_BYTES = 32;
export const MEMBER_TG_BIND_TOKEN_TTL_MINUTES = 15;
export const MEMBER_TG_BIND_TOKEN_HEX_LENGTH = MEMBER_TG_BIND_TOKEN_BYTES * 2;
export const MEMBER_TG_AUTH_MAX_AGE_SECONDS = 60 * 60 * 24;

export function generateMemberTelegramBindRawToken(): string {
  return crypto.randomBytes(MEMBER_TG_BIND_TOKEN_BYTES).toString("hex");
}

export function hashMemberTelegramBindToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

export function isValidMemberTelegramBindToken(rawToken: string | null | undefined): rawToken is string {
  return typeof rawToken === "string" && new RegExp(`^[a-f0-9]{${MEMBER_TG_BIND_TOKEN_HEX_LENGTH}}$`, "i").test(rawToken);
}

export function getMemberTelegramBindExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + MEMBER_TG_BIND_TOKEN_TTL_MINUTES * 60 * 1000);
}

export function maskMemberName(name: string | null | undefined): string {
  const normalized = (name ?? "").trim();
  if (!normalized) return "会员";
  const visible = Array.from(normalized).slice(0, 2).join("");
  return `${visible}${normalized.length > visible.length ? "*" : ""}`;
}

export function maskMemberPhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return null;
  return `****${digits.slice(-4)}`;
}

export function extractTelegramUsernameFromParams(params: URLSearchParams): string | null {
  try {
    const userStr = params.get("user");
    if (!userStr) return null;
    const user = JSON.parse(userStr) as { username?: unknown };
    return typeof user.username === "string" && user.username.trim() ? user.username.trim() : null;
  } catch {
    return null;
  }
}

export function isTelegramAuthDateFresh(params: URLSearchParams, now = new Date()): boolean {
  const raw = params.get("auth_date");
  if (!raw) return false;
  const authDateSeconds = Number(raw);
  if (!Number.isFinite(authDateSeconds) || authDateSeconds <= 0) return false;
  const ageSeconds = Math.floor(now.getTime() / 1000) - authDateSeconds;
  return ageSeconds >= 0 && ageSeconds <= MEMBER_TG_AUTH_MAX_AGE_SECONDS;
}
