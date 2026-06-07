import { Router } from "express";
import { getCurrentUserId, requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { sendData } from "../../utils/api-response.js";
import {
  addTeamMember,
  createTeam,
  deleteTeam,
  getTeam,
  listMyTeams,
  listTeamMembers,
  removeTeamMember,
  updateTeam,
  updateTeamMemberRole
} from "./team.service.js";
import {
  addTeamMemberSchema,
  createTeamSchema,
  teamIdParamsSchema,
  teamMemberParamsSchema,
  updateTeamMemberRoleSchema,
  updateTeamSchema
} from "./team.schema.js";

export const teamRoutes = Router();

teamRoutes.use(requireAuth);

teamRoutes.post(
  "/teams",
  validate("body", createTeamSchema),
  asyncHandler(async (req, res) => {
    const data = await createTeam(getCurrentUserId(req), req.body);
    return sendData(req, res, data, 201);
  })
);

teamRoutes.get(
  "/teams",
  asyncHandler(async (req, res) => {
    const data = await listMyTeams(getCurrentUserId(req));
    return sendData(req, res, data);
  })
);

teamRoutes.patch(
  "/teams/:teamId",
  validate("params", teamIdParamsSchema),
  validate("body", updateTeamSchema),
  asyncHandler(async (req, res) => {
    const data = await updateTeam(getCurrentUserId(req), req.params.teamId, req.body);
    return sendData(req, res, data);
  })
);

teamRoutes.delete(
  "/teams/:teamId",
  validate("params", teamIdParamsSchema),
  asyncHandler(async (req, res) => {
    const data = await deleteTeam(getCurrentUserId(req), req.params.teamId);
    return sendData(req, res, data);
  })
);

teamRoutes.get(
  "/teams/:teamId",
  validate("params", teamIdParamsSchema),
  asyncHandler(async (req, res) => {
    const data = await getTeam(getCurrentUserId(req), req.params.teamId);
    return sendData(req, res, data);
  })
);

teamRoutes.post(
  "/teams/:teamId/members",
  validate("params", teamIdParamsSchema),
  validate("body", addTeamMemberSchema),
  asyncHandler(async (req, res) => {
    const data = await addTeamMember(getCurrentUserId(req), req.params.teamId, req.body);
    return sendData(req, res, data, 201);
  })
);

teamRoutes.patch(
  "/teams/:teamId/members/:userId/role",
  validate("params", teamMemberParamsSchema),
  validate("body", updateTeamMemberRoleSchema),
  asyncHandler(async (req, res) => {
    const data = await updateTeamMemberRole(
      getCurrentUserId(req),
      req.params.teamId,
      req.params.userId,
      req.body
    );
    return sendData(req, res, data);
  })
);

teamRoutes.delete(
  "/teams/:teamId/members/:userId",
  validate("params", teamMemberParamsSchema),
  asyncHandler(async (req, res) => {
    const data = await removeTeamMember(getCurrentUserId(req), req.params.teamId, req.params.userId);
    return sendData(req, res, data);
  })
);

teamRoutes.get(
  "/teams/:teamId/members",
  validate("params", teamIdParamsSchema),
  asyncHandler(async (req, res) => {
    const data = await listTeamMembers(getCurrentUserId(req), req.params.teamId);
    return sendData(req, res, data);
  })
);
