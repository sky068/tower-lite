import { DeliveryChannel, DeliveryStatus, NotificationType, Prisma } from "@prisma/client";
import { logger } from "../../config/logger.js";
import { prisma } from "../../lib/prisma.js";
import { publishToUser } from "../realtime/realtime.service.js";

type CreateNotificationInput = {
  type: NotificationType;
  recipientId: string;
  title: string;
  content: string;
  dedupeKey: string;
  actorId?: string | null;
  teamId?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  link?: string | null;
  payload?: Prisma.InputJsonValue;
  skipActor?: boolean;
};

export async function createNotification(input: CreateNotificationInput) {
  if (input.skipActor && input.actorId && input.recipientId === input.actorId) {
    return null;
  }

  const recipient = await prisma.user.findFirst({
    where: {
      id: input.recipientId,
      deletedAt: null
    },
    select: {
      feishuOpenId: true
    }
  });

  if (!recipient) {
    return null;
  }

  const deliveries = [
    {
      channel: DeliveryChannel.IN_APP,
      status: DeliveryStatus.SENT,
      sentAt: new Date()
    },
    ...(recipient.feishuOpenId
      ? [
          {
            channel: DeliveryChannel.FEISHU,
            status: DeliveryStatus.PENDING
          }
        ]
      : [])
  ];

  try {
    const notification = await prisma.notification.upsert({
      where: {
        dedupeKey: input.dedupeKey
      },
      update: {},
      create: {
        type: input.type,
        title: input.title,
        content: input.content,
        link: input.link ?? (input.taskId ? `/tasks/${input.taskId}` : null),
        payload: input.payload,
        recipientId: input.recipientId,
        actorId: input.actorId ?? null,
        teamId: input.teamId ?? null,
        projectId: input.projectId ?? null,
        taskId: input.taskId ?? null,
        dedupeKey: input.dedupeKey,
        deliveries: {
          create: deliveries
        }
      }
    });

    publishToUser(input.recipientId, { type: "notification.changed" });
    return notification;
  } catch (error) {
    logger.error(
      {
        err: error,
        type: input.type,
        recipientId: input.recipientId,
        taskId: input.taskId
      },
      "Failed to create notification"
    );
    return null;
  }
}
