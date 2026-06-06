import { z } from "zod";

export const projectIdParamsSchema = z.object({
  projectId: z.string().uuid()
});

export const tagIdParamsSchema = z.object({
  projectId: z.string().uuid(),
  tagId: z.string().uuid()
});

export const taskTagParamsSchema = z.object({
  taskId: z.string().uuid(),
  tagId: z.string().uuid()
});

export const createTagSchema = z.object({
  name: z.string().min(1).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/)
});

export const updateTagSchema = createTagSchema.partial();

export type CreateTagInput = z.infer<typeof createTagSchema>;
export type UpdateTagInput = z.infer<typeof updateTagSchema>;
