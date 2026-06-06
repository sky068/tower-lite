import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { sendData } from "../../utils/api-response.js";
import { login, logout, refresh, register } from "./auth.service.js";
import { loginSchema, logoutSchema, refreshSchema, registerSchema } from "./auth.schema.js";

export const authRoutes = Router();

authRoutes.post(
  "/auth/register",
  validate("body", registerSchema),
  asyncHandler(async (req, res) => {
    const data = await register(req.body);
    return sendData(req, res, data, 201);
  })
);

authRoutes.post(
  "/auth/login",
  validate("body", loginSchema),
  asyncHandler(async (req, res) => {
    const data = await login(req.body);
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
