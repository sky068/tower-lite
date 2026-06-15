import { Router } from "express";
import { getCurrentUserId, requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { sendData } from "../../utils/api-response.js";
import { emailOutboxParamsSchema, emailOutboxQuerySchema } from "./email.schema.js";
import type { EmailOutboxQuery } from "./email.schema.js";
import { listEmailOutbox, retryEmailOutboxItem } from "./email.service.js";

export const emailRoutes = Router();

emailRoutes.get(
  "/system/email-outbox",
  requireAuth,
  validate("query", emailOutboxQuerySchema),
  asyncHandler(async (req, res) => {
    const data = await listEmailOutbox(getCurrentUserId(req), req.query as unknown as EmailOutboxQuery);
    return sendData(req, res, data);
  })
);

emailRoutes.post(
  "/system/email-outbox/:emailOutboxId/retry",
  requireAuth,
  validate("params", emailOutboxParamsSchema),
  asyncHandler(async (req, res) => {
    const data = await retryEmailOutboxItem(getCurrentUserId(req), req.params.emailOutboxId);
    return sendData(req, res, data);
  })
);
