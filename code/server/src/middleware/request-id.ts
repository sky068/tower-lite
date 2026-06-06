import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";

declare global {
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

export function requestId(req: Request, res: Response, next: NextFunction) {
  const headerValue = req.header("x-request-id");
  req.requestId = headerValue && headerValue.length > 0 ? headerValue : randomUUID();
  res.setHeader("x-request-id", req.requestId);
  next();
}
