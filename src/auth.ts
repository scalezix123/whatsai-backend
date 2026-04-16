import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const PASSWORD_SALT_BYTES = 16;
const PASSWORD_KEY_BYTES = 64;

export function hashPassword(password: string) {
  const salt = randomBytes(PASSWORD_SALT_BYTES).toString("hex");
  const derivedKey = scryptSync(password, salt, PASSWORD_KEY_BYTES).toString("hex");
  return `${salt}:${derivedKey}`;
}

export function verifyPassword(password: string, passwordHash: string) {
  const [salt, storedKey] = passwordHash.split(":");
  if (!salt || !storedKey) {
    return false;
  }

  const derivedKey = scryptSync(password, salt, PASSWORD_KEY_BYTES);
  const storedKeyBuffer = Buffer.from(storedKey, "hex");

  if (derivedKey.length !== storedKeyBuffer.length) {
    return false;
  }

  return timingSafeEqual(derivedKey, storedKeyBuffer);
}
