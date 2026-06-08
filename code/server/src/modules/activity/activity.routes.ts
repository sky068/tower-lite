import { Router } from "express";
import { getCurrentUserId, requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { sendData } from "../../utils/api-response.js";
import { projectIdParamsSchema } from "../projects/project.schema.js";
import { teamIdParamsSchema } from "../teams/team.schema.js";
import { listProjectActivity, listTeamActivity } from "./activity.service.js";

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

activityRoutes.get(
  "/projects/:projectId/activity",
  validate("params", projectIdParamsSchema),
  asyncHandler(async (req, res) => {
    const data = await listProjectActivity(getCurrentUserId(req), req.params.projectId);
    return sendData(req, res, data);
  })
);
