import { TeamRole } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../middleware/error-handler.js";
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

export async function createTeam(userId: string, input: CreateTeamInput) {
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
  await requireTeamAdmin(userId, teamId);

  const team = await prisma.team.update({
    where: {
      id: teamId
    },
    data: input
  });

  return toTeamSummary(team);
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

  if (member.role === TeamRole.OWNER) {
    await assertTeamKeepsOwner(teamId);
  }

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
