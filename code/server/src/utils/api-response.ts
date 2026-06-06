import type { Request, Response } from "express";

export function sendData<T>(req: Request, res: Response, data: T, status = 200) {
  return res.status(status).json({
    data,
    requestId: req.requestId
  });
}
