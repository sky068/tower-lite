import { randomBytes } from "node:crypto";
import { InvitationStatus, NotificationType, Prisma, ProjectRole, TeamRole } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../middleware/error-handler.js";
import { createActivityLog } from "../activity/activity.service.js";
import {
  mergeProjectRole,
  normalizeEmail,
  toMemberView
} from "../memberships/membership.service.js";
import { createNotification } from "../notifications/notification.service.js";
import { publishProjectEvent, publishTeamEvent } from "../realtime/realtime.service.js";
import { isSystemAdmin } from "../system/system.policy.js";
import { requireTeamAdmin, requireTeamMember } from "../teams/team.policy.js";
import { requireProjectAccess, requireProjectManager } from "./project.policy.js";
import type {
  AddProjectMemberInput,
  CreateProjectInput,
  UpdateProjectInput,
  UpdateProjectMemberRoleInput
} from "./project.schema.js";

function createInvitationToken() {
  return randomBytes(24).toString("base64url");
}

function invitationExpiresAt() {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
}

function withInvitePath<T extends { email: string; status: string }>(
  member: T,
  invitationsByEmail: Map<string, { token: string }>
) {
  if (member.status !== "PENDING") {
    return {
      ...member,
      inviteAcceptPath: null
    };
  }

  const invitation = invitationsByEmail.get(normalizeEmail(member.email));
  return {
    ...member,
    inviteAcceptPath: invitation ? `/invitations/accept?token=${encodeURIComponent(invitation.token)}` : null
  };
}

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

function toDeletedProjectSummary(project: {
  id: string;
  name: string;
  description: string | null;
  status: string;
  deletedAt: Date | null;
  deletedBy: {
    id: string;
    name: string;
    email: string;
    avatarUrl: string | null;
  } | null;
}) {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    status: project.status,
    deletedAt: project.deletedAt,
    deletedBy: project.deletedBy
  };
}

async function createProjectJoinedNotification(input: {
  actorId: string;
  recipientId: string;
  projectId: string;
  projectName: string;
}) {
  await createNotification({
    type: NotificationType.PROJECT_JOINED,
    title: "你被加入了项目",
    content: input.projectName,
    link: `/projects/${input.projectId}/board`,
    recipientId: input.recipientId,
    actorId: input.actorId,
    projectId: input.projectId,
    dedupeKey: `project_joined:${input.projectId}:${input.recipientId}`,
    skipActor: true
  });
}

async function assertProjectNameUnique(teamId: string, name: string, excludeProjectId?: string) {
  const existingProject = await prisma.project.findFirst({
    where: {
      teamId,
      name,
      deletedAt: null,
      ...(excludeProjectId
        ? {
            id: {
              not: excludeProjectId
            }
          }
        : {})
    }
  });

  if (existingProject) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "Project name already exists in this team", 422);
  }
}

