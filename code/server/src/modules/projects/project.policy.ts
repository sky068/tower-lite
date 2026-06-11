import { ProjectRole, ProjectStatus, TeamRole } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../middleware/error-handler.js";
import { isSystemAdmin } from "../system/system.policy.js";

export async function requireProjectAccess(userId: string, projectId: string) {
  const userIsSystemAdmin = await isSystemAdmin(userId);
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
  const isTeamAdmin = teamMember?.role === TeamRole.ADMIN;

  if (!userIsSystemAdmin && (!teamMember || (!isTeamAdmin && !projectMember))) {
    throw new AppError("FORBIDDEN", "You do not have access to this project", 403);
  }

  return {
    project,
    teamMember,
    projectMember,
    isTeamAdmin,
    isSystemAdmin: userIsSystemAdmin
  };
}

export async function requireProjectEditor(userId: string, projectId: string) {
  const access = await requireProjectAccess(userId, projectId);

  if (access.isSystemAdmin || access.isTeamAdmin) {
    return access;
  }

  if (
    access.projectMember?.role !== ProjectRole.ADMIN &&
    access.projectMember?.role !== ProjectRole.EDITOR
  ) {
    throw new AppError("FORBIDDEN", "Project edit permission is required", 403);
  }

  return access;
}

export function assertProjectActive(project: { status: ProjectStatus }) {
  if (project.status !== ProjectStatus.ACTIVE) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "Archived project cannot be modified", 422);
  }
}

export async function requireActiveProjectEditor(userId: string, projectId: string) {
  const access = await requireProjectEditor(userId, projectId);
  assertProjectActive(access.project);
  return access;
}

export async function requireProjectManager(userId: string, projectId: string) {
  const access = await requireProjectAccess(userId, projectId);

  if (access.isSystemAdmin || access.isTeamAdmin || access.projectMember?.role === ProjectRole.ADMIN) {
    return access;
  }

  throw new AppError("FORBIDDEN", "Project admin permission is required", 403);
}
