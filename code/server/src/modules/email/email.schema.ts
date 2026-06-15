import { AccountTokenType } from "@prisma/client";
import { z } from "zod";

export const emailOutboxQuerySchema = z.object({
  status: z.enum(["ALL", "PENDING", "SENT", "FAILED"]).optional().default("ALL"),
  type: z.nativeEnum(AccountTokenType).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50)
});

export const emailOutboxParamsSchema = z.object({
  emailOutboxId: z.string().uuid()
});

export type EmailOutboxQuery = z.infer<typeof emailOutboxQuerySchema>;
