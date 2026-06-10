import { DeliveryChannel, DeliveryStatus } from "@prisma/client";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { prisma } from "../../lib/prisma.js";

const FEISHU_DELIVERY_INTERVAL_MS = 60 * 1000;
const FEISHU_DELIVERY_BATCH_SIZE = 20;
const FEISHU_DELIVERY_MAX_ATTEMPTS = 3;
const FEISHU_API_ORIGIN = "https://open.feishu.cn";

let cachedTenantAccessToken: {
  token: string;
  expiresAt: number;
} | null = null;

function isFeishuConfigured() {
  return Boolean(env.FEISHU_APP_ID && env.FEISHU_APP_SECRET);
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
    throw new Error(data.msg || `Feishu token request failed with ${response.status}`);
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
    throw new Error(data.msg || `Feishu message request failed with ${response.status}`);
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
