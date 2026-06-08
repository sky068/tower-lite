import { Router } from "express";
import { getCurrentUserId, requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { sendData } from "../../utils/api-response.js";
import {
  acceptInvitation,
  createProjectInvitation,
  createTeamInvitation,
  listProjectInvitations,
  listTeamInvitations,
  revokeInvitation
} from "./invitation.service.js";
import {
  acceptInvitationSchema,
  createProjectInvitationSchema,
  createTeamInvitationSchema,
  invitationIdParamsSchema,
  projectInvitationParamsSchema,
  teamInvitationParamsSchema
} from "./invitation.schema.js";

export const invitationRoutes = Router();

invitationRoutes.use(requireAuth);

invitationRoutes.get(
  "/teams/:teamId/invitations",
  validate("params", teamInvitationParamsSchema),
  asyncHandler(async (req, res) => {
    const data = await listTeamInvitations(getCurrentUserId(req), req.params.teamId);
    return sendData(req, res, data);
  })
);

invitationRoutes.post(
  "/teams/:teamId/invitations",
  validate("params", teamInvitationParamsSchema),
  validate("body", createTeamInvitationSchema),
  asyncHandler(async (req, res) => {
    const data = await createTeamInvitation(getCurrentUserId(req), req.params.teamId, req.body);
    return sendData(req, res, data, 201);
  })
);

invitationRoutes.get(
  "/projects/:projectId/invitations",
  validate("params", projectInvitationParamsSchema),
  asyncHandler(async (req, res) => {
    const data = await listProjectInvitations(getCurrentUserId(req), req.params.projectId);
    return sendData(req, res, data);
  })
);

invitationRoutes.post(
  "/projects/:projectId/invitations",
  validate("params", projectInvitationParamsSchema),
  validate("body", createProjectInvitationSchema),
  asyncHandler(async (req, res) => {
    const data = await createProjectInvitation(
      getCurrentUserId(req),
      req.params.projectId,
      req.body
    );
    return sendData(req, res, data, 201);
  })
);

invitationRoutes.patch(
  "/invitations/:invitationId/revoke",
  validate("params", invitationIdParamsSchema),
  asyncHandler(async (req, res) => {
    const data = await revokeInvitation(getCurrentUserId(req), req.params.invitationId);
    return sendData(req, res, data);
  })
);

invitationRoutes.post(
  "/invitations/accept",
  validate("body", acceptInvitationSchema),
  asyncHandler(async (req, res) => {
    const data = await acceptInvitation(getCurrentUserId(req), req.body);
    return sendData(req, res, data);
  })
);
