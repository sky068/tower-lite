import { InvitationStatus, Prisma, ProjectRole, TeamRole } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../middleware/error-handler.js";
import { createActivityLog } from "../activity/activity.service.js";
import {
  claimPendingMembershipsForUserInTransaction,
  ensureProjectMemberForTeamMember,
  ensureTeamMemberForEmailWithoutDowngrade,
  publishMembershipClaimSideEffects,
  normalizeEmail
} from "../memberships/membership.service.js";
import { publishProjectEvent, publishTeamEvent } from "../realtime/realtime.service.js";
import { requireProjectManager } from "../projects/project.policy.js";
import { requireTeamAdmin } from "../teams/team.policy.js";
import type {
  AcceptInvitationInput,
  CreateProjectInvitationInput,
  CreateTeamInvitationInput
} from "./invitation.schema.js";

const INVITATION_EXPIRES_DAYS = 7;

function createInvitationToken() {
  return randomBytes(24).toString("base64url");
}

function expiresAt() {
  return new Date(Date.now() + INVITATION_EXPIRES_DAYS * 24 * 60 * 60 * 1000);
}

function toInvitation(invitation: {
  id: string;
  email: string;
  token: string;
  status: InvitationStatus;
  teamRole: TeamRole | null;
  projectRole: ProjectRole | null;
  teamId: string;
  projectId: string | null;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
  inviter?: {
    id: string;
    name: string;
    email: string;
  };
  project?: {
    id: string;
    name: string;
  } | null;
}) {
  return {
    id: invitation.id,
    email: invitation.email,
    token: invitation.token,
    status: invitation.status,
    teamRole: invitation.teamRole,
    projectRole: invitation.projectRole,
    teamId: invitation.teamId,
    projectId: invitation.projectId,
    acceptPath: `/invitations/accept?token=${encodeURIComponent(invitation.token)}`,
    expiresAt: invitation.expiresAt,
    acceptedAt: invitation.acceptedAt,
    createdAt: invitation.createdAt,
    inviter: invitation.inviter
      ? {
          id: invitation.inviter.id,
          name: invitation.inviter.name,
          email: invitation.inviter.email
        }
      : undefined,
    project: invitation.project
      ? {
          id: invitation.project.id,
          name: invitation.project.name
        }
      : null
  };
}

