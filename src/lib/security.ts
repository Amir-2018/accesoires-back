import { createHash, randomBytes, randomInt } from "node:crypto";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createGuestToken(): string {
  return randomBytes(32).toString("hex");
}

export function createReference(): string {
  return `CMD-${randomInt(100000, 1000000)}`;
}
