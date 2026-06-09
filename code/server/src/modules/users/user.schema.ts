import { z } from "zod";

export const notificationIdParamsSchema = z.object({
  id: z.string().uuid()
});

const nullableAvatarUrlSchema = z
  .string()
  .trim()
  .max(500)
  .transform((value) => (value.length === 0 ? null : value))
  .nullable()
  .optional();

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(80),
  avatarUrl: nullableAvatarUrlSchema
});

export const updatePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128)
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type UpdatePasswordInput = z.infer<typeof updatePasswordSchema>;
