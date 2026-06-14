import { Prisma, ProjectRole, TeamRole } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { createActivityLog } from "../activity/activity.service.js";
import { publishProjectEvent, publishTeamEvent, publishToUser } from "../realtime/realtime.service.js";

type PrismaClientLike = Prisma.TransactionClient | typeof prisma;

type PendingMembershipClaim = {
  user: {
    id: string;
    email: string;
    name: string;
    avatarUrl: string | null;
  };
  teamMembers: Array<{
    id: string;
    teamId: string;
    role: TeamRole;
    email: string;
  }>;
  projectMembers: Array<{
    id: string;
    role: ProjectRole;
    projectId: string;
    teamMemberId: string;
    project: {
      teamId: string;
    };
  }>;
};

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function getMemberDisplay(member: {
  email: string;
  user?: {
    name: string;
    email: string;
    avatarUrl: string | null;
  } | null;
}) {
  return {
    name: member.user?.name ?? member.email,
    email: member.user?.email ?? member.email,
    avatarUrl: member.user?.avatarUrl ?? null
  };
}

function mergeTeamRole(currentRole: TeamRole | undefined, nextRole: TeamRole) {
  if (currentRole === TeamRole.ADMIN) {
    return TeamRole.ADMIN;
  }

  return nextRole;
}

export function mergeProjectRole(currentRole: ProjectRole | undefined, nextRole: ProjectRole) {
  const rank: Record<ProjectRole, number> = {
    [ProjectRole.VIEWER]: 1,
    [ProjectRole.EDITOR]: 2,
    [ProjectRole.ADMIN]: 3
  };

  if (!currentRole || rank[nextRole] > rank[currentRole]) {
    return nextRole;
  }

  return currentRole;
}

export function toMemberView(member: {
  id: string;
  teamMemberId?: string;
  role: TeamRole | ProjectRole;
  email: string;
  normalizedEmail: string;
  user: {
    id: string;
    email: string;
    name: string;
    avatarUrl: string | null;
    systemRole?: string;
  } | null;
}) {
  return {
    id: member.id,
    teamMemberId: member.teamMemberId,
    role: member.role,
    email: member.email,
    normalizedEmail: member.normalizedEmail,
    status: member.user ? "ACTIVE" : "PENDING",
    user: member.user
      ? {
          id: member.user.id,
          email: member.user.email,
          name: member.user.name,
          avatarUrl: member.user.avatarUrl,
          systemRole: member.user.systemRole ?? "USER"
        }
      : null
  };
}

export async function ensureTeamMemberForEmail(
  tx: PrismaClientLike,
  input: {
    teamId: string;
    email: string;
    role: TeamRole;
  }
) {
  const normalizedEmail = normalizeEmail(input.email);
  const user = await tx.user.findUnique({
    where: {
      email: normalizedEmail
    }
  });
  const verifiedUser = user?.emailVerifiedAt ? user : null;

  return tx.teamMember.upsert({
    where: {
      teamId_normalizedEmail: {
        teamId: input.teamId,
        normalizedEmail
      }
    },
    update: {
      role: mergeTeamRole(undefined, input.role),
      email: verifiedUser?.email ?? normalizedEmail,
      userId: verifiedUser?.id,
      claimedAt: verifiedUser ? new Date() : undefined
    },
    create: {
      teamId: input.teamId,
      role: input.role,
      email: verifiedUser?.email ?? normalizedEmail,
      normalizedEmail,
      userId: verifiedUser?.id,
      claimedAt: verifiedUser ? new Date() : undefined
    },
    include: {
      user: true
    }
  });
}

export async function ensureTeamMemberForEmailWithoutDowngrade(
  tx: PrismaClientLike,
  input: {
    teamId: string;
    email: string;
    role: TeamRole;
  }
) {
  const normalizedEmail = normalizeEmail(input.email);
  const existingMember = await tx.teamMember.findUnique({
    where: {
      teamId_normalizedEmail: {
        teamId: input.teamId,
        normalizedEmail
      }
    }
  });

  if (!existingMember) {
    return ensureTeamMemberForEmail(tx, input);
  }

  const user = await tx.user.findUnique({
    where: {
      email: normalizedEmail
    }
  });
  const verifiedUser = user?.emailVerifiedAt ? user : null;

  return tx.teamMember.update({
    where: {
      id: existingMember.id
    },
    data: {
      role: mergeTeamRole(existingMember.role, input.role),
      email: verifiedUser?.email ?? normalizedEmail,
      userId: verifiedUser?.id ?? existingMember.userId,
      claimedAt: verifiedUser ? existingMember.claimedAt ?? new Date() : existingMember.claimedAt
    },
    include: {
      user: true
    }
  });
}

