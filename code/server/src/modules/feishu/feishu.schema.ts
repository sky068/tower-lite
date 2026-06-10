import { z } from "zod";

export const feishuWebhookSchema = z.record(z.string(), z.unknown());

export const feishuDeliveryParamsSchema = z.object({
  projectId: z.string().uuid(),
  deliveryId: z.string().uuid()
});

export type FeishuWebhookInput = z.infer<typeof feishuWebhookSchema>;
