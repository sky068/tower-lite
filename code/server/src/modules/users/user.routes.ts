import { Router } from "express";
import { getCurrentUserId, requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { sendData } from "../../utils/api-response.js";
import {
  bindFeishuSchema,
  notificationIdParamsSchema,
  updateEmailSchema,
  updatePasswordSchema,
  updateProfileSchema
} from "./user.schema.js";
import {
  bindFeishuAccount,
  getCurrentUser,
  listMyTasks,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  unbindFeishuAccount,
  updateEmail,
  updatePassword,
  updateProfile
} from "./user.service.js";

export const userRoutes = Router();

userRoutes.use(requireAuth);

userRoutes.get(
  "/users/me",
  asyncHandler(async (req, res) => {
    const data = await getCurrentUser(getCurrentUserId(req));
    return sendData(req, res, data);
  })
);

userRoutes.patch(
  "/users/me/profile",
  validate("body", updateProfileSchema),
  asyncHandler(async (req, res) => {
    const data = await updateProfile(getCurrentUserId(req), req.body);
    return sendData(req, res, data);
  })
);

userRoutes.patch(
  "/users/me/email",
  validate("body", updateEmailSchema),
  asyncHandler(async (req, res) => {
    const data = await updateEmail(getCurrentUserId(req), req.body);
    return sendData(req, res, data);
  })
);

userRoutes.patch(
  "/users/me/password",
  validate("body", updatePasswordSchema),
  asyncHandler(async (req, res) => {
    const data = await updatePassword(getCurrentUserId(req), req.body);
    return sendData(req, res, data);
  })
);

userRoutes.patch(
  "/users/me/feishu-binding",
  validate("body", bindFeishuSchema),
  asyncHandler(async (req, res) => {
    const data = await bindFeishuAccount(getCurrentUserId(req), req.body);
    return sendData(req, res, data);
  })
);

userRoutes.delete(
  "/users/me/feishu-binding",
  asyncHandler(async (req, res) => {
    const data = await unbindFeishuAccount(getCurrentUserId(req));
    return sendData(req, res, data);
  })
);

userRoutes.get(
  "/users/me/tasks",
  asyncHandler(async (req, res) => {
    const data = await listMyTasks(getCurrentUserId(req));
    return sendData(req, res, data);
  })
);

userRoutes.get(
  "/users/me/notifications",
  asyncHandler(async (req, res) => {
    const data = await listNotifications(getCurrentUserId(req));
    return sendData(req, res, data);
  })
);

userRoutes.patch(
  "/users/me/notifications/read-all",
  asyncHandler(async (req, res) => {
    const data = await markAllNotificationsRead(getCurrentUserId(req));
    return sendData(req, res, data);
  })
);

userRoutes.patch(
  "/users/me/notifications/:id/read",
  validate("params", notificationIdParamsSchema),
  asyncHandler(async (req, res) => {
    const data = await markNotificationRead(getCurrentUserId(req), req.params.id);
    return sendData(req, res, data);
  })
);
