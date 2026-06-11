import { Router } from "express";
import { getCurrentUserId, requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { sendData } from "../../utils/api-response.js";
import { projectIdParamsSchema } from "../projects/project.schema.js";
import { teamIdParamsSchema } from "../teams/team.schema.js";
import {
  clearDefaultProject,
  clearDefaultTeam,
  getSystemDefaults,
  setDefaultProject,
  setDefaultTeam
} from "./system.service.js";

export const systemRoutes = Router();

systemRoutes.use(requireAuth);

systemRoutes.get(
  "/system/defaults",
  asyncHandler(async (req, res) => {
    const data = await getSystemDefaults();
    return sendData(req, res, data);
  })
);

systemRoutes.patch(
  "/teams/:teamId/default",
  validate("params", teamIdParamsSchema),
  asyncHandler(async (req, res) => {
    const data = await setDefaultTeam(getCurrentUserId(req), req.params.teamId);
    return sendData(req, res, data);
  })
);

systemRoutes.delete(
  "/teams/:teamId/default",
  validate("params", teamIdParamsSchema),
  asyncHandler(async (req, res) => {
    const data = await clearDefaultTeam(getCurrentUserId(req), req.params.teamId);
    return sendData(req, res, data);
  })
);

systemRoutes.patch(
  "/projects/:projectId/default",
  validate("params", projectIdParamsSchema),
  asyncHandler(async (req, res) => {
    const data = await setDefaultProject(getCurrentUserId(req), req.params.projectId);
    return sendData(req, res, data);
  })
);

systemRoutes.delete(
  "/projects/:projectId/default",
  validate("params", projectIdParamsSchema),
  asyncHandler(async (req, res) => {
    const data = await clearDefaultProject(getCurrentUserId(req), req.params.projectId);
    return sendData(req, res, data);
  })
);
