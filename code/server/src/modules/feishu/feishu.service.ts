import { DeliveryChannel, DeliveryStatus } from "@prisma/client";
import crypto from "node:crypto";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../middleware/error-handler.js";
import { requireProjectManager } from "../projects/project.policy.js";
import type { FeishuWebhookInput } from "./feishu.schema.js";

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

function buildNotificationText(notification: {
  title: string;
  content: string;
  link: string | null;
}) {
  const lines = [notification.title, notification.content];

  if (notification.link) {
    lines.push(`${env.APP_BASE_URL}${notification.link}`);
  }

  return lines.join("\n");
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

async function sendFeishuText(openId: string, text: string) {
  const tenantAccessToken = await getTenantAccessToken();
  const response = await fetch(`${FEISHU_API_ORIGIN}/open-apis/im/v1/messages?receive_id_type=open_id`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${tenantAccessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      receive_id: openId,
      msg_type: "text",
      content: JSON.stringify({ text })
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
    const openId = delivery.notification.recipient.feishuOpenId;

    if (!openId) {
      await prisma.notificationDelivery.update({
        where: {
          id: delivery.id
        },
        data: {
          status: DeliveryStatus.SKIPPED,
          lastError: "Feishu account is not bound"
        }
      });
      continue;
    }

    try {
      await sendFeishuText(openId, buildNotificationText(delivery.notification));
      await prisma.notificationDelivery.update({
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
      await prisma.notificationDelivery.update({
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
    }
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

  return deliveries.map((delivery) => {
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
      }
    };
  });
}
