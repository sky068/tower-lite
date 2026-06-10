import { DeliveryChannel, DeliveryStatus } from "@prisma/client";
import crypto from "node:crypto";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../middleware/error-handler.js";
import { createActivityLog } from "../activity/activity.service.js";
import { requireProjectManager } from "../projects/project.policy.js";
import type { ClearFeishuDeliveriesInput, FeishuWebhookInput } from "./feishu.schema.js";

const FEISHU_DELIVERY_INTERVAL_MS = 60 * 1000;
const FEISHU_DELIVERY_BATCH_SIZE = 20;
const FEISHU_DELIVERY_MAX_ATTEMPTS = 3;
const FEISHU_API_ORIGIN = "https://open.feishu.cn";

let cachedTenantAccessToken: {
  token: string;
  expiresAt: number;
} | null = null;

type DecodedFeishuWebhook = {
  challenge?: string;
  token?: string;
  type?: string;
  schema?: string;
  header?: {
    event_id?: string;
    event_type?: string;
    token?: string;
    app_id?: string;
    tenant_key?: string;
  };
  event?: unknown;
};

function isFeishuConfigured() {
  return Boolean(env.FEISHU_APP_ID && env.FEISHU_APP_SECRET);
}

function parseDateRange(input: Pick<ClearFeishuDeliveriesInput, "startDate" | "endDate">) {
  const start = new Date(`${input.startDate}T00:00:00.000Z`);
  const exclusiveEnd = new Date(`${input.endDate}T00:00:00.000Z`);
  exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);

  return {
    start,
    exclusiveEnd
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function decryptFeishuPayload(encrypt: string) {
  if (!env.FEISHU_ENCRYPT_KEY) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "Feishu encrypt key is not configured", 422);
  }

  try {
    const key = crypto.createHash("sha256").update(env.FEISHU_ENCRYPT_KEY).digest();
    const encryptedBuffer = Buffer.from(encrypt, "base64");
    const iv = encryptedBuffer.subarray(0, 16);
    const encryptedContent = encryptedBuffer.subarray(16);
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    const decrypted = Buffer.concat([decipher.update(encryptedContent), decipher.final()]).toString("utf8");
    return JSON.parse(decrypted) as FeishuWebhookInput;
  } catch (error) {
    logger.warn({ err: error }, "Failed to decrypt Feishu webhook payload");
    throw new AppError("UNAUTHORIZED", "Invalid Feishu encrypted payload", 401);
  }
}

function decodeFeishuWebhook(input: FeishuWebhookInput): DecodedFeishuWebhook {
  const encrypted = typeof input.encrypt === "string" ? input.encrypt : null;

  if (!encrypted) {
    return input as DecodedFeishuWebhook;
  }

  return decryptFeishuPayload(encrypted) as DecodedFeishuWebhook;
}

function verifyFeishuToken(payload: DecodedFeishuWebhook) {
  if (!env.FEISHU_VERIFICATION_TOKEN) {
    return;
  }

  const token = payload.header?.token ?? payload.token;

  if (token !== env.FEISHU_VERIFICATION_TOKEN) {
    throw new AppError("UNAUTHORIZED", "Invalid Feishu verification token", 401);
  }
}

function buildFeishuEventIdentity(payload: DecodedFeishuWebhook) {
  const eventId = payload.header?.event_id;
  const eventType = payload.header?.event_type ?? payload.type ?? "unknown";

  if (eventId) {
    return {
      eventId,
      eventType
    };
  }

  const eventPayload = JSON.stringify(payload);
  return {
    eventId: crypto.createHash("sha256").update(eventPayload).digest("hex"),
    eventType
  };
}

function buildNotificationCard(notification: {
  title: string;
  content: string;
  link: string | null;
}) {
  const elements: Array<Record<string, unknown>> = [
    {
      tag: "div",
      text: {
        tag: "lark_md",
        content: notification.content
      }
    }
  ];

  if (notification.link) {
    elements.push({
      tag: "action",
      actions: [
        {
          tag: "button",
          text: {
            tag: "plain_text",
            content: "查看详情"
          },
          type: "primary",
          url: `${env.APP_BASE_URL}${notification.link}`
        }
      ]
    });
  }

  return {
    config: {
      wide_screen_mode: true
    },
    header: {
      template: "blue",
      title: {
        tag: "plain_text",
        content: notification.title
      }
    },
    elements
  };
}

function normalizeFeishuApiError(message: string | undefined, fallback: string) {
  if (!message) {
    return fallback;
  }

  if (
    message.includes("Access denied") &&
    (message.includes("im:message:send") ||
      message.includes("im:message") ||
      message.includes("im:message:send_as_bot"))
  ) {
    return "飞书应用缺少机器人发消息权限，请在飞书开放平台开通 im:message:send（或 im:message / im:message:send_as_bot）并发布生效。";
  }

  if (message.includes("Bot ability is not activated")) {
    return "飞书应用尚未启用机器人能力，请在飞书开放平台启用应用机器人后发布生效。";
  }

  return message;
}

