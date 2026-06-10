import { z } from "zod";

const activityLogDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const clearActivityLogsSchema = z
  .object({
    startDate: activityLogDateSchema,
    endDate: activityLogDateSchema
  })
  .refine((input) => input.startDate <= input.endDate, {
    message: "开始日期不能晚于结束日期",
    path: ["endDate"]
  });

export type ClearActivityLogsInput = z.infer<typeof clearActivityLogsSchema>;
