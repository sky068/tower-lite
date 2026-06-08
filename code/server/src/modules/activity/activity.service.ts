import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { requireProjectManager } from "../projects/project.policy.js";
import { requireTeamOwner } from "../teams/team.policy.js";

export type CreateActivityInput = {
  actorId: string | null;
  teamId: string;
  projectId?: string | null;
  taskId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Prisma.InputJsonValue;
};

export async function createActivityLog(input: CreateActivityInput) {
  return prisma.activityLog.create({
    data: {
      actorId: input.actorId,
      teamId: input.teamId,
      projectId: input.projectId,
      taskId: input.taskId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: input.metadata
    }
  });
}

export async function listTeamActivity(userId: string, teamId: string) {
  await requireTeamOwner(userId, teamId);

  const rows = await prisma.activityLog.findMany({
    where: {
      teamId
    },
    include: {
      actor: {
        select: {
          id: true,
          name: true,
          email: true,
          avatarUrl: true
        }
      },
      project: {
        select: {
          id: true,
          name: true
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    },
    take: 100
  });

  return rows;
}

export async function listProjectActivity(userId: string, projectId: string) {
  const { project } = await requireProjectManager(userId, projectId);

  const rows = await prisma.activityLog.findMany({
    where: {
      teamId: project.teamId,
      projectId
    },
    include: {
      actor: {
        select: {
          id: true,
          name: true,
          email: true,
          avatarUrl: true
        }
      },
      project: {
        select: {
          id: true,
          name: true
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    },
    take: 100
  });

  return rows;
}
