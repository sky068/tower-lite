import { Router } from "express";
import { getCurrentUserId, requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { sendData } from "../../utils/api-response.js";
import {
  archiveProject,
  addProjectMember,
  createProject,
  deleteProject,
  getProject,
  listTeamProjectTrash,
  listTeamProjects,
  purgeDeletedProject,
  listProjectMembers,
  removeProjectMember,
  restoreDeletedProject,
  unarchiveProject,
  updateProject,
  updateProjectMemberRole
} from "./project.service.js";
import {
  addProjectMemberSchema,
  createProjectSchema,
  projectMemberParamsSchema,
  projectIdParamsSchema,
  teamProjectsParamsSchema,
  teamProjectTrashParamsSchema,
  updateProjectMemberRoleSchema,
  updateProjectSchema
} from "./project.schema.js";

export const projectRoutes = Router();

projectRoutes.use(requireAuth);

projectRoutes.get(
  "/teams/:teamId/projects",
  validate("params", teamProjectsParamsSchema),
  asyncHandler(async (req, res) => {
    const data = await listTeamProjects(getCurrentUserId(req), req.params.teamId);
    return sendData(req, res, data);
  })
);

projectRoutes.get(
  "/teams/:teamId/project-trash",
  validate("params", teamProjectsParamsSchema),
  asyncHandler(async (req, res) => {
    const data = await listTeamProjectTrash(getCurrentUserId(req), req.params.teamId);
    return sendData(req, res, data);
  })
);

projectRoutes.patch(
  "/teams/:teamId/project-trash/:projectId/restore",
  validate("params", teamProjectTrashParamsSchema),
  asyncHandler(async (req, res) => {
    const data = await restoreDeletedProject(
      getCurrentUserId(req),
      req.params.teamId,
      req.params.projectId
    );
    return sendData(req, res, data);
  })
);

projectRoutes.delete(
  "/teams/:teamId/project-trash/:projectId",
  validate("params", teamProjectTrashParamsSchema),
  asyncHandler(async (req, res) => {
    const data = await purgeDeletedProject(
      getCurrentUserId(req),
      req.params.teamId,
      req.params.projectId
    );
    return sendData(req, res, data);
  })
);

projectRoutes.get(
  "/projects/:projectId/members",
  validate("params", projectIdParamsSchema),
  asyncHandler(async (req, res) => {
    const data = await listProjectMembers(getCurrentUserId(req), req.params.projectId);
    return sendData(req, res, data);
  })
);

projectRoutes.post(
  "/projects/:projectId/members",
  validate("params", projectIdParamsSchema),
  validate("body", addProjectMemberSchema),
  asyncHandler(async (req, res) => {
    const data = await addProjectMember(getCurrentUserId(req), req.params.projectId, req.body);
    return sendData(req, res, data, 201);
  })
);

projectRoutes.patch(
  "/projects/:projectId/members/:memberId/role",
  validate("params", projectMemberParamsSchema),
  validate("body", updateProjectMemberRoleSchema),
  asyncHandler(async (req, res) => {
    const data = await updateProjectMemberRole(
      getCurrentUserId(req),
      req.params.projectId,
      req.params.memberId,
      req.body
    );
    return sendData(req, res, data);
  })
);

projectRoutes.delete(
  "/projects/:projectId/members/:memberId",
  validate("params", projectMemberParamsSchema),
  asyncHandler(async (req, res) => {
    const data = await removeProjectMember(
      getCurrentUserId(req),
      req.params.projectId,
      req.params.memberId
    );
    return sendData(req, res, data);
  })
);

projectRoutes.patch(
  "/projects/:projectId",
  validate("params", projectIdParamsSchema),
  validate("body", updateProjectSchema),
  asyncHandler(async (req, res) => {
    const data = await updateProject(getCurrentUserId(req), req.params.projectId, req.body);
    return sendData(req, res, data);
  })
);

projectRoutes.patch(
  "/projects/:projectId/archive",
  validate("params", projectIdParamsSchema),
  asyncHandler(async (req, res) => {
    const data = await archiveProject(getCurrentUserId(req), req.params.projectId);
    return sendData(req, res, data);
  })
);

projectRoutes.patch(
  "/projects/:projectId/unarchive",
  validate("params", projectIdParamsSchema),
  asyncHandler(async (req, res) => {
    const data = await unarchiveProject(getCurrentUserId(req), req.params.projectId);
    return sendData(req, res, data);
  })
);

projectRoutes.delete(
  "/projects/:projectId",
  validate("params", projectIdParamsSchema),
  asyncHandler(async (req, res) => {
    const data = await deleteProject(getCurrentUserId(req), req.params.projectId);
    return sendData(req, res, data);
  })
);

projectRoutes.post(
  "/teams/:teamId/projects",
  validate("params", teamProjectsParamsSchema),
  validate("body", createProjectSchema),
  asyncHandler(async (req, res) => {
    const data = await createProject(getCurrentUserId(req), req.params.teamId, req.body);
    return sendData(req, res, data, 201);
  })
);

projectRoutes.get(
  "/projects/:projectId",
  validate("params", projectIdParamsSchema),
  asyncHandler(async (req, res) => {
    const data = await getProject(getCurrentUserId(req), req.params.projectId);
    return sendData(req, res, data);
  })
);
