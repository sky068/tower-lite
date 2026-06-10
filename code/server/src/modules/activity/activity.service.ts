import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { requireProjectManager } from "../projects/project.policy.js";
import { requireTeamOwner } from "../teams/team.policy.js";
import type { ClearActivityLogsInput } from "./activity.schema.js";

const teamActivityActions = [
  "activity_log.cleared",
  "team_member.added",
  "team_member.role_updated",
  "team_member.removed",
  "team_invitation.created",
  "team_invitation.revoked",
  "team_invitation.accepted",
  "project.created",
  "project.archived",
  "project.unarchived",
  "project.deleted",
  "project.restored",
  "project.purged"
];

function parseDateRange(input: ClearActivityLogsInput) {
  const start = new Date(`${input.startDate}T00:00:00.000Z`);
  const exclusiveEnd = new Date(`${input.endDate}T00:00:00.000Z`);
  exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);

  return {
    start,
    exclusiveEnd
  };
}

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
      teamId,
      action: {
        in: teamActivityActions
      }
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

export async function clearTeamActivity(userId: string, teamId: string, input: ClearActivityLogsInput) {
  await requireTeamOwner(userId, teamId);

  const { start, exclusiveEnd } = parseDateRange(input);
  const result = await prisma.activityLog.deleteMany({
    where: {
      teamId,
      action: {
        in: teamActivityActions
      },
      createdAt: {
        gte: start,
        lt: exclusiveEnd
      }
    }
  });

  await createActivityLog({
    actorId: userId,
    teamId,
    action: "activity_log.cleared",
    targetType: "activity_log",
    targetId: null,
    metadata: {
      scope: "team",
      startDate: input.startDate,
      endDate: input.endDate,
      deletedCount: result.count
    }
  });

  return {
    deletedCount: result.count
  };
}

export async function clearProjectActivity(userId: string, projectId: string, input: ClearActivityLogsInput) {
  const { project } = await requireProjectManager(userId, projectId);
  const { start, exclusiveEnd } = parseDateRange(input);
  const result = await prisma.activityLog.deleteMany({
    where: {
      teamId: project.teamId,
      projectId,
      createdAt: {
        gte: start,
        lt: exclusiveEnd
      }
    }
  });

  await createActivityLog({
    actorId: userId,
    teamId: project.teamId,
    projectId,
    action: "activity_log.cleared",
    targetType: "activity_log",
    targetId: null,
    metadata: {
      scope: "project",
      startDate: input.startDate,
      endDate: input.endDate,
      deletedCount: result.count
    }
  });

  return {
    deletedCount: result.count
  };
}
