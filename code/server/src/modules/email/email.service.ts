import nodemailer from "nodemailer";
import { AccountTokenType } from "@prisma/client";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { prisma } from "../../lib/prisma.js";

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
