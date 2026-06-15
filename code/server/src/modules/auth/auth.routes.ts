import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { sendData } from "../../utils/api-response.js";
import {
  confirmEmail,
  confirmPasswordReset,
  getFeishuAuthorizeUrl,
  login,
  loginWithFeishu,
  logout,
  refresh,
  register,
  requestPasswordReset,
  sendEmailVerification
} from "./auth.service.js";
import {
  feishuAuthorizeQuerySchema,
  feishuCallbackSchema,
  loginSchema,
  logoutSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  refreshSchema,
  registerSchema,
  tokenSchema
} from "./auth.schema.js";
import type { FeishuAuthorizeQuery } from "./auth.schema.js";
import { getCurrentUserId, requireAuth } from "../../middleware/auth.js";
import { createRateLimit, emailAndIpRateLimitKey, userRateLimitKey } from "../../middleware/rate-limit.js";

export const authRoutes = Router();

const accountActionRateLimitMessage = "账号相关请求过于频繁，请稍后再试。";
const registerRateLimit = createRateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  key: emailAndIpRateLimitKey("auth:register"),
  message: accountActionRateLimitMessage
});
const loginRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  key: emailAndIpRateLimitKey("auth:login"),
  message: "登录尝试过于频繁，请稍后再试。"
});
const emailVerificationRateLimit = createRateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  key: userRateLimitKey("auth:email-verification"),
  message: accountActionRateLimitMessage
});
const passwordResetRequestRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  key: emailAndIpRateLimitKey("auth:password-reset"),
  message: accountActionRateLimitMessage
});

authRoutes.post(
  "/auth/register",
  validate("body", registerSchema),
  registerRateLimit,
  asyncHandler(async (req, res) => {
    const data = await register(req.body);
    return sendData(req, res, data, 201);
  })
);

authRoutes.post(
  "/auth/login",
  validate("body", loginSchema),
  loginRateLimit,
  asyncHandler(async (req, res) => {
    const data = await login(req.body);
    return sendData(req, res, data);
  })
);

authRoutes.post(
  "/auth/email-verification/send",
  requireAuth,
  emailVerificationRateLimit,
  asyncHandler(async (req, res) => {
    const data = await sendEmailVerification(getCurrentUserId(req));
    return sendData(req, res, data);
  })
);

authRoutes.post(
  "/auth/email-verification/confirm",
  validate("body", tokenSchema),
  asyncHandler(async (req, res) => {
    const data = await confirmEmail(req.body);
    return sendData(req, res, data);
  })
);

authRoutes.post(
  "/auth/password-reset/request",
  validate("body", passwordResetRequestSchema),
  passwordResetRequestRateLimit,
  asyncHandler(async (req, res) => {
    const data = await requestPasswordReset(req.body);
    return sendData(req, res, data);
  })
);

authRoutes.post(
  "/auth/password-reset/confirm",
  validate("body", passwordResetConfirmSchema),
  asyncHandler(async (req, res) => {
    const data = await confirmPasswordReset(req.body);
    return sendData(req, res, data);
  })
);

authRoutes.get(
  "/auth/feishu/authorize-url",
  validate("query", feishuAuthorizeQuerySchema),
  asyncHandler(async (req, res) => {
    const data = getFeishuAuthorizeUrl(req.query as FeishuAuthorizeQuery);
    return sendData(req, res, data);
  })
);

authRoutes.post(
  "/auth/feishu/callback",
  validate("body", feishuCallbackSchema),
  asyncHandler(async (req, res) => {
    const data = await loginWithFeishu(req.body);
    return sendData(req, res, data);
  })
);

authRoutes.post(
  "/auth/refresh",
  validate("body", refreshSchema),
  asyncHandler(async (req, res) => {
    const data = await refresh(req.body);
    return sendData(req, res, data);
  })
);

authRoutes.post(
  "/auth/logout",
  validate("body", logoutSchema),
  asyncHandler(async (req, res) => {
    const data = await logout(req.body);
    return sendData(req, res, data);
  })
);
