import { TeamRole } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../middleware/error-handler.js";
import { isSystemAdmin, requireSystemAdmin } from "../system/system.policy.js";

export async function requireTeamMember(userId: string, teamId: string) {
  if (await isSystemAdmin(userId)) {
    return null;
  }

  const member = await prisma.teamMember.findFirst({
    where: {
      userId,
      teamId,
      team: {
        deletedAt: null
      }
    }
  });

  if (!member) {
    throw new AppError("FORBIDDEN", "You are not a member of this team", 403);
  }

  return member;
}

export async function requireTeamAdmin(userId: string, teamId: string) {
  if (await isSystemAdmin(userId)) {
    return null;
  }

  const member = await requireTeamMember(userId, teamId);

  if (member?.role !== TeamRole.ADMIN) {
    throw new AppError("FORBIDDEN", "Team admin permission is required", 403);
  }

  return member;
}

export const requireTeamOwner = requireSystemAdmin;
