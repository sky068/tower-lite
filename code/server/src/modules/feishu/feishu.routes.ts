import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { sendData } from "../../utils/api-response.js";
import { projectIdParamsSchema } from "../projects/project.schema.js";
import { feishuWebhookSchema } from "./feishu.schema.js";
import { handleFeishuWebhook, listProjectFeishuDeliveries } from "./feishu.service.js";

export const feishuRoutes = Router();

feishuRoutes.post(
  "/feishu/webhook",
  validate("body", feishuWebhookSchema),
  asyncHandler(async (req, res) => {
    const data = await handleFeishuWebhook(req.body);

    if ("challenge" in data) {
      return res.status(200).json(data);
    }

    return sendData(req, res, data);
  })
);

feishuRoutes.get(
  "/projects/:projectId/feishu-deliveries",
  requireAuth,
  validate("params", projectIdParamsSchema),
  asyncHandler(async (req, res) => {
    const data = await listProjectFeishuDeliveries(req.currentUser!.id, req.params.projectId);
    return sendData(req, res, data);
  })
);
