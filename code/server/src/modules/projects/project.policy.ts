import { ProjectRole, TeamRole } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../middleware/error-handler.js";

export async function requireProjectAccess(userId: string, projectId: string) {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      deletedAt: null
    },
    include: {
      team: {
        include: {
          members: {
            where: {
              userId
            }
          }
        }
      },
      members: {
        where: {
          userId
        }
      }
    }
  });

  if (!project) {
    throw new AppError("RESOURCE_NOT_FOUND", "Project not found", 404);
  }

  const teamMember = project.team.members[0];
  const projectMember = project.members[0];
  const isTeamAdmin = teamMember?.role === TeamRole.OWNER || teamMember?.role === TeamRole.ADMIN;

  if (!teamMember || (!isTeamAdmin && !projectMember)) {
    throw new AppError("FORBIDDEN", "You do not have access to this project", 403);
  }

  return {
    project,
    teamMember,
    projectMember,
    isTeamAdmin
  };
}

export async function requireProjectEditor(userId: string, projectId: string) {
  const access = await requireProjectAccess(userId, projectId);

  if (access.isTeamAdmin) {
    return access;
  }

  if (
    access.projectMember?.role !== ProjectRole.OWNER &&
    access.projectMember?.role !== ProjectRole.EDITOR
  ) {
    throw new AppError("FORBIDDEN", "Project edit permission is required", 403);
  }

  return access;
}

export async function requireProjectManager(userId: string, projectId: string) {
  const access = await requireProjectAccess(userId, projectId);

  if (access.isTeamAdmin || access.projectMember?.role === ProjectRole.OWNER) {
    return access;
  }

  throw new AppError("FORBIDDEN", "Project owner permission is required", 403);
}
