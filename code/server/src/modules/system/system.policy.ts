import { SystemRole } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../middleware/error-handler.js";

export async function isSystemAdmin(userId: string) {
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      deletedAt: null
    },
    select: {
      systemRole: true
    }
  });

  return user?.systemRole === SystemRole.ADMIN;
}

export async function requireSystemAdmin(userId: string) {
  if (!(await isSystemAdmin(userId))) {
    throw new AppError("FORBIDDEN", "System admin permission is required", 403);
  }
}
