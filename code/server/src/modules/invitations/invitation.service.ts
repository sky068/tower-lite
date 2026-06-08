import { InvitationStatus, ProjectRole, TeamRole } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../middleware/error-handler.js";
import { createActivityLog } from "../activity/activity.service.js";
import { publishProjectEvent, publishTeamEvent } from "../realtime/realtime.service.js";
import { requireProjectManager } from "../projects/project.policy.js";
import { requireTeamOwner } from "../teams/team.policy.js";
import type {
  AcceptInvitationInput,
  CreateProjectInvitationInput,
  CreateTeamInvitationInput
} from "./invitation.schema.js";

const INVITATION_EXPIRES_DAYS = 7;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

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

async function revokeExistingPendingInvitation(input: {
  email: string;
  teamId: string;
  projectId?: string | null;
}) {
  await prisma.invitation.updateMany({
    where: {
      email: input.email,
      teamId: input.teamId,
      projectId: input.projectId ?? null,
      status: InvitationStatus.PENDING
    },
    data: {
      status: InvitationStatus.REVOKED
    }
  });
}

export async function listTeamInvitations(userId: string, teamId: string) {
  await requireTeamOwner(userId, teamId);

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
  await requireTeamOwner(userId, teamId);
  const email = normalizeEmail(input.email);

  await revokeExistingPendingInvitation({ email, teamId });

  const invitation = await prisma.invitation.create({
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

  return toInvitation(invitation);
}

export async function createProjectInvitation(
  userId: string,
  projectId: string,
  input: CreateProjectInvitationInput
) {
  const { project } = await requireProjectManager(userId, projectId);
  const email = normalizeEmail(input.email);

  await revokeExistingPendingInvitation({ email, teamId: project.teamId, projectId });

  const invitation = await prisma.invitation.create({
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
    await requireTeamOwner(userId, invitation.teamId);
  }

  if (invitation.status !== InvitationStatus.PENDING) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "Only pending invitations can be revoked", 422);
  }

  const updatedInvitation = await prisma.invitation.update({
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

  return toInvitation(updatedInvitation);
}

export async function acceptInvitation(userId: string, input: AcceptInvitationInput) {
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

  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      deletedAt: null
    }
  });

  if (!user) {
    throw new AppError("RESOURCE_NOT_FOUND", "User not found", 404);
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

  const teamRole = invitation.teamRole ?? TeamRole.MEMBER;
  const projectRole = invitation.projectRole ?? ProjectRole.VIEWER;

  const acceptResult = await prisma.$transaction(async (tx) => {
    const acceptedInvitation = await tx.invitation.updateMany({
      where: {
        id: invitation.id,
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
          id: invitation.id
        },
        select: {
          status: true
        }
      });

      return {
        accepted: false,
        status: currentInvitation?.status ?? null
      };
    }

    await tx.teamMember.createMany({
      data: [
        {
          userId,
          teamId: invitation.teamId,
          role: teamRole
        }
      ],
      skipDuplicates: true
    });

    if (invitation.projectId) {
      await tx.projectMember.createMany({
        data: [
          {
            userId,
            projectId: invitation.projectId,
            role: projectRole
          }
        ],
        skipDuplicates: true
      });
    }

    return {
      accepted: true,
      status: InvitationStatus.ACCEPTED
    };
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

  await createActivityLog({
    actorId: userId,
    teamId: invitation.teamId,
    projectId: invitation.projectId,
    action: invitation.projectId ? "project_invitation.accepted" : "team_invitation.accepted",
    targetType: "invitation",
    targetId: invitation.id,
    metadata: {
      email: invitation.email,
      teamRole,
      projectRole: invitation.projectId ? projectRole : null
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

  return {
    ok: true,
    teamId: invitation.teamId,
    projectId: invitation.projectId
  };
}
