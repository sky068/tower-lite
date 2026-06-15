import { Router } from "express";
import { getCurrentUserId, requireAuth } from "../../middleware/auth.js";
import { createRateLimit, userRateLimitKey } from "../../middleware/rate-limit.js";
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
  cancelPendingEmailChange,
  getCurrentUser,
  listMyTasks,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  resendPendingEmailChange,
  unbindFeishuAccount,
  updateEmail,
  updatePassword,
  updateProfile
} from "./user.service.js";

export const userRoutes = Router();

userRoutes.use(requireAuth);

const accountChangeRateLimit = createRateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  key: userRateLimitKey("users:account-change"),
  message: "账号相关请求过于频繁，请稍后再试。"
});

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
  accountChangeRateLimit,
  asyncHandler(async (req, res) => {
    const data = await updateEmail(getCurrentUserId(req), req.body);
    return sendData(req, res, data);
  })
);

userRoutes.post(
  "/users/me/email-change/resend",
  accountChangeRateLimit,
  asyncHandler(async (req, res) => {
    const data = await resendPendingEmailChange(getCurrentUserId(req));
    return sendData(req, res, data);
  })
);

userRoutes.delete(
  "/users/me/email-change",
  asyncHandler(async (req, res) => {
    const data = await cancelPendingEmailChange(getCurrentUserId(req));
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
