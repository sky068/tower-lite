import { Queue, Worker } from "bullmq";
import { NotificationType } from "@prisma/client";
import { logger } from "../config/logger.js";
import { createQueueConnection, type QueueWorkerHandle } from "../lib/queue.js";
import { prisma } from "../lib/prisma.js";
import { createNotification } from "../modules/notifications/notification.service.js";

const DUE_REMINDER_INTERVAL_MS = 10 * 60 * 1000;
const DUE_REMINDER_QUEUE_NAME = "tower-due-reminders";

export async function runDueReminderScan() {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const assignedRows = await prisma.$queryRaw<Array<{ taskId: string; userId: string }>>`
    SELECT ta."taskId", pm."userId"
    FROM "TaskAssignee" ta
    JOIN "ProjectMember" pm ON pm."id" = ta."projectMemberId"
    JOIN "TeamMember" tm ON tm."id" = pm."teamMemberId"
    WHERE pm."userId" IS NOT NULL
      AND tm."userId" IS NOT NULL
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

      return recipientIds.map(async (recipientId) => {
        await createNotification({
          type: NotificationType.TASK_DUE_SOON,
          title: "任务即将到期",
          content: `${task.project.name} / ${task.title}`,
          link: `/tasks/${task.id}`,
          recipientId,
          projectId: task.projectId,
          taskId: task.id,
          dedupeKey: `task_due_soon:${task.id}:${recipientId}:${task.dueDate?.toISOString()}`
        });
      });
    })
  );

  if (tasks.length > 0) {
    logger.info({ count: tasks.length }, "Created due soon notifications");
  }
}

export async function startDueReminderWorker(): Promise<QueueWorkerHandle> {
  const connection = createQueueConnection();
  const queue = new Queue(DUE_REMINDER_QUEUE_NAME, { connection });
  const worker = new Worker(
    DUE_REMINDER_QUEUE_NAME,
    async () => {
      await runDueReminderScan();
    },
    {
      connection,
      concurrency: 1
    }
  );

  worker.on("failed", (job, error) => {
    logger.error({ err: error, jobId: job?.id }, "Due reminder scan failed");
  });
  worker.on("error", (error) => {
    logger.error({ err: error }, "Due reminder BullMQ worker error");
  });
  queue.on("error", (error) => {
    logger.error({ err: error }, "Due reminder BullMQ queue error");
  });

  try {
    await queue.upsertJobScheduler(
      "due-reminder-scan",
      {
        every: DUE_REMINDER_INTERVAL_MS
      },
      {
        name: "scan",
        data: {},
        opts: {
          removeOnComplete: 20,
          removeOnFail: 100
        }
      }
    );
  } catch (error) {
    await Promise.allSettled([worker.close(), queue.close()]);
    throw error;
  }

  logger.info({ intervalMs: DUE_REMINDER_INTERVAL_MS }, "Due reminder BullMQ worker started");

  return {
    async close() {
      await worker.close();
      await queue.close();
    }
  };
}
