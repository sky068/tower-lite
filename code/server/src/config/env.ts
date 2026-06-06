import { config } from "dotenv";
import { resolve } from "node:path";
import { z } from "zod";

config();
config({ path: resolve(process.cwd(), "../.env") });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  JWT_ACCESS_SECRET: z.string().min(12),
  JWT_REFRESH_SECRET: z.string().min(12),
  APP_BASE_URL: z.string().url().default("http://localhost:5173"),
  FEISHU_APP_ID: z.string().optional(),
  FEISHU_APP_SECRET: z.string().optional(),
  FEISHU_ENCRYPT_KEY: z.string().optional(),
  FEISHU_VERIFICATION_TOKEN: z.string().optional()
});

export const env = envSchema.parse(process.env);
