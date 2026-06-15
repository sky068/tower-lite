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
      systemRole: true,
      emailVerifiedAt: true
    }
  });

  return user?.systemRole === SystemRole.ADMIN && Boolean(user.emailVerifiedAt);
}

export async function requireSystemAdmin(userId: string) {
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      deletedAt: null
    },
    select: {
      systemRole: true,
      emailVerifiedAt: true
    }
  });

  if (user?.systemRole === SystemRole.ADMIN && !user.emailVerifiedAt) {
    throw new AppError("FORBIDDEN", "System admin email must be verified", 403);
  }

  if (user?.systemRole !== SystemRole.ADMIN) {
    throw new AppError("FORBIDDEN", "System admin permission is required", 403);
  }
}
