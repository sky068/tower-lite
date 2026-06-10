import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../middleware/error-handler.js";
import type { BindFeishuInput, UpdateEmailInput, UpdatePasswordInput, UpdateProfileInput } from "./user.schema.js";

function toPublicUser(user: { id: string; email: string; name: string; avatarUrl: string | null }) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl
  };
}

function toCurrentUser(user: {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  feishuOpenId: string | null;
  feishuUnionId: string | null;
}) {
  return {
    ...toPublicUser(user),
    feishuBound: Boolean(user.feishuOpenId || user.feishuUnionId),
    feishuOpenId: user.feishuOpenId,
    feishuUnionId: user.feishuUnionId
  };
}

export async function getCurrentUser(userId: string) {
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      deletedAt: null
    }
  });

  if (!user) {
    throw new AppError("RESOURCE_NOT_FOUND", "User not found", 404);
  }

  return toCurrentUser(user);
}

export async function updateProfile(userId: string, input: UpdateProfileInput) {
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      deletedAt: null
    }
  });

  if (!user) {
    throw new AppError("RESOURCE_NOT_FOUND", "User not found", 404);
  }

  const updatedUser = await prisma.user.update({
    where: {
      id: userId
    },
    data: {
      name: input.name,
      avatarUrl: input.avatarUrl === undefined ? user.avatarUrl : input.avatarUrl
    }
  });

  return toCurrentUser(updatedUser);
}

export async function updateEmail(userId: string, input: UpdateEmailInput) {
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      deletedAt: null
    }
  });

  if (!user) {
    throw new AppError("RESOURCE_NOT_FOUND", "User not found", 404);
  }

  if (user.email === input.email) {
    return toCurrentUser(user);
  }

  const existingUser = await prisma.user.findUnique({
    where: {
      email: input.email
    }
  });

  if (existingUser) {
    throw new AppError("CONFLICT", "Email is already registered", 409);
  }

  const updatedUser = await prisma.user.update({
    where: {
      id: userId
    },
    data: {
      email: input.email
    }
  });

  return toCurrentUser(updatedUser);
}

export async function updatePassword(userId: string, input: UpdatePasswordInput) {
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      deletedAt: null
    }
  });

  if (!user?.passwordHash) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "Password login is not enabled for this account", 422);
  }

  const isValidPassword = await bcrypt.compare(input.currentPassword, user.passwordHash);

  if (!isValidPassword) {
    throw new AppError("UNAUTHORIZED", "Current password is incorrect", 401);
  }

  const passwordHash = await bcrypt.hash(input.newPassword, 12);

  await prisma.user.update({
    where: {
      id: userId
    },
    data: {
      passwordHash
    }
  });

  return { ok: true };
}

export async function bindFeishuAccount(userId: string, input: BindFeishuInput) {
  try {
    const updatedUser = await prisma.user.update({
      where: {
        id: userId
      },
      data: {
        feishuOpenId: input.openId,
        feishuUnionId: input.unionId ?? null
      }
    });

    return toCurrentUser(updatedUser);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("CONFLICT", "这个飞书账号已绑定到其他用户。", 409);
    }

    throw error;
  }
}

export async function unbindFeishuAccount(userId: string) {
  const updatedUser = await prisma.user.update({
    where: {
      id: userId
    },
    data: {
      feishuOpenId: null,
      feishuUnionId: null
    }
  });

  return toCurrentUser(updatedUser);
}

export async function listMyTasks(userId: string) {
  const assignedRows = await prisma.$queryRaw<Array<{ taskId: string }>>`
    SELECT DISTINCT ta."taskId"
    FROM "TaskAssignee" ta
    JOIN "Task" task ON task."id" = ta."taskId"
    JOIN "Project" project ON project."id" = task."projectId"
    JOIN "TeamMember" team_member
      ON team_member."teamId" = project."teamId"
      AND team_member."userId" = ${userId}
    LEFT JOIN "ProjectMember" project_member
      ON project_member."projectId" = project."id"
      AND project_member."userId" = ${userId}
    WHERE ta."userId" = ${userId}
      AND task."deletedAt" IS NULL
      AND project."deletedAt" IS NULL
      AND (
        team_member."role" IN ('OWNER', 'ADMIN')
        OR project_member."id" IS NOT NULL
      )
  `;
  const assignedTaskIds = assignedRows.map((row) => row.taskId);

  const assignedTasks = await prisma.task.findMany({
    where: {
      deletedAt: null,
      id: {
        in: assignedTaskIds
      }
    },
    include: {
      project: true,
      taskList: true,
      completedBy: true,
      parent: {
        select: {
          id: true,
          title: true
        }
      }
    },
    orderBy: [
      {
        dueDate: "asc"
      },
      {
      createdAt: "desc"
      }
    ]
  });
  const assignedTaskIdSet = new Set(assignedTaskIds);
  const missingParentIds = [
    ...new Set(
      assignedTasks
        .map((task) => task.parentId)
        .filter((parentId): parentId is string => parentId !== null)
        .filter((parentId) => !assignedTaskIdSet.has(parentId))
    )
  ];
  const contextParentTasks = missingParentIds.length > 0
    ? await prisma.task.findMany({
        where: {
          id: {
            in: missingParentIds
          },
          deletedAt: null
        },
        include: {
          project: true,
          taskList: true,
          completedBy: true,
          parent: {
            select: {
              id: true,
              title: true
            }
          }
        }
      })
    : [];
  const tasks = [...assignedTasks, ...contextParentTasks];

  return tasks.map((task) => ({
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate,
    completedAt: task.completedAt,
    completedBy: task.completedBy
      ? {
          id: task.completedBy.id,
          name: task.completedBy.name,
          avatarUrl: task.completedBy.avatarUrl
        }
      : null,
    parentId: task.parentId,
    isAssignedToMe: assignedTaskIdSet.has(task.id),
    parentTask: task.parent
      ? {
          id: task.parent.id,
          title: task.parent.title
        }
      : null,
    project: {
      id: task.project.id,
      name: task.project.name
    },
    taskList: {
      id: task.taskList.id,
      name: task.taskList.name
    }
  }));
}

export async function listNotifications(userId: string) {
  const notifications = await prisma.notification.findMany({
    where: {
      recipientId: userId
    },
    orderBy: {
      createdAt: "desc"
    },
    take: 50
  });

  return notifications.map((notification) => ({
    id: notification.id,
    type: notification.type,
    title: notification.title,
    content: notification.content,
    link: notification.link,
    isRead: notification.isRead,
    readAt: notification.readAt,
    createdAt: notification.createdAt
  }));
}

export async function markNotificationRead(userId: string, notificationId: string) {
  const notification = await prisma.notification.findFirst({
    where: {
      id: notificationId,
      recipientId: userId
    }
  });

  if (!notification) {
    throw new AppError("RESOURCE_NOT_FOUND", "Notification not found", 404);
  }

  const updatedNotification = await prisma.notification.update({
    where: {
      id: notificationId
    },
    data: {
      isRead: true,
      readAt: new Date()
    }
  });

  return {
    id: updatedNotification.id,
    isRead: updatedNotification.isRead,
    readAt: updatedNotification.readAt
  };
}

export async function markAllNotificationsRead(userId: string) {
  await prisma.notification.updateMany({
    where: {
      recipientId: userId,
      isRead: false
    },
    data: {
      isRead: true,
      readAt: new Date()
    }
  });

  return { ok: true };
}
