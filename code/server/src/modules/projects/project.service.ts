import { DeliveryChannel, NotificationType, Prisma, ProjectRole, TaskListType } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../middleware/error-handler.js";
import { requireTeamAdmin, requireTeamMember } from "../teams/team.policy.js";
import { requireProjectAccess, requireProjectEditor, requireProjectManager } from "./project.policy.js";
import type {
  AddProjectMemberInput,
  CreateProjectInput,
  UpdateProjectInput,
  UpdateProjectMemberRoleInput
} from "./project.schema.js";

const defaultTaskLists = [
  { name: "待处理", type: TaskListType.TODO, sortKey: new Prisma.Decimal(1000) },
  { name: "进行中", type: TaskListType.IN_PROGRESS, sortKey: new Prisma.Decimal(2000) },
  { name: "已完成", type: TaskListType.DONE, sortKey: new Prisma.Decimal(3000) }
];

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
}

export async function createProject(userId: string, teamId: string, input: CreateProjectInput) {
  await requireTeamAdmin(userId, teamId);

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
        create: defaultTaskLists
      }
    }
  });

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
    orderBy: {
      createdAt: "asc"
    }
  });

  return projects.map(toProjectSummary);
}

export async function getProject(userId: string, projectId: string) {
  const { project } = await requireProjectAccess(userId, projectId);
  return toProjectSummary(project);
}

export async function updateProject(userId: string, projectId: string, input: UpdateProjectInput) {
  await requireProjectEditor(userId, projectId);

  const project = await prisma.project.update({
    where: {
      id: projectId
    },
    data: input
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

  return toProjectSummary(project);
}

export async function deleteProject(userId: string, projectId: string) {
  await requireProjectManager(userId, projectId);

  await prisma.project.update({
    where: {
      id: projectId
    },
    data: {
      deletedAt: new Date()
    }
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

  await createProjectJoinedNotification({
    actorId: userId,
    recipientId: input.userId,
    projectId,
    projectName: project.name
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
  await requireProjectManager(userId, projectId);

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
  await requireProjectManager(userId, projectId);

  const ownerCount = await prisma.projectMember.count({
    where: {
      projectId,
      role: ProjectRole.OWNER
    }
  });

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

  if (member.role === ProjectRole.OWNER && ownerCount <= 1) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "Project must keep at least one owner", 422);
  }

  await prisma.projectMember.delete({
    where: {
      id: member.id
    }
  });

  return { ok: true };
}