async function getTenantAccessToken() {
  if (cachedTenantAccessToken && cachedTenantAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedTenantAccessToken.token;
  }

  const response = await fetch(`${FEISHU_API_ORIGIN}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      app_id: env.FEISHU_APP_ID,
      app_secret: env.FEISHU_APP_SECRET
    })
  });
  const data = await response.json() as {
    code?: number;
    msg?: string;
    tenant_access_token?: string;
    expire?: number;
  };

  if (!response.ok || data.code !== 0 || !data.tenant_access_token) {
    throw new Error(normalizeFeishuApiError(data.msg, `Feishu token request failed with ${response.status}`));
  }

  cachedTenantAccessToken = {
    token: data.tenant_access_token,
    expiresAt: Date.now() + Math.max(0, (data.expire ?? 7200) - 120) * 1000
  };

  return cachedTenantAccessToken.token;
}

async function sendFeishuCard(openId: string, notification: {
  title: string;
  content: string;
  link: string | null;
}) {
  const tenantAccessToken = await getTenantAccessToken();
  const response = await fetch(`${FEISHU_API_ORIGIN}/open-apis/im/v1/messages?receive_id_type=open_id`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${tenantAccessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      receive_id: openId,
      msg_type: "interactive",
      content: JSON.stringify(buildNotificationCard(notification))
    })
  });
  const data = await response.json() as {
    code?: number;
    msg?: string;
  };

  if (!response.ok || data.code !== 0) {
    throw new Error(normalizeFeishuApiError(data.msg, `Feishu message request failed with ${response.status}`));
  }
}

type FeishuDeliveryWithNotification = Awaited<ReturnType<typeof findFeishuDeliveryForSend>>;
type SerializableFeishuDelivery = {
  id: string;
  status: DeliveryStatus;
  attemptCount: number;
  lastError: string | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  notification: {
    id: string;
    type: string;
    title: string;
    content: string;
    link: string | null;
    taskId: string | null;
    payload: unknown;
    createdAt: Date;
    recipient: {
      id: string;
      name: string;
      email: string;
      avatarUrl: string | null;
      feishuOpenId: string | null;
    };
  };
};

async function findFeishuDeliveryForSend(deliveryId: string) {
  return prisma.notificationDelivery.findUnique({
    where: {
      id: deliveryId
    },
    include: {
      notification: {
        include: {
          recipient: true
        }
      }
    }
  });
}

async function sendDelivery(delivery: NonNullable<FeishuDeliveryWithNotification>) {
  const openId = delivery.notification.recipient.feishuOpenId;

  if (!openId) {
    return prisma.notificationDelivery.update({
      where: {
        id: delivery.id
      },
      data: {
        status: DeliveryStatus.SKIPPED,
        lastError: "Feishu account is not bound"
      }
    });
  }

  try {
    await sendFeishuCard(openId, delivery.notification);
    return prisma.notificationDelivery.update({
      where: {
        id: delivery.id
      },
      data: {
        status: DeliveryStatus.SENT,
        sentAt: new Date(),
        lastError: null,
        attemptCount: {
          increment: 1
        }
      }
    });
  } catch (error) {
    const attemptCount = delivery.attemptCount + 1;
    const updatedDelivery = await prisma.notificationDelivery.update({
      where: {
        id: delivery.id
      },
      data: {
        status: DeliveryStatus.FAILED,
        attemptCount,
        lastError: error instanceof Error ? error.message : "Unknown Feishu delivery error"
      }
    });
    logger.warn({ err: error, deliveryId: delivery.id, attemptCount }, "Feishu delivery failed");
    return updatedDelivery;
  }
}

function serializeFeishuDelivery(delivery: SerializableFeishuDelivery) {
  const payload = asRecord(delivery.notification.payload);

  return {
    id: delivery.id,
    status: delivery.status,
    attemptCount: delivery.attemptCount,
    lastError: delivery.lastError,
    sentAt: delivery.sentAt,
    createdAt: delivery.createdAt,
    updatedAt: delivery.updatedAt,
    notification: {
      id: delivery.notification.id,
      type: delivery.notification.type,
      title: delivery.notification.title,
      content: delivery.notification.content,
      link: delivery.notification.link,
      taskId: delivery.notification.taskId,
      payload,
      createdAt: delivery.notification.createdAt
    },
    recipient: {
      id: delivery.notification.recipient.id,
      name: delivery.notification.recipient.name,
      email: delivery.notification.recipient.email,
      avatarUrl: delivery.notification.recipient.avatarUrl,
      feishuBound: Boolean(delivery.notification.recipient.feishuOpenId)
    },
    canRetry: delivery.status !== DeliveryStatus.SENT
  };
}

export async function runFeishuDeliveryScan() {
  if (!isFeishuConfigured()) {
    return;
  }

  const deliveries = await prisma.notificationDelivery.findMany({
    where: {
      channel: DeliveryChannel.FEISHU,
      status: {
        in: [DeliveryStatus.PENDING, DeliveryStatus.FAILED]
      },
      attemptCount: {
        lt: FEISHU_DELIVERY_MAX_ATTEMPTS
      }
    },
    include: {
      notification: {
        include: {
          recipient: true
        }
      }
    },
    orderBy: {
      createdAt: "asc"
    },
    take: FEISHU_DELIVERY_BATCH_SIZE
  });

  for (const delivery of deliveries) {
    await sendDelivery(delivery);
  }
}

export function startFeishuDeliveryWorker() {
  if (!isFeishuConfigured()) {
    logger.info("Feishu delivery worker disabled because FEISHU_APP_ID or FEISHU_APP_SECRET is missing");
    return;
  }

  const timer = setInterval(() => {
    void runFeishuDeliveryScan().catch((error) => {
      logger.error({ err: error }, "Feishu delivery scan failed");
    });
  }, FEISHU_DELIVERY_INTERVAL_MS);

  timer.unref();
}

export async function handleFeishuWebhook(input: FeishuWebhookInput) {
  const payload = decodeFeishuWebhook(input);
  verifyFeishuToken(payload);

  if (payload.challenge) {
    return {
      challenge: payload.challenge
    };
  }

  const { eventId, eventType } = buildFeishuEventIdentity(payload);

  const existingEvent = await prisma.feishuEvent.findUnique({
    where: {
      eventId
    }
  });

  if (existingEvent) {
    return {
      ok: true,
      duplicate: true,
      eventId,
      eventType
    };
  }

  await prisma.feishuEvent.create({
    data: {
      eventId,
      eventType,
      payload: payload as object,
      status: "RECEIVED",
      processedAt: new Date()
    }
  });

  logger.info({ eventId, eventType }, "Received Feishu webhook event");

  return {
    ok: true,
    duplicate: false,
    eventId,
    eventType
  };
}

export async function listProjectFeishuDeliveries(userId: string, projectId: string) {
  await requireProjectManager(userId, projectId);

  const deliveries = await prisma.notificationDelivery.findMany({
    where: {
      channel: DeliveryChannel.FEISHU,
      notification: {
        projectId
      }
    },
    include: {
      notification: {
        include: {
          recipient: {
            select: {
              id: true,
              name: true,
              email: true,
              avatarUrl: true,
              feishuOpenId: true
            }
          }
        }
      }
    },
    orderBy: {
      updatedAt: "desc"
    },
    take: 100
  });

  return deliveries.map(serializeFeishuDelivery);
}

export async function retryProjectFeishuDelivery(userId: string, projectId: string, deliveryId: string) {
  await requireProjectManager(userId, projectId);

  if (!isFeishuConfigured()) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "Feishu notification is not configured", 422);
  }

  const delivery = await findFeishuDeliveryForSend(deliveryId);

  if (!delivery || delivery.channel !== DeliveryChannel.FEISHU || delivery.notification.projectId !== projectId) {
    throw new AppError("RESOURCE_NOT_FOUND", "Feishu delivery not found", 404);
  }

  if (delivery.status === DeliveryStatus.SENT) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "Feishu delivery has already been sent", 422);
  }

  const retryableDelivery = {
    ...delivery,
    attemptCount: 0
  };
  await prisma.notificationDelivery.update({
    where: {
      id: delivery.id
    },
    data: {
      status: DeliveryStatus.PENDING,
      attemptCount: 0,
      lastError: null
    }
  });

  await sendDelivery(retryableDelivery);

  const updatedDelivery = await findFeishuDeliveryForSend(deliveryId);

  if (!updatedDelivery) {
    throw new AppError("RESOURCE_NOT_FOUND", "Feishu delivery not found", 404);
  }

  return serializeFeishuDelivery(updatedDelivery);
}

export async function clearProjectFeishuDeliveries(
  userId: string,
  projectId: string,
  input: ClearFeishuDeliveriesInput
) {
  const { project } = await requireProjectManager(userId, projectId);
  const { start, exclusiveEnd } = parseDateRange(input);
  const allowedStatuses =
    input.status === "ALL" ? [DeliveryStatus.SENT, DeliveryStatus.FAILED, DeliveryStatus.SKIPPED] : [input.status];
  const result = await prisma.notificationDelivery.deleteMany({
    where: {
      channel: DeliveryChannel.FEISHU,
      status: {
        in: allowedStatuses
      },
      createdAt: {
        gte: start,
        lt: exclusiveEnd
      },
      notification: {
        projectId
      }
    }
  });

  await createActivityLog({
    actorId: userId,
    teamId: project.teamId,
    projectId,
    action: "feishu_delivery.cleared",
    targetType: "notification_delivery",
    targetId: null,
    metadata: {
      startDate: input.startDate,
      endDate: input.endDate,
      status: input.status,
      deletedCount: result.count
    }
  });

  return {
    deletedCount: result.count
  };
}
