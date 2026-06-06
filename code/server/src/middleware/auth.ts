import type { NextFunction, Request, Response } from "express";
import { AppError } from "./error-handler.js";
import { verifyAccessToken } from "../utils/token.js";

declare global {
  namespace Express {
    interface Request {
      currentUser?: {
        id: string;
      };
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const authorization = req.header("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    throw new AppError("UNAUTHORIZED", "Missing access token", 401);
  }

  const token = authorization.slice("Bearer ".length);

  try {
    const payload = verifyAccessToken(token);
    req.currentUser = { id: payload.sub };
    next();
  } catch {
    throw new AppError("UNAUTHORIZED", "Invalid or expired access token", 401);
  }
}

export function getCurrentUserId(req: Request) {
  if (!req.currentUser) {
    throw new AppError("UNAUTHORIZED", "Missing authenticated user", 401);
  }

  return req.currentUser.id;
}
