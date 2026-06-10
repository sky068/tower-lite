import { Router } from "express";
import { getCurrentUserId, requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { sendData } from "../../utils/api-response.js";
import { projectIdParamsSchema } from "../projects/project.schema.js";
import { teamIdParamsSchema } from "../teams/team.schema.js";
import { clearActivityLogsSchema } from "./activity.schema.js";
import { clearProjectActivity, clearTeamActivity, listProjectActivity, listTeamActivity } from "./activity.service.js";

export const activityRoutes = Router();

activityRoutes.use(requireAuth);

activityRoutes.get(
  "/teams/:teamId/activity",
  validate("params", teamIdParamsSchema),
  asyncHandler(async (req, res) => {
    const data = await listTeamActivity(getCurrentUserId(req), req.params.teamId);
    return sendData(req, res, data);
  })
);

activityRoutes.post(
  "/teams/:teamId/activity/clear",
  validate("params", teamIdParamsSchema),
  validate("body", clearActivityLogsSchema),
  asyncHandler(async (req, res) => {
    const data = await clearTeamActivity(getCurrentUserId(req), req.params.teamId, req.body);
    return sendData(req, res, data);
  })
);

activityRoutes.get(
  "/projects/:projectId/activity",
  validate("params", projectIdParamsSchema),
  asyncHandler(async (req, res) => {
    const data = await listProjectActivity(getCurrentUserId(req), req.params.projectId);
    return sendData(req, res, data);
  })
);

activityRoutes.post(
  "/projects/:projectId/activity/clear",
  validate("params", projectIdParamsSchema),
  validate("body", clearActivityLogsSchema),
  asyncHandler(async (req, res) => {
    const data = await clearProjectActivity(getCurrentUserId(req), req.params.projectId, req.body);
    return sendData(req, res, data);
  })
);