export async function ensureProjectMemberForTeamMember(
  tx: PrismaClientLike,
  input: {
    projectId: string;
    teamMemberId: string;
    role: ProjectRole;
  }
) {
  const teamMember = await tx.teamMember.findUnique({
    where: {
      id: input.teamMemberId
    },
    include: {
      user: true
    }
  });

  if (!teamMember) {
    return null;
  }

  const existingMember = await tx.projectMember.findUnique({
    where: {
      projectId_teamMemberId: {
        projectId: input.projectId,
        teamMemberId: input.teamMemberId
      }
    }
  });

  if (existingMember) {
    return tx.projectMember.update({
      where: {
        id: existingMember.id
      },
      data: {
        role: mergeProjectRole(existingMember.role, input.role),
        userId: teamMember.userId,
        claimedAt: teamMember.userId ? teamMember.claimedAt ?? new Date() : null
      },
      include: {
        user: true,
        teamMember: {
          include: {
            user: true
          }
        }
      }
    });
  }

  return tx.projectMember.create({
    data: {
      projectId: input.projectId,
      teamMemberId: input.teamMemberId,
      role: input.role,
      userId: teamMember.userId,
      claimedAt: teamMember.userId ? teamMember.claimedAt ?? new Date() : null
    },
    include: {
      user: true,
      teamMember: {
        include: {
          user: true
        }
      }
    }
  });
}

async function mergeTaskAssigneesForProjectMember(
  tx: Prisma.TransactionClient,
  input: {
    fromProjectMemberId: string;
    toProjectMemberId: string;
    assigneeNameSnapshot: string;
    assigneeEmailSnapshot: string;
    assigneeAvatarSnapshot: string | null;
  }
) {
  const assignments = await tx.taskAssignee.findMany({
    where: {
      projectMemberId: input.fromProjectMemberId
    },
    select: {
      id: true,
      taskId: true
    }
  });

  for (const assignment of assignments) {
    const duplicatedAssignment = await tx.taskAssignee.findFirst({
      where: {
        taskId: assignment.taskId,
        projectMemberId: input.toProjectMemberId
      },
      select: {
        id: true
      }
    });

    if (duplicatedAssignment) {
      await tx.taskAssignee.delete({
        where: {
          id: assignment.id
        }
      });
      continue;
    }

    await tx.taskAssignee.update({
      where: {
        id: assignment.id
      },
      data: {
        projectMemberId: input.toProjectMemberId,
        assigneeNameSnapshot: input.assigneeNameSnapshot,
        assigneeEmailSnapshot: input.assigneeEmailSnapshot,
        assigneeAvatarSnapshot: input.assigneeAvatarSnapshot,
        removedAt: null
      }
    });
  }
}

async function claimProjectMemberForExistingTeamMember(
  tx: Prisma.TransactionClient,
  input: {
    pendingProjectMember: {
      id: string;
      role: ProjectRole;
      projectId: string;
      teamMemberId: string;
      project: {
        teamId: string;
      };
    };
    teamMemberId: string;
    user: {
      id: string;
      email: string;
      name: string;
      avatarUrl: string | null;
    };
    claimedAt: Date;
  }
) {
  const existingProjectMember = await tx.projectMember.findUnique({
    where: {
      projectId_teamMemberId: {
        projectId: input.pendingProjectMember.projectId,
        teamMemberId: input.teamMemberId
      }
    },
    select: {
      id: true,
      role: true
    }
  });

  if (!existingProjectMember) {
    return tx.projectMember.update({
      where: {
        id: input.pendingProjectMember.id
      },
      data: {
        teamMemberId: input.teamMemberId,
        userId: input.user.id,
        claimedAt: input.claimedAt
      },
      select: {
        id: true,
        role: true,
        projectId: true,
        teamMemberId: true,
        project: {
          select: {
            teamId: true
          }
        }
      }
    });
  }

  const updatedProjectMember = await tx.projectMember.update({
    where: {
      id: existingProjectMember.id
    },
    data: {
      role: mergeProjectRole(existingProjectMember.role, input.pendingProjectMember.role),
      userId: input.user.id,
      claimedAt: input.claimedAt
    },
    select: {
      id: true,
      role: true,
      projectId: true,
      teamMemberId: true,
      project: {
        select: {
          teamId: true
        }
      }
    }
  });

  await mergeTaskAssigneesForProjectMember(tx, {
    fromProjectMemberId: input.pendingProjectMember.id,
    toProjectMemberId: updatedProjectMember.id,
    assigneeNameSnapshot: input.user.name,
    assigneeEmailSnapshot: input.user.email,
    assigneeAvatarSnapshot: input.user.avatarUrl
  });
  await tx.projectMember.delete({
    where: {
      id: input.pendingProjectMember.id
    }
  });

  return updatedProjectMember;
}

