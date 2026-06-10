import { z } from "zod";

export const feishuWebhookSchema = z.record(z.string(), z.unknown());

export const feishuDeliveryParamsSchema = z.object({
  projectId: z.string().uuid(),
  deliveryId: z.string().uuid()
});

const feishuDeliveryClearDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const clearFeishuDeliveriesSchema = z
  .object({
    startDate: feishuDeliveryClearDateSchema,
    endDate: feishuDeliveryClearDateSchema,
    status: z.enum(["ALL", "SENT", "FAILED", "SKIPPED"]).default("ALL")
  })
  .refine((input) => input.startDate <= input.endDate, {
    message: "开始日期不能晚于结束日期",
    path: ["endDate"]
  });

export type FeishuWebhookInput = z.infer<typeof feishuWebhookSchema>;
export type ClearFeishuDeliveriesInput = z.infer<typeof clearFeishuDeliveriesSchema>;
