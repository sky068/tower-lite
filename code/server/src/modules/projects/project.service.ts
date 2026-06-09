import { DeliveryChannel, NotificationType, ProjectRole } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../middleware/error-handler.js";
import { createActivityLog } from "../activity/activity.service.js";
import { publishProjectEvent, publishTeamEvent, publishToUser } from "../realtime/realtime.service.js";
import { requireTeamMember, requireTeamOwner } from "../teams/team.policy.js";
import { createDefaultTaskLists } from "./default-task-lists.js";
import { requireProjectAccess, requireProjectManager } from "./project.policy.js";
import type {
  AddProjectMemberInput,
  CreateProjectInput,
  UpdateProjectInput,
  UpdateProjectMemberRoleInput
} from "./project.schema.js";

function toProjectSummary(project: {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  status: string;
  teamId: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    color: project.color,
    icon: project.icon,
    status: project.status,
    teamId: project.teamId,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt
  };
}

function toProjectSummaryWithRole(
  project: Parameters<typeof toProjectSummary>[0] & {
    members?: Array<{
      role: ProjectRole;
    }>;
  }
) {
  return {
    ...toProjectSummary(project),
    role: project.members?.[0]?.role
  };
}

async function createProjectJoinedNotification(input: {
  actorId: string;
  recipientId: string;
  projectId: string;
  projectName: string;
}) {
  if (input.actorId === input.recipientId) {
    return;
  }

  await prisma.notification.upsert({
    where: {
      dedupeKey: `project_joined:${input.projectId}:${input.recipientId}`
    },
    update: {},
    create: {
      type: NotificationType.PROJECT_JOINED,
      title: "你被加入了项目",
      content: input.projectName,
      link: `/projects/${input.projectId}/board`,
      recipientId: input.recipientId,
      actorId: input.actorId,
      projectId: input.projectId,
      dedupeKey: `project_joined:${input.projectId}:${input.recipientId}`,
      deliveries: {
        create: {
          channel: DeliveryChannel.IN_APP,
          status: "SENT",
          sentAt: new Date()
        }
      }
    }
  });
  publishToUser(input.recipientId, { type: "notification.changed" });
}

export async function createProject(userId: string, teamId: string, input: CreateProjectInput) {
  await requireTeamOwner(userId, teamId);

  const project = await prisma.project.create({
    data: {
      name: input.name,
      description: input.description,
      color: input.color,
      icon: input.icon,
      teamId,
      createdById: userId,
      members: {
        create: {
          userId,
          role: ProjectRole.OWNER
        }
      },
      taskLists: {
        create: createDefaultTaskLists()
      }
    }
  });

  await createActivityLog({
    actorId: userId,
    teamId,
    projectId: project.id,
    action: "project.created",
    targetType: "project",
    targetId: project.id,
    metadata: {
      name: project.name
    }
  });

  await publishTeamEvent(teamId, { type: "project.changed", teamId, projectId: project.id });

  return toProjectSummary(project);
}

