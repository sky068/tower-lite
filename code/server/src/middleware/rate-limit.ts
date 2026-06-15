import type { Request, RequestHandler } from "express";
import { AppError } from "./error-handler.js";

type RateLimitInput = {
  windowMs: number;
  max: number;
  key: (req: Request) => string;
  message?: string;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

function clientIp(req: Request) {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function normalizePart(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function cleanupExpiredBuckets(now: number) {
  if (buckets.size < 1000) {
    return;
  }

  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

export function createRateLimit(input: RateLimitInput): RequestHandler {
  return (req, _res, next) => {
    const now = Date.now();
    cleanupExpiredBuckets(now);

    const key = input.key(req);
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, {
        count: 1,
        resetAt: now + input.windowMs
      });
      return next();
    }

    bucket.count += 1;

    if (bucket.count > input.max) {
      throw new AppError("RATE_LIMITED", input.message ?? "请求过于频繁，请稍后再试。", 429, {
        retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000)
      });
    }

    return next();
  };
}

export function emailAndIpRateLimitKey(scope: string) {
  return (req: Request) => `${scope}:${normalizePart(req.body?.email)}:${clientIp(req)}`;
}

export function userRateLimitKey(scope: string) {
  return (req: Request) => `${scope}:${req.currentUser?.id ?? clientIp(req)}`;
}

export function resetRateLimitBucketsForTest() {
  buckets.clear();
}