export async function listTeamInvitations(userId: string, teamId: string) {
  await requireTeamAdmin(userId, teamId);

  const invitations = await prisma.invitation.findMany({
    where: {
      teamId
    },
    include: {
      inviter: true,
      project: true
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return invitations.map(toInvitation);
}

export async function listProjectInvitations(userId: string, projectId: string) {
  await requireProjectManager(userId, projectId);

  const invitations = await prisma.invitation.findMany({
    where: {
      projectId
    },
    include: {
      inviter: true,
      project: true
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return invitations.map(toInvitation);
}

export async function createTeamInvitation(
  userId: string,
  teamId: string,
  input: CreateTeamInvitationInput
) {
  await requireTeamAdmin(userId, teamId);
  const email = normalizeEmail(input.email);

  const invitation = await prisma.$transaction(async (tx) => {
    await tx.invitation.updateMany({
      where: {
        email,
        teamId,
        projectId: null,
        status: InvitationStatus.PENDING
      },
      data: {
        status: InvitationStatus.REVOKED
      }
    });
    const teamMember = await ensureTeamMemberForEmailWithoutDowngrade(tx, {
      teamId,
      email,
      role: input.role
    });

    const createdInvitation = await tx.invitation.create({
      data: {
        email,
        token: createInvitationToken(),
        teamRole: input.role,
        teamId,
        inviterId: userId,
        expiresAt: expiresAt()
      },
      include: {
        inviter: true,
        project: true
      }
    });
    if (input.role !== TeamRole.ADMIN) {
      await assertTeamKeepsAdminEntry(tx, teamId);
    }
    return createdInvitation;
  });

  await createActivityLog({
    actorId: userId,
    teamId,
    action: "team_invitation.created",
    targetType: "invitation",
    targetId: invitation.id,
    metadata: {
      email,
      role: input.role
    }
  });
  await publishTeamEvent(teamId, { type: "team.changed", teamId });

  return toInvitation(invitation);
}

export async function createProjectInvitation(
  userId: string,
  projectId: string,
  input: CreateProjectInvitationInput
) {
  const { project } = await requireProjectManager(userId, projectId);
  const email = normalizeEmail(input.email);

  const invitation = await prisma.$transaction(async (tx) => {
    await tx.invitation.updateMany({
      where: {
        email,
        teamId: project.teamId,
        projectId,
        status: InvitationStatus.PENDING
      },
      data: {
        status: InvitationStatus.REVOKED
      }
    });
    const teamMember = await ensureTeamMemberForEmailWithoutDowngrade(tx, {
      teamId: project.teamId,
      email,
      role: input.teamRole ?? TeamRole.MEMBER
    });
    await ensureProjectMemberForTeamMember(tx, {
      projectId,
      teamMemberId: teamMember.id,
      role: input.projectRole
    });

    return tx.invitation.create({
      data: {
        email,
        token: createInvitationToken(),
        teamRole: input.teamRole,
        projectRole: input.projectRole,
        teamId: project.teamId,
        projectId,
        inviterId: userId,
        expiresAt: expiresAt()
      },
      include: {
        inviter: true,
        project: true
      }
    });
  });

  await createActivityLog({
    actorId: userId,
    teamId: project.teamId,
    projectId,
    action: "project_invitation.created",
    targetType: "invitation",
    targetId: invitation.id,
    metadata: {
      email,
      teamRole: input.teamRole,
      projectRole: input.projectRole,
      projectName: project.name
    }
  });
  await publishProjectEvent(projectId, {
    type: "project.changed",
    teamId: project.teamId,
    projectId
  });

  return toInvitation(invitation);
}

export async function revokeInvitation(userId: string, invitationId: string) {
  const invitation = await prisma.invitation.findUnique({
    where: {
      id: invitationId
    }
  });

  if (!invitation) {
    throw new AppError("RESOURCE_NOT_FOUND", "Invitation not found", 404);
  }

  if (invitation.projectId) {
    await requireProjectManager(userId, invitation.projectId);
  } else {
    await requireTeamAdmin(userId, invitation.teamId);
  }

  if (invitation.status !== InvitationStatus.PENDING) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "Only pending invitations can be revoked", 422);
  }

  const updatedInvitation = await prisma.$transaction(async (tx) => {
    const updated = await tx.invitation.update({
      where: {
        id: invitationId
      },
      data: {
        status: InvitationStatus.REVOKED
      },
      include: {
        inviter: true,
        project: true
      }
    });

    if (!invitation.projectId && invitation.teamRole === TeamRole.ADMIN) {
      await assertTeamKeepsAdminEntry(tx, invitation.teamId);
    }

    return updated;
  });

  await createActivityLog({
    actorId: userId,
    teamId: invitation.teamId,
    projectId: invitation.projectId,
    action: invitation.projectId ? "project_invitation.revoked" : "team_invitation.revoked",
    targetType: "invitation",
    targetId: invitationId,
    metadata: {
      email: invitation.email
    }
  });
  await publishTeamEvent(invitation.teamId, { type: "team.changed", teamId: invitation.teamId });

  if (invitation.projectId) {
    await publishProjectEvent(invitation.projectId, {
      type: "project.changed",
      teamId: invitation.teamId,
      projectId: invitation.projectId
    });
  }

  return toInvitation(updatedInvitation);
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

async function acceptPendingInvitationForUser(input: {
  userId: string;
  invitation: {
    id: string;
    email: string;
    teamId: string;
    projectId: string | null;
    teamRole: TeamRole | null;
    projectRole: ProjectRole | null;
  };
}) {
  const teamRole = input.invitation.teamRole ?? TeamRole.MEMBER;
  const projectRole = input.invitation.projectRole ?? ProjectRole.VIEWER;
  const acceptResult = await prisma.$transaction(async (tx) => {
    const acceptedInvitation = await tx.invitation.updateMany({
      where: {
        id: input.invitation.id,
        status: InvitationStatus.PENDING
      },
      data: {
        status: InvitationStatus.ACCEPTED,
        acceptedAt: new Date()
      }
    });

    if (acceptedInvitation.count === 0) {
      const currentInvitation = await tx.invitation.findUnique({
        where: {
          id: input.invitation.id
        },
        select: {
          status: true
        }
      });

      return {
        accepted: false,
        status: currentInvitation?.status ?? null,
        claim: null
      };
    }

    const claim = await claimPendingMembershipsForUserInTransaction(tx, input.userId);

    return {
      accepted: true,
      status: InvitationStatus.ACCEPTED,
      claim
    };
  });

  if (!acceptResult.accepted) {
    return acceptResult;
  }

  await publishMembershipClaimSideEffects(acceptResult.claim);

  await createActivityLog({
    actorId: input.userId,
    teamId: input.invitation.teamId,
    projectId: input.invitation.projectId,
    action: input.invitation.projectId ? "project_invitation.accepted" : "team_invitation.accepted",
    targetType: "invitation",
    targetId: input.invitation.id,
    metadata: {
      email: input.invitation.email,
      teamRole,
      projectRole: input.invitation.projectId ? projectRole : null
    }
  });

  await publishTeamEvent(input.invitation.teamId, { type: "team.changed", teamId: input.invitation.teamId });

  if (input.invitation.projectId) {
    await publishProjectEvent(input.invitation.projectId, {
      type: "project.changed",
      teamId: input.invitation.teamId,
      projectId: input.invitation.projectId
    });
  }

  return acceptResult;
}

export async function acceptPendingInvitationsForUser(userId: string) {
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      deletedAt: null
    },
    select: {
      email: true
    }
  });

  if (!user) {
    return;
  }

  const invitations = await prisma.invitation.findMany({
    where: {
      email: normalizeEmail(user.email),
      status: InvitationStatus.PENDING,
      expiresAt: {
        gt: new Date()
      }
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  for (const invitation of invitations) {
    await acceptPendingInvitationForUser({
      userId,
      invitation
    });
  }
}

export async function acceptInvitation(userId: string, input: AcceptInvitationInput) {
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      deletedAt: null
    }
  });

  if (!user) {
    throw new AppError("RESOURCE_NOT_FOUND", "User not found", 404);
  }

  const invitation = await prisma.invitation.findUnique({
    where: {
      token: input.token
    },
    include: {
      project: true
    }
  });

  if (!invitation) {
    throw new AppError("RESOURCE_NOT_FOUND", "Invitation not found", 404);
  }

  if (normalizeEmail(user.email) !== normalizeEmail(invitation.email)) {
    throw new AppError(
      "BUSINESS_RULE_VIOLATION",
      "Invitation email does not match current user",
      422
    );
  }

  if (invitation.status === InvitationStatus.ACCEPTED) {
    return {
      ok: true,
      teamId: invitation.teamId,
      projectId: invitation.projectId
    };
  }

  if (invitation.status === InvitationStatus.REVOKED) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "Invitation has been revoked", 422);
  }

  if (invitation.status === InvitationStatus.EXPIRED) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "Invitation has expired", 422);
  }

  if (invitation.expiresAt <= new Date()) {
    await prisma.invitation.update({
      where: {
        id: invitation.id
      },
      data: {
        status: InvitationStatus.EXPIRED
      }
    });
    throw new AppError("BUSINESS_RULE_VIOLATION", "Invitation has expired", 422);
  }

  const acceptResult = await acceptPendingInvitationForUser({
    userId,
    invitation
  });

  if (!acceptResult.accepted) {
    if (acceptResult.status === InvitationStatus.ACCEPTED) {
      return {
        ok: true,
        teamId: invitation.teamId,
        projectId: invitation.projectId
      };
    }

    if (acceptResult.status === InvitationStatus.REVOKED) {
      throw new AppError("BUSINESS_RULE_VIOLATION", "Invitation has been revoked", 422);
    }

    if (acceptResult.status === InvitationStatus.EXPIRED) {
      throw new AppError("BUSINESS_RULE_VIOLATION", "Invitation has expired", 422);
    }

    throw new AppError("BUSINESS_RULE_VIOLATION", "Invitation is no longer pending", 422);
  }

  return {
    ok: true,
    teamId: invitation.teamId,
    projectId: invitation.projectId
  };
}
