import nodemailer from "nodemailer";
import { AccountTokenType } from "@prisma/client";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../middleware/error-handler.js";
import { requireSystemAdmin } from "../system/system.policy.js";
import type { EmailOutboxQuery } from "./email.schema.js";

type EmailOutboxInput = {
  type: AccountTokenType;
  toEmail: string;
  subject: string;
  body: string;
  actionPath: string;
  userId: string;
};

type MailTransport = ReturnType<typeof nodemailer.createTransport>;

let transport: MailTransport | null = null;

export function isEmailDeliveryConfigured() {
  return Boolean(env.SMTP_HOST && env.MAIL_FROM && !env.EMAIL_DELIVERY_DISABLED);
}

export function getDevelopmentEmailActionPath(actionPath: string) {
  return env.NODE_ENV !== "production" && !isEmailDeliveryConfigured() ? actionPath : null;
}

function buildActionUrl(actionPath: string) {
  return new URL(actionPath, env.APP_BASE_URL).toString();
}

function buildEmailText(body: string, actionPath: string) {
  return `${body}\n\n${buildActionUrl(actionPath)}\n\n如果你没有发起这个操作，可以忽略这封邮件。`;
}

function buildEmailHtml(body: string, actionPath: string) {
  const actionUrl = buildActionUrl(actionPath);

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.6;color:#0f172a;">
      <p>${body}</p>
      <p>
        <a href="${actionUrl}" style="display:inline-block;border-radius:8px;background:#2563eb;color:#ffffff;padding:10px 14px;text-decoration:none;font-weight:700;">
          打开链接
        </a>
      </p>
      <p style="color:#64748b;font-size:13px;">如果按钮无法打开，请复制下面的链接到浏览器：</p>
      <p style="word-break:break-all;color:#334155;font-size:13px;">${actionUrl}</p>
      <p style="color:#64748b;font-size:13px;">如果你没有发起这个操作，可以忽略这封邮件。</p>
    </div>
  `;
}

function getTransport() {
  if (!isEmailDeliveryConfigured()) {
    return null;
  }

  if (!transport) {
    transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT ?? 465,
      secure: env.SMTP_SECURE ?? (env.SMTP_PORT ?? 465) === 465,
      auth:
        env.SMTP_USER && env.SMTP_PASSWORD
          ? {
              user: env.SMTP_USER,
              pass: env.SMTP_PASSWORD
            }
          : undefined
    });
  }

  return transport;
}

function toPublicEmailOutboxItem(item: {
  id: string;
  type: AccountTokenType;
  toEmail: string;
  subject: string;
  createdAt: Date;
  sentAt: Date | null;
  lastError: string | null;
  user: {
    id: string;
    name: string;
    email: string;
  };
}) {
  return {
    id: item.id,
    type: item.type,
    toEmail: item.toEmail,
    subject: item.subject,
    status: item.sentAt ? "SENT" : item.lastError ? "FAILED" : "PENDING",
    createdAt: item.createdAt,
    sentAt: item.sentAt,
    lastError: item.lastError,
    user: item.user
  };
}

async function sendOutboxItem(input: EmailOutboxInput & { id: string }) {
  const mailTransport = getTransport();

  if (!mailTransport) {
    return;
  }

  try {
    await mailTransport.sendMail({
      from: env.MAIL_FROM,
      to: input.toEmail,
      subject: input.subject,
      text: buildEmailText(input.body, input.actionPath),
      html: buildEmailHtml(input.body, input.actionPath)
    });

    await prisma.emailOutbox.update({
      where: {
        id: input.id
      },
      data: {
        sentAt: new Date(),
        lastError: null
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown email delivery error";
    await prisma.emailOutbox.update({
      where: {
        id: input.id
      },
      data: {
        lastError: message
      }
    });
    logger.error({ err: error, emailOutboxId: input.id, toEmail: input.toEmail }, "Email delivery failed");
  }
}

export async function queueAccountEmail(input: EmailOutboxInput) {
  const outboxItem = await prisma.emailOutbox.create({
    data: input
  });

  await sendOutboxItem({
    ...input,
    id: outboxItem.id
  });

  return outboxItem;
}

export async function listEmailOutbox(userId: string, input: EmailOutboxQuery) {
  await requireSystemAdmin(userId);

  const items = await prisma.emailOutbox.findMany({
    where: {
      type: input.type,
      ...(input.status === "SENT"
        ? {
            sentAt: {
              not: null
            }
          }
        : {}),
      ...(input.status === "FAILED"
        ? {
            sentAt: null,
            lastError: {
              not: null
            }
          }
        : {}),
      ...(input.status === "PENDING"
        ? {
            sentAt: null,
            lastError: null
          }
        : {})
    },
    orderBy: {
      createdAt: "desc"
    },
    take: input.limit,
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true
        }
      }
    }
  });

  return items.map(toPublicEmailOutboxItem);
}

export async function retryEmailOutboxItem(userId: string, emailOutboxId: string) {
  await requireSystemAdmin(userId);

  if (!isEmailDeliveryConfigured()) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "Email delivery is not configured", 422);
  }

  const item = await prisma.emailOutbox.findUnique({
    where: {
      id: emailOutboxId
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true
        }
      }
    }
  });

  if (!item) {
    throw new AppError("RESOURCE_NOT_FOUND", "Email outbox item not found", 404);
  }

  if (item.sentAt) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "Email outbox item has already been sent", 422);
  }

  await sendOutboxItem({
    id: item.id,
    type: item.type,
    toEmail: item.toEmail,
    subject: item.subject,
    body: item.body,
    actionPath: item.actionPath,
    userId: item.userId
  });

  const updatedItem = await prisma.emailOutbox.findUniqueOrThrow({
    where: {
      id: item.id
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true
        }
      }
    }
  });

  return toPublicEmailOutboxItem(updatedItem);
}