export async function createProject(userId: string, teamId: string, input: CreateProjectInput) {
  const teamMember = await requireTeamAdmin(userId, teamId);
  const userIsSystemAdmin = teamMember === null && await isSystemAdmin(userId);
  const projectAdminTeamMemberId = input.projectAdminTeamMemberId ?? (userIsSystemAdmin ? undefined : teamMember?.id);

  if (!projectAdminTeamMemberId) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "创建项目时需要指定项目管理员。", 422);
  }

  const projectAdminTeamMember = await prisma.teamMember.findFirst({
    where: {
      id: projectAdminTeamMemberId,
      teamId,
      team: {
        deletedAt: null
      }
    }
  });

  if (!projectAdminTeamMember) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "项目管理员必须是当前团队成员。", 422);
  }

  if (!projectAdminTeamMember.userId) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "项目管理员必须是已注册并认领的团队成员。", 422);
  }

  await assertProjectNameUnique(teamId, input.name);

  const project = await prisma.project.create({
    data: {
      name: input.name,
      description: input.description,
      color: input.color,
      icon: input.icon,
      teamId,
      createdById: userId,
      taskLists: {
        create: {
          name: "默认清单",
          isDefault: true,
          sortKey: new Prisma.Decimal(1000)
        }
      },
      members: {
        create: {
          teamMemberId: projectAdminTeamMember.id,
          userId: projectAdminTeamMember.userId,
          claimedAt: projectAdminTeamMember.userId ? projectAdminTeamMember.claimedAt ?? new Date() : null,
          role: ProjectRole.ADMIN
        }
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
  const userIsSystemAdmin = await isSystemAdmin(userId);

  const projects = await prisma.project.findMany({
    where: {
      teamId,
      deletedAt: null,
      OR:
        userIsSystemAdmin || teamMember?.role === "ADMIN"
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

  return projects.map((project) => ({
    ...toProjectSummary(project),
    role: project.members?.[0]?.role
  }));
}

export async function listTeamProjectTrash(userId: string, teamId: string) {
  await requireTeamAdmin(userId, teamId);

  const projects = await prisma.project.findMany({
    where: {
      teamId,
      deletedAt: {
        not: null
      }
    },
    include: {
      deletedBy: {
        select: {
          id: true,
          name: true,
          email: true,
          avatarUrl: true
        }
      }
    },
    orderBy: {
      deletedAt: "desc"
    }
  });

  return {
    projects: projects.map(toDeletedProjectSummary)
  };
}

export async function getProject(userId: string, projectId: string) {
  const { project } = await requireProjectAccess(userId, projectId);
  return toProjectSummary(project);
}

export async function updateProject(userId: string, projectId: string, input: UpdateProjectInput) {
  const { project: existingProject } = await requireProjectManager(userId, projectId);
  if (input.name) {
    await assertProjectNameUnique(existingProject.teamId, input.name, projectId);
  }

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

export async function unarchiveProject(userId: string, projectId: string) {
  await requireProjectManager(userId, projectId);

  const project = await prisma.project.update({
    where: {
      id: projectId
    },
    data: {
      status: "ACTIVE"
    }
  });

  await createActivityLog({
    actorId: userId,
    teamId: project.teamId,
    projectId,
    action: "project.unarchived",
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
      deletedAt: new Date(),
      deletedById: userId
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

export async function restoreDeletedProject(userId: string, teamId: string, projectId: string) {
  await requireTeamAdmin(userId, teamId);

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      teamId,
      deletedAt: {
        not: null
      }
    }
  });

  if (!project) {
    throw new AppError("RESOURCE_NOT_FOUND", "Project not found in trash", 404);
  }

  await assertProjectNameUnique(teamId, project.name, projectId);

  const restoredProject = await prisma.project.update({
    where: {
      id: projectId
    },
    data: {
      deletedAt: null,
      deletedById: null
    }
  });

  await createActivityLog({
    actorId: userId,
    teamId,
    projectId,
    action: "project.restored",
    targetType: "project",
    targetId: projectId,
    metadata: {
      name: project.name
    }
  });

  await publishTeamEvent(teamId, {
    type: "project.changed",
    projectId,
    teamId
  });

  return toProjectSummary(restoredProject);
}

export async function purgeDeletedProject(userId: string, teamId: string, projectId: string) {
  await requireTeamAdmin(userId, teamId);

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      teamId,
      deletedAt: {
        not: null
      }
    }
  });

  if (!project) {
    throw new AppError("RESOURCE_NOT_FOUND", "Project not found in trash", 404);
  }

  await prisma.$transaction(async (tx) => {
    await tx.notificationDelivery.deleteMany({
      where: {
        notification: {
          projectId
        }
      }
    });
    await tx.notification.deleteMany({
      where: {
        projectId
      }
    });
    await tx.taskDependency.deleteMany({
      where: {
        OR: [
          {
            dependentTask: {
              projectId
            }
          },
          {
            prerequisite: {
              projectId
            }
          }
        ]
      }
    });
    await tx.taskTag.deleteMany({
      where: {
        task: {
          projectId
        }
      }
    });
    await tx.commentMention.deleteMany({
      where: {
        comment: {
          task: {
            projectId
          }
        }
      }
    });
    await tx.comment.deleteMany({
      where: {
        task: {
          projectId
        }
      }
    });
    await tx.taskAssignee.deleteMany({
      where: {
        task: {
          projectId
        }
      }
    });
    await tx.task.updateMany({
      where: {
        projectId
      },
      data: {
        parentId: null
      }
    });
    await tx.task.deleteMany({
      where: {
        projectId
      }
    });
    await tx.tag.deleteMany({
      where: {
        projectId
      }
    });
    await tx.taskList.deleteMany({
      where: {
        projectId
      }
    });
    await tx.projectMember.deleteMany({
      where: {
        projectId
      }
    });
    await tx.invitation.deleteMany({
      where: {
        projectId
      }
    });
    await tx.activityLog.updateMany({
      where: {
        projectId
      },
      data: {
        projectId: null
      }
    });
    await tx.project.delete({
      where: {
        id: projectId
      }
    });
  });

  await createActivityLog({
    actorId: userId,
    teamId,
    projectId: null,
    action: "project.purged",
    targetType: "project",
    targetId: projectId,
    metadata: {
      name: project.name
    }
  });

  await publishTeamEvent(teamId, {
    type: "project.changed",
    projectId,
    teamId
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
      user: true,
      teamMember: {
        include: {
          user: true
        }
      },
      project: {
        select: {
          teamId: true
        }
      }
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  const memberViews = members.map((member) =>
    toMemberView({
      id: member.id,
      teamMemberId: member.teamMemberId,
      role: member.role,
      email: member.teamMember.email,
      normalizedEmail: member.teamMember.normalizedEmail,
      user: member.user
    })
  );
  const pendingEmails = memberViews
    .filter((member) => member.status === "PENDING")
    .map((member) => normalizeEmail(member.email));
  const invitations = pendingEmails.length
    ? await prisma.invitation.findMany({
        where: {
          teamId: members[0]?.project.teamId,
          projectId: null,
          status: InvitationStatus.PENDING,
          email: {
            in: pendingEmails
          }
        },
        orderBy: {
          createdAt: "desc"
        },
        select: {
          email: true,
          token: true
        }
      })
    : [];
  const invitationsByEmail = new Map(invitations.map((invitation) => [invitation.email, invitation]));

  return memberViews.map((member) => withInvitePath(member, invitationsByEmail));
}

export async function addProjectMember(
  userId: string,
  projectId: string,
  input: AddProjectMemberInput
) {
  const { project } = await requireProjectManager(userId, projectId);

  const { member, existingMember } = await prisma.$transaction(async (tx) => {
    const teamMember = await tx.teamMember.findFirst({
      where: {
        id: input.teamMemberId,
        teamId: project.teamId
      },
      include: {
        user: true
      }
    });

    if (!teamMember) {
      throw new AppError("BUSINESS_RULE_VIOLATION", "项目成员必须属于当前团队。", 422);
    }

    if (!teamMember.userId) {
      const pendingInvitationCount = await tx.invitation.count({
        where: {
          email: teamMember.normalizedEmail,
          teamId: project.teamId,
          projectId: null,
          status: InvitationStatus.PENDING
        }
      });

      if (pendingInvitationCount === 0) {
        await tx.invitation.create({
          data: {
            email: teamMember.normalizedEmail,
            token: createInvitationToken(),
            teamRole: teamMember.role,
            teamId: project.teamId,
            inviterId: userId,
            expiresAt: invitationExpiresAt()
          }
        });
      }
    }

    const existing = await tx.projectMember.findUnique({
      where: {
        projectId_teamMemberId: {
          projectId,
          teamMemberId: teamMember.id
        }
      }
    });
    const projectMember = existing
      ? await tx.projectMember.update({
          where: {
            id: existing.id
          },
          data: {
            role: mergeProjectRole(existing.role, input.role),
            userId: teamMember.userId,
            claimedAt: teamMember.userId ? teamMember.claimedAt ?? new Date() : null
          },
          include: {
            user: true,
            teamMember: true
          }
        })
      : await tx.projectMember.create({
          data: {
            projectId,
            teamMemberId: teamMember.id,
            userId: teamMember.userId,
            claimedAt: teamMember.userId ? teamMember.claimedAt ?? new Date() : null,
            role: input.role
          },
          include: {
            user: true,
            teamMember: true
          }
        });

    return {
      member: projectMember,
      existingMember: existing
    };
  });

  await createActivityLog({
    actorId: userId,
    teamId: project.teamId,
    projectId,
    action: "project_member.added",
    targetType: "project_member",
      targetId: member.id,
      metadata: {
      teamMemberId: member.teamMemberId,
      userId: member.userId,
      email: member.teamMember.email,
      name: member.user?.name,
      role: member.role,
      requestedRole: input.role
    }
  });

  if (!existingMember && member.userId) {
    await createProjectJoinedNotification({
      actorId: userId,
      recipientId: member.userId,
      projectId,
      projectName: project.name
    });
  }

  await publishProjectEvent(projectId, {
    type: "project.changed",
    projectId,
    teamId: project.teamId
  });
  await publishTeamEvent(project.teamId, {
    type: "team.changed",
    teamId: project.teamId
  });

  return toMemberView({
    id: member.id,
    teamMemberId: member.teamMemberId,
    role: member.role,
    email: member.teamMember.email,
    normalizedEmail: member.teamMember.normalizedEmail,
    user: member.user
  });
}

export async function updateProjectMemberRole(
  userId: string,
  projectId: string,
  targetMemberId: string,
  input: UpdateProjectMemberRoleInput
) {
  const { project } = await requireProjectManager(userId, projectId);

  const member = await prisma.projectMember.findFirst({
    where: {
      id: targetMemberId,
      projectId
    }
  });

  if (!member) {
    throw new AppError("RESOURCE_NOT_FOUND", "Project member not found", 404);
  }

  if (member.role === ProjectRole.ADMIN && input.role !== ProjectRole.ADMIN) {
    await assertProjectKeepsAdmin(projectId, member.id);
  }

  const updatedMember = await prisma.projectMember.update({
    where: {
      id: member.id
    },
    data: {
      role: input.role
    },
    include: {
      user: true,
      teamMember: true
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
      projectMemberId: targetMemberId,
      userId: member.userId,
      role: input.role
    }
  });

  await publishProjectEvent(projectId, { type: "project.changed", projectId, teamId: project.teamId });

  return toMemberView({
    id: updatedMember.id,
    teamMemberId: updatedMember.teamMemberId,
    role: updatedMember.role,
    email: updatedMember.teamMember.email,
    normalizedEmail: updatedMember.teamMember.normalizedEmail,
    user: updatedMember.user
  });
}

export async function removeProjectMember(userId: string, projectId: string, targetMemberId: string) {
  const { project } = await requireProjectManager(userId, projectId);

  const member = await prisma.projectMember.findFirst({
    where: {
      id: targetMemberId,
      projectId
    }
  });

  if (!member) {
    throw new AppError("RESOURCE_NOT_FOUND", "Project member not found", 404);
  }

  if (member.role === ProjectRole.ADMIN) {
    await assertProjectKeepsAdmin(projectId, member.id);
  }

  await prisma.$transaction(async (tx) => {
    await tx.taskAssignee.updateMany({
      where: {
        projectMemberId: member.id
      },
      data: {
        projectMemberId: null,
        removedAt: new Date()
      }
    });

    await tx.projectMember.delete({
      where: {
        id: member.id
      }
    });
  });

  await createActivityLog({
    actorId: userId,
    teamId: project.teamId,
    projectId,
    action: "project_member.removed",
    targetType: "project_member",
    targetId: member.id,
    metadata: {
      projectMemberId: targetMemberId,
      userId: member.userId,
      role: member.role
    }
  });

  await publishProjectEvent(projectId, { type: "project.changed", projectId, teamId: project.teamId });

  return { ok: true };
}

async function assertProjectKeepsAdmin(projectId: string, excludedProjectMemberId?: string) {
  const adminCount = await prisma.projectMember.count({
    where: {
      projectId,
      role: ProjectRole.ADMIN,
      userId: {
        not: null
      },
      ...(excludedProjectMemberId
        ? {
            id: {
              not: excludedProjectMemberId
            }
          }
        : {})
    }
  });

  if (adminCount < 1) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "项目至少需要保留一名已加入的管理员。", 422);
  }
}
