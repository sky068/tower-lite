import jwt from "jsonwebtoken";
import { createHash, randomBytes } from "node:crypto";
import { env } from "../config/env.js";

export type AccessTokenPayload = {
  sub: string;
};

export function signAccessToken(userId: string) {
  return jwt.sign({ sub: userId }, env.JWT_ACCESS_SECRET, { expiresIn: "15m" });
}

export function createRefreshToken() {
  return randomBytes(48).toString("base64url");
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function verifyAccessToken(token: string) {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
}
