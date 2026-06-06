import { DeliveryChannel, NotificationType } from "@prisma/client";
import { logger } from "../config/logger.js";
import { prisma } from "../lib/prisma.js";

const DUE_REMINDER_INTERVAL_MS = 10 * 60 * 1000;

export async function runDueReminderScan() {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const tasks = await prisma.task.findMany({
    where: {
      deletedAt: null,
      completedAt: null,
      assigneeId: {
        not: null
      },
      dueDate: {
        gt: now,
        lte: tomorrow
      }
    },
    include: {
      project: true
    }
  });

  await Promise.all(
    tasks.map((task) =>
      prisma.notification.upsert({
        where: {
          dedupeKey: `task_due_soon:${task.id}:${task.dueDate?.toISOString()}`
        },
        update: {},
        create: {
          type: NotificationType.TASK_DUE_SOON,
          title: "任务即将到期",
          content: `${task.project.name} / ${task.title}`,
          link: `/tasks/${task.id}`,
          recipientId: task.assigneeId!,
          projectId: task.projectId,
          taskId: task.id,
          dedupeKey: `task_due_soon:${task.id}:${task.dueDate?.toISOString()}`,
          deliveries: {
            create: {
              channel: DeliveryChannel.IN_APP,
              status: "SENT",
              sentAt: now
            }
          }
        }
      })
    )
  );

  if (tasks.length > 0) {
    logger.info({ count: tasks.length }, "Created due soon notifications");
  }
}

export function startDueReminderWorker() {
  const timer = setInterval(() => {
    void runDueReminderScan().catch((error) => {
      logger.error({ err: error }, "Due reminder scan failed");
    });
  }, DUE_REMINDER_INTERVAL_MS);

  timer.unref();
}
