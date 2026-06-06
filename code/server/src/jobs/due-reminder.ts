import { DeliveryChannel, NotificationType } from "@prisma/client";
import { logger } from "../config/logger.js";
import { prisma } from "../lib/prisma.js";

const DUE_REMINDER_INTERVAL_MS = 10 * 60 * 1000;

export async function runDueReminderScan() {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const assignedRows = await prisma.$queryRaw<Array<{ taskId: string; userId: string }>>`
    SELECT ta."taskId", ta."userId"
    FROM "TaskAssignee" ta
    JOIN "Task" task ON task."id" = ta."taskId"
    JOIN "ProjectMember" pm
      ON pm."projectId" = task."projectId"
      AND pm."userId" = ta."userId"
  `;
  const assignedTaskIds = [...new Set(assignedRows.map((row) => row.taskId))];
  const assigneeMap = new Map<string, string[]>();

  for (const row of assignedRows) {
    const items = assigneeMap.get(row.taskId) ?? [];
    items.push(row.userId);
    assigneeMap.set(row.taskId, items);
  }

  const tasks = await prisma.task.findMany({
    where: {
      deletedAt: null,
      completedAt: null,
      project: {
        status: "ACTIVE",
        deletedAt: null
      },
      OR: [
        {
          id: {
            in: assignedTaskIds
          }
        }
      ],
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
    tasks.flatMap((task) => {
      const recipientIds = [
        ...new Set(assigneeMap.get(task.id) ?? [])
      ] as string[];

      return recipientIds.map((recipientId) =>
        prisma.notification.upsert({
          where: {
            dedupeKey: `task_due_soon:${task.id}:${recipientId}:${task.dueDate?.toISOString()}`
          },
          update: {},
          create: {
            type: NotificationType.TASK_DUE_SOON,
            title: "任务即将到期",
            content: `${task.project.name} / ${task.title}`,
            link: `/tasks/${task.id}`,
            recipientId,
            projectId: task.projectId,
            taskId: task.id,
            dedupeKey: `task_due_soon:${task.id}:${recipientId}:${task.dueDate?.toISOString()}`,
            deliveries: {
              create: {
                channel: DeliveryChannel.IN_APP,
                status: "SENT",
                sentAt: now
              }
            }
          }
        })
      );
    })
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
