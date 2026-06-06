import type { NextFunction, Request, Response } from "express";
import type { ZodSchema } from "zod";

type ValidationTarget = "body" | "params" | "query";

export function validate(target: ValidationTarget, schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req[target] = schema.parse(req[target]);
    next();
  };
}
