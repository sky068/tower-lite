import { ProjectRole, TeamRole } from "@prisma/client";
import bcrypt from "bcryptjs";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../middleware/error-handler.js";
import { publishProjectEvent, publishTeamEvent, publishToUser } from "../realtime/realtime.service.js";
import { requireProjectManager } from "../projects/project.policy.js";
import { requireSystemAdmin } from "./system.policy.js";

const DEFAULT_TEAM_KEY = "defaultTeamId";
const DEFAULT_PROJECT_KEY = "defaultProjectId";

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

export async function getSystemDefaults() {
  const settings = await prisma.systemSetting.findMany({
    where: {
      key: {
        in: [DEFAULT_TEAM_KEY, DEFAULT_PROJECT_KEY]
      }
    }
  });
  const settingMap = new Map(settings.map((setting) => [setting.key, setting.value]));

  return {
    defaultTeamId: settingMap.get(DEFAULT_TEAM_KEY) ?? null,
    defaultProjectId: settingMap.get(DEFAULT_PROJECT_KEY) ?? null
  };
}

async function setSystemSetting(userId: string, key: string, value: string | null) {
  await prisma.systemSetting.upsert({
    where: {
      key
    },
    update: {
      value,
      updatedById: userId
    },
    create: {
      key,
      value,
      updatedById: userId
    }
  });
}

export async function setDefaultTeam(userId: string, teamId: string) {
  await requireSystemAdmin(userId);
  const team = await prisma.team.findFirst({
    where: {
      id: teamId,
      deletedAt: null
    }
  });

  if (!team) {
    throw new AppError("RESOURCE_NOT_FOUND", "Team not found", 404);
  }

  await setSystemSetting(userId, DEFAULT_TEAM_KEY, teamId);
  await publishTeamEvent(teamId, { type: "team.changed", teamId });
  return getSystemDefaults();
}

export async function clearDefaultTeam(userId: string, teamId: string) {
  await requireSystemAdmin(userId);
  const defaults = await getSystemDefaults();

  if (defaults.defaultTeamId === teamId) {
    await setSystemSetting(userId, DEFAULT_TEAM_KEY, null);
    await setSystemSetting(userId, DEFAULT_PROJECT_KEY, null);
    await publishTeamEvent(teamId, { type: "team.changed", teamId });
  }

  return getSystemDefaults();
}

export async function setDefaultProject(userId: string, projectId: string) {
  await requireProjectManager(userId, projectId);
  await requireSystemAdmin(userId);
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      deletedAt: null,
      status: "ACTIVE"
    }
  });

  if (!project) {
    throw new AppError("RESOURCE_NOT_FOUND", "Project not found", 404);
  }

  await setSystemSetting(userId, DEFAULT_TEAM_KEY, project.teamId);
  await setSystemSetting(userId, DEFAULT_PROJECT_KEY, projectId);
  await publishProjectEvent(projectId, { type: "project.changed", teamId: project.teamId, projectId });
  return getSystemDefaults();
}

export async function clearDefaultProject(userId: string, projectId: string) {
  await requireProjectManager(userId, projectId);
  await requireSystemAdmin(userId);
  const defaults = await getSystemDefaults();

  if (defaults.defaultProjectId === projectId) {
    await setSystemSetting(userId, DEFAULT_PROJECT_KEY, null);
    const project = await prisma.project.findUnique({
      where: {
        id: projectId
      },
      select: {
        teamId: true
      }
    });

    if (project) {
      await publishProjectEvent(projectId, { type: "project.changed", teamId: project.teamId, projectId });
    }
  }

  return getSystemDefaults();
}

export async function clearDeletedDefaultProject(userId: string, projectId: string, teamId: string) {
  const defaults = await getSystemDefaults();

  if (defaults.defaultProjectId === projectId) {
    await setSystemSetting(userId, DEFAULT_PROJECT_KEY, null);
    await publishProjectEvent(projectId, { type: "project.changed", teamId, projectId });
  }
}

export async function clearDeletedDefaultTeam(userId: string, teamId: string) {
  const defaults = await getSystemDefaults();

  if (defaults.defaultTeamId === teamId) {
    await setSystemSetting(userId, DEFAULT_TEAM_KEY, null);
    await setSystemSetting(userId, DEFAULT_PROJECT_KEY, null);
  }
}

export async function applyDefaultMemberships(userId: string) {
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      deletedAt: null
    },
    select: {
      systemRole: true
    }
  });

  if (!user || user.systemRole === "ADMIN") {
    return;
  }

  const defaults = await getSystemDefaults();

  if (!defaults.defaultTeamId) {
    return;
  }

  const team = await prisma.team.findFirst({
    where: {
      id: defaults.defaultTeamId,
      deletedAt: null
    }
  });

  if (!team) {
    return;
  }

  await prisma.teamMember.createMany({
    data: [
      {
        userId,
        teamId: team.id,
        role: TeamRole.MEMBER
      }
    ],
    skipDuplicates: true
  });

  if (defaults.defaultProjectId) {
    const project = await prisma.project.findFirst({
      where: {
        id: defaults.defaultProjectId,
        teamId: team.id,
        status: "ACTIVE",
        deletedAt: null
      }
    });

    if (project) {
      await prisma.projectMember.createMany({
        data: [
          {
            userId,
            projectId: project.id,
            role: ProjectRole.EDITOR
          }
        ],
        skipDuplicates: true
      });
      await publishProjectEvent(project.id, { type: "project.changed", teamId: team.id, projectId: project.id });
    }
  }

  await publishToUser(userId, { type: "team.changed", teamId: team.id });
}
