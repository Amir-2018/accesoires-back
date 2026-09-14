import { createHash, randomBytes, randomInt } from "node:crypto";
export function hashToken(token) {
    return createHash("sha256").update(token).digest("hex");
}
export function createGuestToken() {
    return randomBytes(32).toString("hex");
}
export function createReference() {
    return `CMD-${randomInt(100000, 1000000)}`;
}
