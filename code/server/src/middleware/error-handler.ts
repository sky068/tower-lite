import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "../config/logger.js";

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 500,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  if (error instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: error.flatten()
      },
      requestId: req.requestId
    });
  }

  if (error instanceof AppError) {
    return res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        details: error.details
      },
      requestId: req.requestId
    });
  }

  logger.error({ err: error, requestId: req.requestId }, "Unhandled server error");

  return res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "Internal server error"
    },
    requestId: req.requestId
  });
}