export async function listTeamProjects(userId: string, teamId: string) {
  const teamMember = await requireTeamMember(userId, teamId);

  const projects = await prisma.project.findMany({
    where: {
      teamId,
      deletedAt: null,
      OR:
        teamMember.role === "OWNER" || teamMember.role === "ADMIN"
          ? undefined
          : [
              {
                members: {
                  some: {
                    userId
                  }
                }
              }
            ]
    },
    include: {
      members: {
        where: {
          userId
        },
        take: 1
      }
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  return projects.map(toProjectSummaryWithRole);
}

export async function getProject(userId: string, projectId: string) {
  const { project } = await requireProjectAccess(userId, projectId);
  return toProjectSummary(project);
}

export async function updateProject(userId: string, projectId: string, input: UpdateProjectInput) {
  await requireProjectManager(userId, projectId);

  const project = await prisma.project.update({
    where: {
      id: projectId
    },
    data: input
  });

  await createActivityLog({
    actorId: userId,
    teamId: project.teamId,
    projectId,
    action: "project.updated",
    targetType: "project",
    targetId: projectId,
    metadata: {
      name: project.name
    }
  });

  await publishProjectEvent(projectId, {
    type: "project.changed",
    projectId,
    teamId: project.teamId
  });

  return toProjectSummary(project);
}

export async function archiveProject(userId: string, projectId: string) {
  await requireProjectManager(userId, projectId);

  const project = await prisma.project.update({
    where: {
      id: projectId
    },
    data: {
      status: "ARCHIVED"
    }
  });

  await createActivityLog({
    actorId: userId,
    teamId: project.teamId,
    projectId,
    action: "project.archived",
    targetType: "project",
    targetId: projectId,
    metadata: {
      name: project.name
    }
  });

  await publishProjectEvent(projectId, {
    type: "project.changed",
    projectId,
    teamId: project.teamId
  });

  return toProjectSummary(project);
}

export async function deleteProject(userId: string, projectId: string) {
  const { project } = await requireProjectManager(userId, projectId);

  await prisma.project.update({
    where: {
      id: projectId
    },
    data: {
      deletedAt: new Date()
    }
  });

  await createActivityLog({
    actorId: userId,
    teamId: project.teamId,
    projectId,
    action: "project.deleted",
    targetType: "project",
    targetId: projectId,
    metadata: {
      name: project.name
    }
  });

  await publishTeamEvent(project.teamId, {
    type: "project.changed",
    projectId,
    teamId: project.teamId
  });

  return { ok: true };
}

export async function listProjectMembers(userId: string, projectId: string) {
  await requireProjectAccess(userId, projectId);

  const members = await prisma.projectMember.findMany({
    where: {
      projectId
    },
    include: {
      user: true
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  return members.map((member) => ({
    id: member.id,
    role: member.role,
    user: {
      id: member.user.id,
      email: member.user.email,
      name: member.user.name,
      avatarUrl: member.user.avatarUrl
    }
  }));
}

export async function addProjectMember(
  userId: string,
  projectId: string,
  input: AddProjectMemberInput
) {
  const { project } = await requireProjectManager(userId, projectId);

  const teamMember = await prisma.teamMember.findUnique({
    where: {
      userId_teamId: {
        userId: input.userId,
        teamId: project.teamId
      }
    }
  });

  if (!teamMember) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "Project member must belong to the team", 422);
  }

  const member = await prisma.projectMember.upsert({
    where: {
      projectId_userId: {
        projectId,
        userId: input.userId
      }
    },
    update: {
      role: input.role
    },
    create: {
      projectId,
      userId: input.userId,
      role: input.role
    },
    include: {
      user: true
    }
  });

  await createActivityLog({
    actorId: userId,
    teamId: project.teamId,
    projectId,
    action: "project_member.added",
    targetType: "project_member",
    targetId: member.id,
    metadata: {
      userId: input.userId,
      email: member.user.email,
      name: member.user.name,
      role: input.role
    }
  });

  await createProjectJoinedNotification({
    actorId: userId,
    recipientId: input.userId,
    projectId,
    projectName: project.name
  });

  await publishProjectEvent(projectId, {
    type: "project.changed",
    projectId,
    teamId: project.teamId
  });

  return {
    id: member.id,
    role: member.role,
    user: {
      id: member.user.id,
      email: member.user.email,
      name: member.user.name,
      avatarUrl: member.user.avatarUrl
    }
  };
}

export async function updateProjectMemberRole(
  userId: string,
  projectId: string,
  targetUserId: string,
  input: UpdateProjectMemberRoleInput
) {
  const { project } = await requireProjectManager(userId, projectId);

  const member = await prisma.projectMember.findUnique({
    where: {
      projectId_userId: {
        projectId,
        userId: targetUserId
      }
    }
  });

  if (!member) {
    throw new AppError("RESOURCE_NOT_FOUND", "Project member not found", 404);
  }

  if (member.role === ProjectRole.OWNER && input.role !== ProjectRole.OWNER) {
    await assertProjectKeepsOwner(projectId);
  }

  const updatedMember = await prisma.projectMember.update({
    where: {
      id: member.id
    },
    data: {
      role: input.role
    },
    include: {
      user: true
    }
  });

  await createActivityLog({
    actorId: userId,
    teamId: project.teamId,
    projectId,
    action: "project_member.role_updated",
    targetType: "project_member",
    targetId: member.id,
    metadata: {
      userId: targetUserId,
      role: input.role
    }
  });

  await publishProjectEvent(projectId, { type: "project.changed", projectId, teamId: project.teamId });

  return {
    id: updatedMember.id,
    role: updatedMember.role,
    user: {
      id: updatedMember.user.id,
      email: updatedMember.user.email,
      name: updatedMember.user.name,
      avatarUrl: updatedMember.user.avatarUrl
    }
  };
}

export async function removeProjectMember(userId: string, projectId: string, targetUserId: string) {
  const { project } = await requireProjectManager(userId, projectId);

  const member = await prisma.projectMember.findUnique({
    where: {
      projectId_userId: {
        projectId,
        userId: targetUserId
      }
    }
  });

  if (!member) {
    throw new AppError("RESOURCE_NOT_FOUND", "Project member not found", 404);
  }

  if (member.role === ProjectRole.OWNER) {
    await assertProjectKeepsOwner(projectId);
  }

  await prisma.projectMember.delete({
    where: {
      id: member.id
    }
  });

  await createActivityLog({
    actorId: userId,
    teamId: project.teamId,
    projectId,
    action: "project_member.removed",
    targetType: "project_member",
    targetId: member.id,
    metadata: {
      userId: targetUserId,
      role: member.role
    }
  });

  await publishProjectEvent(projectId, { type: "project.changed", projectId, teamId: project.teamId });

  return { ok: true };
}

async function assertProjectKeepsOwner(projectId: string) {
  const ownerCount = await prisma.projectMember.count({
    where: {
      projectId,
      role: ProjectRole.OWNER
    }
  });

  if (ownerCount <= 1) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "Project must keep at least one owner", 422);
  }
}
