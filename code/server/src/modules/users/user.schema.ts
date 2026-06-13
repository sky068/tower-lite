import { z } from "zod";

export const notificationIdParamsSchema = z.object({
  id: z.string().uuid()
});

const nullableAvatarUrlSchema = z
  .string()
  .trim()
  .max(300_000)
  .refine(
    (value) =>
      value.length === 0 ||
      /^https?:\/\/.+/i.test(value) ||
      /^data:image\/(png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=]+$/i.test(value),
    "Avatar must be an image URL or data URL"
  )
  .transform((value) => (value.length === 0 ? null : value))
  .nullable()
  .optional();

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(80),
  avatarUrl: nullableAvatarUrlSchema
});

export const updateEmailSchema = z.object({
  email: z.string().trim().email().transform((email) => email.toLowerCase())
});

export const updatePasswordSchema = z.object({
  currentPassword: z.string().max(128).optional(),
  newPassword: z.string().min(8).max(128)
});

export const bindFeishuSchema = z.object({
  openId: z.string().trim().min(1).max(200),
  unionId: z.string().trim().min(1).max(200).nullable().optional()
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type UpdateEmailInput = z.infer<typeof updateEmailSchema>;
export type UpdatePasswordInput = z.infer<typeof updatePasswordSchema>;
export type BindFeishuInput = z.infer<typeof bindFeishuSchema>;
