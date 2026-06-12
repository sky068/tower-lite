import { Prisma, ProjectRole, TeamRole } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../middleware/error-handler.js";
import { createActivityLog } from "../activity/activity.service.js";
import {
  ensureTeamMemberForEmail,
  ensureTeamMemberForEmailWithoutDowngrade,
  normalizeEmail,
  toMemberView
} from "../memberships/membership.service.js";
import { publishTeamEvent, publishToUsers } from "../realtime/realtime.service.js";
import { requireSystemAdmin } from "../system/system.policy.js";
import type {
  AddTeamMemberInput,
  CreateTeamInput,
  UpdateTeamInput,
  UpdateTeamMemberRoleInput
} from "./team.schema.js";
import { requireTeamAdmin, requireTeamMember } from "./team.policy.js";

function toTeamSummary(team: { id: string; name: string; createdAt: Date; updatedAt: Date }) {
  return {
    id: team.id,
    name: team.name,
    createdAt: team.createdAt,
    updatedAt: team.updatedAt
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

export async function createTeam(userId: string, input: CreateTeamInput) {
  await requireSystemAdmin(userId);
  await assertTeamNameUnique(input.name);
  const adminEmail = normalizeEmail(input.adminEmail);

  const team = await prisma.$transaction(async (tx) => {
    const createdTeam = await tx.team.create({
      data: {
        name: input.name
      }
    });

    const adminMember = await ensureTeamMemberForEmail(tx, {
      teamId: createdTeam.id,
      email: adminEmail,
      role: TeamRole.ADMIN
    });

    if (!adminMember.userId) {
      await tx.invitation.create({
        data: {
          email: adminEmail,
          token: createInvitationToken(),
          teamRole: TeamRole.ADMIN,
          inviterId: userId,
          teamId: createdTeam.id,
          expiresAt: invitationExpiresAt()
        }
      });
    }

    return createdTeam;
  });

  await publishTeamEvent(team.id, { type: "team.changed", teamId: team.id });

  return toTeamSummary(team);
}

export async function listMyTeams(userId: string) {
  const userIsSystemAdmin = await isUserSystemAdmin(userId);

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
      ...toTeamSummary(team),
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
    ...toTeamSummary(membership.team),
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

  publishToUsers(
    members.map((member) => member.userId).filter((memberUserId): memberUserId is string => Boolean(memberUserId)),
    { type: "team.changed", teamId }
  );

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

  const pendingEmails = members
    .filter((member) => !member.userId)
    .map((member) => member.normalizedEmail);
  const invitations = pendingEmails.length
    ? await prisma.invitation.findMany({
        where: {
          teamId,
          projectId: null,
          status: "PENDING",
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

  return members.map((member) => withInvitePath(toMemberView(member), invitationsByEmail));
}

export async function addTeamMember(userId: string, teamId: string, input: AddTeamMemberInput) {
  await requireTeamAdmin(userId, teamId);

  const email = normalizeEmail(input.email);

  const member = await prisma.$transaction(async (tx) => {
    await tx.invitation.updateMany({
      where: {
        email,
        teamId,
        projectId: null,
        status: "PENDING"
      },
      data: {
        status: "REVOKED"
      }
    });

    const upsertedMember = await ensureTeamMemberForEmailWithoutDowngrade(tx, {
      teamId,
      email,
      role: input.role
    });
    if (!upsertedMember.userId) {
      await tx.invitation.create({
        data: {
          email,
          token: createInvitationToken(),
          teamRole: input.role,
          teamId,
          inviterId: userId,
          expiresAt: invitationExpiresAt()
        }
      });
    }
    if (input.role !== TeamRole.ADMIN) {
      await assertTeamKeepsAdminEntry(tx, teamId);
    }
    return upsertedMember;
  });

  await createActivityLog({
    actorId: userId,
    teamId,
    action: "team_member.added",
    targetType: "team_member",
    targetId: member.id,
    metadata: {
      userId: member.userId,
      email: member.email,
      name: member.user?.name,
      role: input.role
    }
  });

  await publishTeamEvent(teamId, { type: "team.changed", teamId });

  return toMemberView(member);
}

export async function updateTeamMemberRole(
  userId: string,
  teamId: string,
  targetMemberId: string,
  input: UpdateTeamMemberRoleInput
) {
  await requireTeamAdmin(userId, teamId);
  const member = await getExistingTeamMember(teamId, targetMemberId);
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
      memberId: targetMemberId,
      userId: member.userId,
      role: input.role
    }
  });

  await publishTeamEvent(teamId, { type: "team.changed", teamId });

  return toMemberView(updatedMember);
}

export async function removeTeamMember(userId: string, teamId: string, targetMemberId: string) {
  await requireTeamAdmin(userId, teamId);
  const member = await getExistingTeamMember(teamId, targetMemberId);

  await assertTeamMemberRemovalKeepsProjectAdmins(teamId, member.id);

  await prisma.$transaction(async (tx) => {
    const projectMembers = await tx.projectMember.findMany({
      where: {
        teamMemberId: member.id,
        project: {
          teamId
        }
      },
      include: {
        user: true,
        teamMember: true
      }
    });

    for (const projectMember of projectMembers) {
      await tx.taskAssignee.updateMany({
        where: {
          projectMemberId: projectMember.id
        },
        data: {
          projectMemberId: null,
          removedAt: new Date()
        }
      });
    }

    await tx.projectMember.deleteMany({
      where: {
        teamMemberId: member.id,
        project: {
          teamId
        }
      }
    });
    await tx.invitation.updateMany({
      where: {
        email: member.normalizedEmail,
        teamId,
        status: "PENDING"
      },
      data: {
        status: "REVOKED"
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
      memberId: targetMemberId,
      userId: member.userId,
      role: member.role
    }
  });

  await publishTeamEvent(teamId, { type: "team.changed", teamId });

  return { ok: true };
}

async function getExistingTeamMember(teamId: string, memberId: string) {
  const member = await prisma.teamMember.findFirst({
    where: {
      id: memberId,
      teamId
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
      role: TeamRole.ADMIN,
      userId: {
        not: null
      }
    }
  });
  if (adminCount < 1) {
    throw new AppError(
      "BUSINESS_RULE_VIOLATION",
      "团队至少需要保留一名已加入的管理员。",
      422
    );
  }
}

async function assertTeamMemberRemovalKeepsProjectAdmins(teamId: string, teamMemberId: string) {
  const projectsWithoutOtherAdmin = await prisma.project.findMany({
    where: {
      teamId,
      deletedAt: null,
      members: {
        some: {
          teamMemberId,
          role: ProjectRole.ADMIN
        },
        none: {
          teamMemberId: {
            not: teamMemberId
          },
          role: ProjectRole.ADMIN,
          userId: {
            not: null
          }
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
      `项目「${projectsWithoutOtherAdmin[0].name}」至少需要保留一名已加入的管理员。`,
      422
    );
  }
}
