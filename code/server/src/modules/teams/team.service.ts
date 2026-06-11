import { InvitationStatus, Prisma, ProjectRole, TeamRole } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../middleware/error-handler.js";
import { createActivityLog } from "../activity/activity.service.js";
import { publishTeamEvent, publishToUsers } from "../realtime/realtime.service.js";
import { requireSystemAdmin } from "../system/system.policy.js";
import { clearDeletedDefaultTeam, getSystemDefaults } from "../system/system.service.js";
import type {
  AddTeamMemberInput,
  CreateTeamInput,
  UpdateTeamInput,
  UpdateTeamMemberRoleInput
} from "./team.schema.js";
import { requireTeamAdmin, requireTeamMember } from "./team.policy.js";

function toTeamSummary(
  team: { id: string; name: string; createdAt: Date; updatedAt: Date },
  defaultTeamId?: string | null
) {
  return {
    id: team.id,
    name: team.name,
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
    isSystemDefault: defaultTeamId === team.id
  };
}

async function assertTeamNameUnique(name: string, excludeTeamId?: string) {
  const existingTeam = await prisma.team.findFirst({
    where: {
      name,
      deletedAt: null,
      ...(excludeTeamId
        ? {
            id: {
              not: excludeTeamId
            }
          }
        : {})
    }
  });

  if (existingTeam) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "Team name already exists", 422);
  }
}

function createInvitationToken() {
  return randomBytes(24).toString("base64url");
}

function invitationExpiresAt() {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
}

export async function createTeam(userId: string, input: CreateTeamInput) {
  await requireSystemAdmin(userId);
  await assertTeamNameUnique(input.name);
  const adminEmail = input.adminEmail;
  const adminUser = await prisma.user.findUnique({
    where: {
      email: adminEmail
    }
  });

  const team = await prisma.team.create({
    data: {
      name: input.name,
      ...(adminUser
        ? {
            members: {
              create: {
                userId: adminUser.id,
                role: TeamRole.ADMIN
              }
            }
          }
        : {
            invites: {
              create: {
                email: adminEmail,
                token: createInvitationToken(),
                teamRole: TeamRole.ADMIN,
                inviterId: userId,
                expiresAt: invitationExpiresAt()
              }
            }
          })
    }
  });

  await publishTeamEvent(team.id, { type: "team.changed", teamId: team.id });

  return toTeamSummary(team);
}

