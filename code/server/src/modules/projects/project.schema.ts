import { ProjectRole } from "@prisma/client";
import { z } from "zod";

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  icon: z.string().max(40).optional()
});

export const updateProjectSchema = createProjectSchema.partial();

export const teamProjectsParamsSchema = z.object({
  teamId: z.string().uuid()
});

export const projectIdParamsSchema = z.object({
  projectId: z.string().uuid()
});

export const teamProjectTrashParamsSchema = z.object({
  teamId: z.string().uuid(),
  projectId: z.string().uuid()
});

export const projectMemberParamsSchema = z.object({
  projectId: z.string().uuid(),
  userId: z.string().uuid()
});

export const addProjectMemberSchema = z.object({
  userId: z.string().uuid(),
  role: z.nativeEnum(ProjectRole).default(ProjectRole.EDITOR)
});

export const updateProjectMemberRoleSchema = z.object({
  role: z.nativeEnum(ProjectRole)
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type AddProjectMemberInput = z.infer<typeof addProjectMemberSchema>;
export type UpdateProjectMemberRoleInput = z.infer<typeof updateProjectMemberRoleSchema>;
