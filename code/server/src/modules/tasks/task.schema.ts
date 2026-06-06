import { Priority } from "@prisma/client";
import { z } from "zod";

export const projectIdParamsSchema = z.object({
  projectId: z.string().uuid()
});

export const taskIdParamsSchema = z.object({
  taskId: z.string().uuid()
});

export const taskCommentParamsSchema = z.object({
  taskId: z.string().uuid(),
  commentId: z.string().uuid()
});

export const createTaskListSchema = z.object({
  name: z.string().min(1).max(80)
});

export const taskListIdParamsSchema = z.object({
  projectId: z.string().uuid(),
  listId: z.string().uuid()
});

export const updateTaskListSchema = z.object({
  name: z.string().min(1).max(80)
});

export const deleteTaskListSchema = z.object({
  targetTaskListId: z.string().uuid().optional()
});

export const reorderTaskListsSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().uuid(),
      sortKey: z.string().regex(/^\d+(\.\d+)?$/)
    })
  ).min(1)
});

export const createTaskSchema = z.object({
  taskListId: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  assigneeId: z.string().uuid().optional(),
  priority: z.nativeEnum(Priority).default(Priority.MEDIUM),
  startDate: z.coerce.date().optional(),
  dueDate: z.coerce.date().optional(),
  tagIds: z.array(z.string().uuid()).default([]),
  parentId: z.string().uuid().optional()
});

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).nullable().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  priority: z.nativeEnum(Priority).optional(),
  startDate: z.coerce.date().nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  tagIds: z.array(z.string().uuid()).optional()
});

export const moveTaskSchema = z.object({
  targetTaskListId: z.string().uuid(),
  sortKey: z.string().regex(/^\d+(\.\d+)?$/)
});

export const createCommentSchema = z.object({
  content: z.string().min(1).max(5000)
});

export type CreateTaskListInput = z.infer<typeof createTaskListSchema>;
export type UpdateTaskListInput = z.infer<typeof updateTaskListSchema>;
export type DeleteTaskListInput = z.infer<typeof deleteTaskListSchema>;
export type ReorderTaskListsInput = z.infer<typeof reorderTaskListsSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type MoveTaskInput = z.infer<typeof moveTaskSchema>;
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
