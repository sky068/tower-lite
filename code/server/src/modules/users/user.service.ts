import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../middleware/error-handler.js";

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

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    feishuBound: Boolean(user.feishuOpenId || user.feishuUnionId)
  };
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

  const tasks = await prisma.task.findMany({
    where: {
      deletedAt: null,
      OR: [
        {
          id: {
            in: assignedTaskIds
          }
        }
      ]
    },
    include: {
      project: true,
      taskList: true
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

  return tasks.map((task) => ({
    id: task.id,
    title: task.title,
    priority: task.priority,
    dueDate: task.dueDate,
    completedAt: task.completedAt,
    parentId: task.parentId,
    project: {
      id: task.project.id,
      name: task.project.name
    },
    taskList: {
      id: task.taskList.id,
      name: task.taskList.name,
      type: task.taskList.type
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
