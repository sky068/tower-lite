import bcrypt from "bcryptjs";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { prisma } from "../../lib/prisma.js";

export async function ensureConfiguredSystemAdmin() {
  if (!env.DEFAULT_ADMIN_EMAIL || !env.DEFAULT_ADMIN_PASSWORD) {
    return;
  }

  const email = env.DEFAULT_ADMIN_EMAIL.trim().toLowerCase();
  const name = env.DEFAULT_ADMIN_NAME?.trim() || "系统管理员";
  const existingUser = await prisma.user.findUnique({
    where: {
      email
    }
  });

  if (existingUser) {
    if (existingUser.systemRole !== "ADMIN") {
      await prisma.user.update({
        where: {
          id: existingUser.id
        },
        data: {
          systemRole: "ADMIN"
        }
      });
    }
    return;
  }

  const passwordHash = await bcrypt.hash(env.DEFAULT_ADMIN_PASSWORD, 12);
  await prisma.user.create({
    data: {
      email,
      name,
      passwordHash,
      systemRole: "ADMIN"
    }
  });
  logger.info({ email }, "Default system admin created");
}
