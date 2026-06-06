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
  const tasks = await prisma.task.findMany({
    where: {
      assigneeId: userId,
      deletedAt: null,
      parentId: null
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
