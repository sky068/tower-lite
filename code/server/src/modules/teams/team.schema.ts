import { TeamRole } from "@prisma/client";
import { z } from "zod";

const emailSchema = z.string().trim().email().transform((email) => email.toLowerCase());

export const createTeamSchema = z.object({
  name: z.string().trim().min(1).max(80),
  adminEmail: emailSchema
});

export const teamIdParamsSchema = z.object({
  teamId: z.string().uuid()
});

export const teamMemberParamsSchema = z.object({
  teamId: z.string().uuid(),
  memberId: z.string().uuid()
});

export const updateTeamSchema = z.object({
  name: z.string().trim().min(1).max(80).optional()
});

export const addTeamMemberSchema = z.object({
  email: emailSchema,
  role: z.nativeEnum(TeamRole).default(TeamRole.MEMBER)
});

export const updateTeamMemberRoleSchema = z.object({
  role: z.nativeEnum(TeamRole)
});

export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;
export type AddTeamMemberInput = z.infer<typeof addTeamMemberSchema>;
export type UpdateTeamMemberRoleInput = z.infer<typeof updateTeamMemberRoleSchema>;
