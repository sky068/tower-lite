import { TeamRole } from "@prisma/client";
import { z } from "zod";

export const createTeamSchema = z.object({
  name: z.string().min(1).max(80)
});

export const teamIdParamsSchema = z.object({
  teamId: z.string().uuid()
});

export const teamMemberParamsSchema = z.object({
  teamId: z.string().uuid(),
  userId: z.string().uuid()
});

export const updateTeamSchema = createTeamSchema.partial();

export const addTeamMemberSchema = z.object({
  email: z.string().email(),
  role: z.nativeEnum(TeamRole).default(TeamRole.MEMBER)
});

export const updateTeamMemberRoleSchema = z.object({
  role: z.nativeEnum(TeamRole)
});

export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;
export type AddTeamMemberInput = z.infer<typeof addTeamMemberSchema>;
export type UpdateTeamMemberRoleInput = z.infer<typeof updateTeamMemberRoleSchema>;
