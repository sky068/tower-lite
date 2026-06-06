import { TeamRole } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../middleware/error-handler.js";

export async function requireTeamMember(userId: string, teamId: string) {
  const member = await prisma.teamMember.findUnique({
    where: {
      userId_teamId: {
        userId,
        teamId
      }
    }
  });

  if (!member) {
    throw new AppError("FORBIDDEN", "You are not a member of this team", 403);
  }

  return member;
}

export async function requireTeamAdmin(userId: string, teamId: string) {
  const member = await requireTeamMember(userId, teamId);

  if (member.role !== TeamRole.OWNER && member.role !== TeamRole.ADMIN) {
    throw new AppError("FORBIDDEN", "Team admin permission is required", 403);
  }

  return member;
}
