import { ProjectRole, TeamRole } from "@prisma/client";
import { z } from "zod";

const emailSchema = z.string().trim().email().transform((email) => email.toLowerCase());

export const invitationIdParamsSchema = z.object({
  invitationId: z.string().uuid()
});

export const teamInvitationParamsSchema = z.object({
  teamId: z.string().uuid()
});

export const projectInvitationParamsSchema = z.object({
  projectId: z.string().uuid()
});

export const createTeamInvitationSchema = z.object({
  email: emailSchema,
  role: z.nativeEnum(TeamRole).default(TeamRole.MEMBER)
});

export const createProjectInvitationSchema = z.object({
  email: emailSchema,
  teamRole: z.nativeEnum(TeamRole).default(TeamRole.MEMBER),
  projectRole: z.nativeEnum(ProjectRole).default(ProjectRole.EDITOR)
});

export const acceptInvitationSchema = z.object({
  token: z.string().min(16)
});

export type CreateTeamInvitationInput = z.infer<typeof createTeamInvitationSchema>;
export type CreateProjectInvitationInput = z.infer<typeof createProjectInvitationSchema>;
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
