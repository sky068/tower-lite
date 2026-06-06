import { Router } from "express";
import { getCurrentUserId, requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { sendData } from "../../utils/api-response.js";
import {
  addTagToTask,
  createTag,
  deleteTag,
  listTags,
  removeTagFromTask,
  updateTag
} from "./tag.service.js";
import {
  createTagSchema,
  projectIdParamsSchema,
  tagIdParamsSchema,
  taskTagParamsSchema,
  updateTagSchema
} from "./tag.schema.js";

export const tagRoutes = Router();

tagRoutes.use(requireAuth);

tagRoutes.get(
  "/projects/:projectId/tags",
  validate("params", projectIdParamsSchema),
  asyncHandler(async (req, res) => {
    const data = await listTags(getCurrentUserId(req), req.params.projectId);
    return sendData(req, res, data);
  })
);

tagRoutes.post(
  "/projects/:projectId/tags",
  validate("params", projectIdParamsSchema),
  validate("body", createTagSchema),
  asyncHandler(async (req, res) => {
    const data = await createTag(getCurrentUserId(req), req.params.projectId, req.body);
    return sendData(req, res, data, 201);
  })
);

tagRoutes.patch(
  "/projects/:projectId/tags/:tagId",
  validate("params", tagIdParamsSchema),
  validate("body", updateTagSchema),
  asyncHandler(async (req, res) => {
    const data = await updateTag(
      getCurrentUserId(req),
      req.params.projectId,
      req.params.tagId,
      req.body
    );
    return sendData(req, res, data);
  })
);

tagRoutes.delete(
  "/projects/:projectId/tags/:tagId",
  validate("params", tagIdParamsSchema),
  asyncHandler(async (req, res) => {
    const data = await deleteTag(getCurrentUserId(req), req.params.projectId, req.params.tagId);
    return sendData(req, res, data);
  })
);

tagRoutes.post(
  "/tasks/:taskId/tags/:tagId",
  validate("params", taskTagParamsSchema),
  asyncHandler(async (req, res) => {
    const data = await addTagToTask(getCurrentUserId(req), req.params.taskId, req.params.tagId);
    return sendData(req, res, data);
  })
);

tagRoutes.delete(
  "/tasks/:taskId/tags/:tagId",
  validate("params", taskTagParamsSchema),
  asyncHandler(async (req, res) => {
    const data = await removeTagFromTask(getCurrentUserId(req), req.params.taskId, req.params.tagId);
    return sendData(req, res, data);
  })
);