export async function claimPendingMembershipsForUserInTransaction(
  tx: Prisma.TransactionClient,
  userId: string
): Promise<PendingMembershipClaim | null> {
  const user = await tx.user.findFirst({
    where: {
      id: userId,
      deletedAt: null
    },
    select: {
      id: true,
      email: true,
      name: true,
      avatarUrl: true
    }
  });

  if (!user) {
    return null;
  }

  const normalizedEmail = normalizeEmail(user.email);
  const now = new Date();
  const teamMembers = await tx.teamMember.findMany({
    where: {
      normalizedEmail,
      userId: null,
      team: {
        deletedAt: null
      }
    },
    select: {
      id: true,
      teamId: true,
      role: true,
      email: true
    }
  });

  if (teamMembers.length === 0) {
    return {
      user,
      teamMembers: [],
      projectMembers: []
    };
  }

  const claimedTeamMembers: PendingMembershipClaim["teamMembers"] = [];
  const claimedProjectMembers: PendingMembershipClaim["projectMembers"] = [];

  for (const teamMember of teamMembers) {
    const projectMembers = await tx.projectMember.findMany({
      where: {
        teamMemberId: teamMember.id,
        userId: null,
        project: {
          deletedAt: null
        }
      },
      select: {
        id: true,
        role: true,
        projectId: true,
        teamMemberId: true,
        project: {
          select: {
            teamId: true
          }
        }
      }
    });

    const existingTeamMember = await tx.teamMember.findFirst({
      where: {
        teamId: teamMember.teamId,
        userId: user.id
      },
      select: {
        id: true,
        role: true,
        claimedAt: true
      }
    });

    if (!existingTeamMember) {
      const claimedTeamMember = await tx.teamMember.update({
        where: {
          id: teamMember.id
        },
        data: {
          userId: user.id,
          email: user.email,
          claimedAt: now
        },
        select: {
          id: true,
          teamId: true,
          role: true,
          email: true
        }
      });

      await tx.projectMember.updateMany({
        where: {
          teamMemberId: teamMember.id,
          userId: null
        },
        data: {
          userId: user.id,
          claimedAt: now
        }
      });

      claimedTeamMembers.push({
        ...claimedTeamMember,
        email: teamMember.email
      });
      claimedProjectMembers.push(...projectMembers);
      continue;
    }

    const updatedProjectMembers = [];
    for (const projectMember of projectMembers) {
      updatedProjectMembers.push(
        await claimProjectMemberForExistingTeamMember(tx, {
          pendingProjectMember: projectMember,
          teamMemberId: existingTeamMember.id,
          user,
          claimedAt: now
        })
      );
    }

    await tx.teamMember.delete({
      where: {
        id: teamMember.id
      }
    });

    const claimedTeamMember = await tx.teamMember.update({
      where: {
        id: existingTeamMember.id
      },
      data: {
        role: mergeTeamRole(existingTeamMember.role, teamMember.role),
        email: user.email,
        normalizedEmail,
        claimedAt: existingTeamMember.claimedAt ?? now
      },
      select: {
        id: true,
        teamId: true,
        role: true,
        email: true
      }
    });

    claimedTeamMembers.push({
      ...claimedTeamMember,
      email: teamMember.email
    });
    claimedProjectMembers.push(...updatedProjectMembers);
  }

  return {
    user,
    teamMembers: claimedTeamMembers,
    projectMembers: claimedProjectMembers
  };
}

export async function publishMembershipClaimSideEffects(claim: PendingMembershipClaim | null) {
  if (!claim || claim.teamMembers.length === 0) {
    return;
  }

  const { user, teamMembers, projectMembers } = claim;

  await Promise.all([
    ...teamMembers.map((member) =>
      createActivityLog({
        actorId: user.id,
        teamId: member.teamId,
        action: "team_member.claimed",
        targetType: "team_member",
        targetId: member.id,
        metadata: {
          email: user.email,
          previousEmail: member.email,
          role: member.role
        }
      })
    ),
    ...projectMembers.map((member) =>
      createActivityLog({
        actorId: user.id,
        teamId: member.project.teamId,
        projectId: member.projectId,
        action: "project_member.claimed",
        targetType: "project_member",
        targetId: member.id,
        metadata: {
          email: user.email,
          role: member.role
        }
      })
    )
  ]);

  await Promise.all([
    ...[...new Set(teamMembers.map((member) => member.teamId))].map((teamId) =>
      publishTeamEvent(teamId, { type: "team.changed", teamId })
    ),
    ...[...new Set(projectMembers.map((member) => member.projectId))].map((projectId) => {
      const teamId = projectMembers.find((member) => member.projectId === projectId)?.project.teamId;
      return publishProjectEvent(projectId, {
        type: "project.changed",
        projectId,
        teamId: teamId ?? ""
      });
    }),
    publishToUser(user.id, { type: "team.changed", teamId: teamMembers[0].teamId })
  ]);
}

export async function claimPendingMembershipsForUser(userId: string) {
  const claim = await prisma.$transaction((tx) => claimPendingMembershipsForUserInTransaction(tx, userId));
  await publishMembershipClaimSideEffects(claim);
}
