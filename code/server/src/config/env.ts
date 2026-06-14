import { config } from "dotenv";
import { resolve } from "node:path";
import { z } from "zod";

config();
config({ path: resolve(process.cwd(), "../.env") });

const booleanEnvSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off", ""].includes(normalized)) {
    return false;
  }

  return value;
}, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  JWT_ACCESS_SECRET: z.string().min(12),
  JWT_REFRESH_SECRET: z.string().min(12),
  APP_BASE_URL: z.string().url().default("http://localhost:5173"),
  DEFAULT_ADMIN_EMAIL: z.string().trim().email().optional(),
  DEFAULT_ADMIN_PASSWORD: z.string().min(8).optional(),
  DEFAULT_ADMIN_NAME: z.string().trim().min(1).optional(),
  FEISHU_APP_ID: z.string().optional(),
  FEISHU_APP_SECRET: z.string().optional(),
  FEISHU_ENCRYPT_KEY: z.string().optional(),
  FEISHU_VERIFICATION_TOKEN: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_SECURE: booleanEnvSchema.optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().optional(),
  EMAIL_DELIVERY_DISABLED: booleanEnvSchema.optional()
});

export const env = envSchema.parse(process.env);
