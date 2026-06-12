import { Priority, TaskStatus } from "@prisma/client";
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

const taskListNameSchema = z.string().trim().min(1).max(80);

export const createTaskListSchema = z.object({
  name: taskListNameSchema
});

export const taskListIdParamsSchema = z.object({
  projectId: z.string().uuid(),
  listId: z.string().uuid()
});

export const taskListTrashParamsSchema = z.object({
  projectId: z.string().uuid(),
  listId: z.string().uuid()
});

export const updateTaskListSchema = z.object({
  name: taskListNameSchema
});

export const deleteTaskListSchema = z.object({});

export const reorderTaskListsSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().uuid(),
      sortKey: z.string().regex(/^\d+(\.\d+)?$/)
    })
  ).min(1)
});

const optionalDateSchema = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.coerce.date().optional()
);

const nullableDateSchema = z.preprocess(
  (value) => (value === "" ? null : value),
  z.coerce.date().nullable().optional()
);

export const createTaskSchema = z.object({
  taskListId: z.string().uuid().optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  projectMemberIds: z.array(z.string().uuid()).default([]),
  status: z.nativeEnum(TaskStatus).default(TaskStatus.TODO),
  priority: z.nativeEnum(Priority).default(Priority.MEDIUM),
  startDate: optionalDateSchema,
  dueDate: optionalDateSchema,
  tagIds: z.array(z.string().uuid()).default([]),
  parentId: z.string().uuid().optional()
});

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).nullable().optional(),
  projectMemberIds: z.array(z.string().uuid()).optional(),
  status: z.nativeEnum(TaskStatus).optional(),
  priority: z.nativeEnum(Priority).optional(),
  startDate: nullableDateSchema,
  dueDate: nullableDateSchema,
  tagIds: z.array(z.string().uuid()).optional()
});

export const moveTaskSchema = z.object({
  targetTaskListId: z.string().uuid(),
  sortKey: z.string().regex(/^\d+(\.\d+)?$/)
});

export const createCommentSchema = z.object({
  content: z.string().min(1).max(5000),
  mentionIds: z.array(z.string().uuid()).default([])
});

export type CreateTaskListInput = z.infer<typeof createTaskListSchema>;
export type UpdateTaskListInput = z.infer<typeof updateTaskListSchema>;
export type DeleteTaskListInput = z.infer<typeof deleteTaskListSchema>;
export type ReorderTaskListsInput = z.infer<typeof reorderTaskListsSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type MoveTaskInput = z.infer<typeof moveTaskSchema>;
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
