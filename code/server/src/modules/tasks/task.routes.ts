import { Router } from "express";
import { getCurrentUserId, requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { sendData } from "../../utils/api-response.js";
import {
  createComment,
  createTask,
  createTaskList,
  deleteTask,
  deleteTaskList,
  getTask,
  listComments,
  listProjectTaskLists,
  moveTask,
  reorderTaskLists,
  updateTask,
  updateTaskList
} from "./task.service.js";
import {
  createCommentSchema,
  createTaskListSchema,
  createTaskSchema,
  deleteTaskListSchema,
  moveTaskSchema,
  projectIdParamsSchema,
  reorderTaskListsSchema,
  taskListIdParamsSchema,
  taskIdParamsSchema,
  updateTaskListSchema,
  updateTaskSchema
} from "./task.schema.js";

export const taskRoutes = Router();

taskRoutes.use(requireAuth);

taskRoutes.get(
  "/projects/:projectId/lists",
  validate("params", projectIdParamsSchema),
  asyncHandler(async (req, res) => {
    const data = await listProjectTaskLists(getCurrentUserId(req), req.params.projectId);
    return sendData(req, res, data);
  })
);

taskRoutes.post(
  "/projects/:projectId/lists",
  validate("params", projectIdParamsSchema),
  validate("body", createTaskListSchema),
  asyncHandler(async (req, res) => {
    const data = await createTaskList(getCurrentUserId(req), req.params.projectId, req.body);
    return sendData(req, res, data, 201);
  })
);

taskRoutes.patch(
  "/projects/:projectId/lists/reorder",
  validate("params", projectIdParamsSchema),
  validate("body", reorderTaskListsSchema),
  asyncHandler(async (req, res) => {
    const data = await reorderTaskLists(getCurrentUserId(req), req.params.projectId, req.body);
    return sendData(req, res, data);
  })
);

taskRoutes.patch(
  "/projects/:projectId/lists/:listId",
  validate("params", taskListIdParamsSchema),
  validate("body", updateTaskListSchema),
  asyncHandler(async (req, res) => {
    const data = await updateTaskList(
      getCurrentUserId(req),
      req.params.projectId,
      req.params.listId,
      req.body
    );
    return sendData(req, res, data);
  })
);

taskRoutes.delete(
  "/projects/:projectId/lists/:listId",
  validate("params", taskListIdParamsSchema),
  validate("body", deleteTaskListSchema),
  asyncHandler(async (req, res) => {
    const data = await deleteTaskList(
      getCurrentUserId(req),
      req.params.projectId,
      req.params.listId,
      req.body
    );
    return sendData(req, res, data);
  })
);

taskRoutes.post(
  "/projects/:projectId/tasks",
  validate("params", projectIdParamsSchema),
  validate("body", createTaskSchema),
  asyncHandler(async (req, res) => {
    const data = await createTask(getCurrentUserId(req), req.params.projectId, req.body);
    return sendData(req, res, data, 201);
  })
);

taskRoutes.get(
  "/tasks/:taskId",
  validate("params", taskIdParamsSchema),
  asyncHandler(async (req, res) => {
    const data = await getTask(getCurrentUserId(req), req.params.taskId);
    return sendData(req, res, data);
  })
);

taskRoutes.patch(
  "/tasks/:taskId",
  validate("params", taskIdParamsSchema),
  validate("body", updateTaskSchema),
  asyncHandler(async (req, res) => {
    const data = await updateTask(getCurrentUserId(req), req.params.taskId, req.body);
    return sendData(req, res, data);
  })
);

taskRoutes.delete(
  "/tasks/:taskId",
  validate("params", taskIdParamsSchema),
  asyncHandler(async (req, res) => {
    const data = await deleteTask(getCurrentUserId(req), req.params.taskId);
    return sendData(req, res, data);
  })
);

taskRoutes.patch(
  "/tasks/:taskId/move",
  validate("params", taskIdParamsSchema),
  validate("body", moveTaskSchema),
  asyncHandler(async (req, res) => {
    const data = await moveTask(getCurrentUserId(req), req.params.taskId, req.body);
    return sendData(req, res, data);
  })
);

taskRoutes.get(
  "/tasks/:taskId/comments",
  validate("params", taskIdParamsSchema),
  asyncHandler(async (req, res) => {
    const data = await listComments(getCurrentUserId(req), req.params.taskId);
    return sendData(req, res, data);
  })
);

taskRoutes.post(
  "/tasks/:taskId/comments",
  validate("params", taskIdParamsSchema),
  validate("body", createCommentSchema),
  asyncHandler(async (req, res) => {
    const data = await createComment(getCurrentUserId(req), req.params.taskId, req.body);
    return sendData(req, res, data, 201);
  })
);
