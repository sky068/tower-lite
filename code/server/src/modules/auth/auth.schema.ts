import { z } from "zod";

const emailSchema = z.string().trim().email().transform((email) => email.toLowerCase());

export const registerSchema = z.object({
  email: emailSchema,
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(80)
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128)
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1)
});

export const logoutSchema = refreshSchema;

export const tokenSchema = z.object({
  token: z.string().trim().min(24).max(300)
});

export const passwordResetRequestSchema = z.object({
  email: emailSchema
});

export const passwordResetConfirmSchema = tokenSchema.extend({
  newPassword: z.string().min(8).max(128)
});

export const feishuAuthorizeQuerySchema = z.object({
  redirectTo: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((value) =>
      value && value.startsWith("/") && !value.startsWith("//") ? value : "/dashboard"
    )
});

export const feishuCallbackSchema = z.object({
  code: z.string().trim().min(1),
  state: z.string().trim().min(1)
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type TokenInput = z.infer<typeof tokenSchema>;
export type PasswordResetRequestInput = z.infer<typeof passwordResetRequestSchema>;
export type PasswordResetConfirmInput = z.infer<typeof passwordResetConfirmSchema>;
export type FeishuAuthorizeQuery = z.infer<typeof feishuAuthorizeQuerySchema>;
export type FeishuCallbackInput = z.infer<typeof feishuCallbackSchema>;
