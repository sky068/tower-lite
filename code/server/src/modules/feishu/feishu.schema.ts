import { z } from "zod";

export const feishuWebhookSchema = z.record(z.string(), z.unknown());

export type FeishuWebhookInput = z.infer<typeof feishuWebhookSchema>;
