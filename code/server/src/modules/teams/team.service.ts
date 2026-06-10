import { ProjectRole, TeamRole } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../middleware/error-handler.js";
import { createActivityLog } from "../activity/activity.service.js";
import { publishTeamEvent, publishToUsers } from "../realtime/realtime.service.js";
import type {
  AddTeamMemberInput,
  CreateTeamInput,
  UpdateTeamInput,
  UpdateTeamMemberRoleInput
} from "./team.schema.js";
import { requireTeamMember, requireTeamOwner } from "./team.policy.js";

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

export async function createTeam(userId: string, input: CreateTeamInput) {
  await assertTeamNameUnique(input.name);

  const team = await prisma.team.create({
    data: {
      name: input.name,
      members: {
        create: {
          userId,
          role: TeamRole.OWNER
        }
      }
    }
  });

  await publishTeamEvent(team.id, { type: "team.changed", teamId: team.id });

  return toTeamSummary(team);
}

export async function listMyTeams(userId: string) {
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
    role: membership.role
  }));
}

export async function getTeam(userId: string, teamId: string) {
  await requireTeamMember(userId, teamId);

  const team = await prisma.team.findFirstOrThrow({
    where: {
      id: teamId,
      deletedAt: null
    }
  });

  return toTeamSummary(team);
}

export async function updateTeam(userId: string, teamId: string, input: UpdateTeamInput) {
  await requireTeamOwner(userId, teamId);
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
  await requireTeamOwner(userId, teamId);

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
  await requireTeamOwner(userId, teamId);

  const targetUser = await prisma.user.findUnique({
    where: {
      email: input.email
    }
  });

  if (!targetUser) {
    throw new AppError("RESOURCE_NOT_FOUND", "User with this email does not exist", 404);
  }

  const member = await prisma.teamMember.upsert({
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
  await requireTeamOwner(userId, teamId);
  const member = await getExistingTeamMember(teamId, targetUserId);

  if (member.role === TeamRole.OWNER && input.role !== TeamRole.OWNER) {
    await assertTeamKeepsOwner(teamId);
  }

  const updatedMember = await prisma.teamMember.update({
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
  await requireTeamOwner(userId, teamId);
  const member = await getExistingTeamMember(teamId, targetUserId);

  if (member.role === TeamRole.OWNER) {
    await assertTeamKeepsOwner(teamId);
  }

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

async function assertTeamKeepsOwner(teamId: string) {
  const ownerCount = await prisma.teamMember.count({
    where: {
      teamId,
      role: TeamRole.OWNER
    }
  });

  if (ownerCount <= 1) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "Team must keep at least one owner", 422);
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