export async function listMyTeams(userId: string) {
  const userIsSystemAdmin = await isUserSystemAdmin(userId);
  const defaults = await getSystemDefaults();

  if (userIsSystemAdmin) {
    const teams = await prisma.team.findMany({
      where: {
        deletedAt: null
      },
      orderBy: {
        createdAt: "asc"
      }
    });

    return teams.map((team) => ({
      ...toTeamSummary(team, defaults.defaultTeamId),
      role: null,
      isSystemAdmin: true
    }));
  }

  const memberships = await prisma.teamMember.findMany({
    where: {
      userId,
      team: {
        deletedAt: null
      }
    },
    include: {
      team: true
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  return memberships.map((membership) => ({
    ...toTeamSummary(membership.team, defaults.defaultTeamId),
    role: membership.role,
    isSystemAdmin: false
  }));
}

export async function getTeam(userId: string, teamId: string) {
  await requireTeamMember(userId, teamId);

  const team = await prisma.team.findFirst({
    where: {
      id: teamId,
      deletedAt: null
    }
  });

  if (!team) {
    throw new AppError("RESOURCE_NOT_FOUND", "Team not found", 404);
  }

  return toTeamSummary(team);
}

export async function updateTeam(userId: string, teamId: string, input: UpdateTeamInput) {
  await requireTeamAdmin(userId, teamId);
  if (input.name) {
    await assertTeamNameUnique(input.name, teamId);
  }

  const team = await prisma.team.update({
    where: {
      id: teamId
    },
    data: input
  });

  await publishTeamEvent(teamId, { type: "team.changed", teamId });

  return toTeamSummary(team);
}

export async function deleteTeam(userId: string, teamId: string) {
  await requireSystemAdmin(userId);

  const projectCount = await prisma.project.count({
    where: {
      teamId,
      deletedAt: null
    }
  });

  if (projectCount > 0) {
    throw new AppError(
      "BUSINESS_RULE_VIOLATION",
      "Team with projects cannot be deleted",
      422
    );
  }

  const members = await prisma.teamMember.findMany({
    where: {
      teamId
    },
    select: {
      userId: true
    }
  });

  await prisma.team.update({
    where: {
      id: teamId
    },
    data: {
      deletedAt: new Date()
    }
  });

  publishToUsers(members.map((member) => member.userId), { type: "team.changed", teamId });
  await clearDeletedDefaultTeam(userId, teamId);

  return { ok: true };
}

export async function listTeamMembers(userId: string, teamId: string) {
  await requireTeamMember(userId, teamId);

  const members = await prisma.teamMember.findMany({
    where: {
      teamId
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

export async function addTeamMember(userId: string, teamId: string, input: AddTeamMemberInput) {
  await requireTeamAdmin(userId, teamId);

  const targetUser = await prisma.user.findUnique({
    where: {
      email: input.email
    }
  });

  if (!targetUser) {
    throw new AppError("RESOURCE_NOT_FOUND", "User with this email does not exist", 404);
  }

  const member = await prisma.$transaction(async (tx) => {
    const upsertedMember = await tx.teamMember.upsert({
      where: {
        userId_teamId: {
          userId: targetUser.id,
          teamId
        }
      },
      update: {
        role: input.role
      },
      create: {
        userId: targetUser.id,
        teamId,
        role: input.role
      },
      include: {
        user: true
      }
    });
    await assertTeamKeepsAdminEntry(tx, teamId);
    return upsertedMember;
  });

  await createActivityLog({
    actorId: userId,
    teamId,
    action: "team_member.added",
    targetType: "team_member",
    targetId: member.id,
    metadata: {
      userId: targetUser.id,
      email: targetUser.email,
      name: targetUser.name,
      role: input.role
    }
  });

  await publishTeamEvent(teamId, { type: "team.changed", teamId });

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

export async function updateTeamMemberRole(
  userId: string,
  teamId: string,
  targetUserId: string,
  input: UpdateTeamMemberRoleInput
) {
  await requireTeamAdmin(userId, teamId);
  const member = await getExistingTeamMember(teamId, targetUserId);
  const updatedMember = await prisma.$transaction(async (tx) => {
    const updated = await tx.teamMember.update({
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
    await assertTeamKeepsAdminEntry(tx, teamId);
    return updated;
  });

  await createActivityLog({
    actorId: userId,
    teamId,
    action: "team_member.role_updated",
    targetType: "team_member",
    targetId: member.id,
    metadata: {
      userId: targetUserId,
      role: input.role
    }
  });

  await publishTeamEvent(teamId, { type: "team.changed", teamId });

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

export async function removeTeamMember(userId: string, teamId: string, targetUserId: string) {
  await requireTeamAdmin(userId, teamId);
  const member = await getExistingTeamMember(teamId, targetUserId);

  await assertTeamMemberRemovalKeepsProjectAdmins(teamId, targetUserId);

  await prisma.$transaction(async (tx) => {
    await tx.projectMember.deleteMany({
      where: {
        userId: targetUserId,
        project: {
          teamId
        }
      }
    });
    await tx.teamMember.delete({
      where: {
        id: member.id
      }
    });
    await assertTeamKeepsAdminEntry(tx, teamId);
  });

  await createActivityLog({
    actorId: userId,
    teamId,
    action: "team_member.removed",
    targetType: "team_member",
    targetId: member.id,
    metadata: {
      userId: targetUserId,
      role: member.role
    }
  });

  await publishTeamEvent(teamId, { type: "team.changed", teamId });

  return { ok: true };
}

async function getExistingTeamMember(teamId: string, userId: string) {
  const member = await prisma.teamMember.findUnique({
    where: {
      userId_teamId: {
        userId,
        teamId
      }
    }
  });

  if (!member) {
    throw new AppError("RESOURCE_NOT_FOUND", "Team member not found", 404);
  }

  return member;
}

async function isUserSystemAdmin(userId: string) {
  const user = await prisma.user.findUnique({
    where: {
      id: userId
    },
    select: {
      systemRole: true
    }
  });

  return user?.systemRole === "ADMIN";
}

async function assertTeamKeepsAdminEntry(tx: Prisma.TransactionClient, teamId: string) {
  const adminCount = await tx.teamMember.count({
    where: {
      teamId,
      role: TeamRole.ADMIN
    }
  });
  const pendingAdminInvitationCount = await tx.invitation.count({
    where: {
      teamId,
      projectId: null,
      teamRole: TeamRole.ADMIN,
      status: InvitationStatus.PENDING,
      expiresAt: {
        gt: new Date()
      }
    }
  });

  if (adminCount + pendingAdminInvitationCount < 1) {
    throw new AppError(
      "BUSINESS_RULE_VIOLATION",
      "团队至少需要保留一名管理员或一条待接受的管理员邀请。",
      422
    );
  }
}

async function assertTeamMemberRemovalKeepsProjectAdmins(teamId: string, userId: string) {
  const projectsWithoutOtherAdmin = await prisma.project.findMany({
    where: {
      teamId,
      deletedAt: null,
      members: {
        some: {
          userId,
          role: ProjectRole.ADMIN
        },
        none: {
          userId: {
            not: userId
          },
          role: ProjectRole.ADMIN
        }
      }
    },
    select: {
      name: true
    },
    take: 1
  });

  if (projectsWithoutOtherAdmin.length > 0) {
    throw new AppError(
      "BUSINESS_RULE_VIOLATION",
      `Project "${projectsWithoutOtherAdmin[0].name}" must keep at least one admin`,
      422
    );
  }
}
