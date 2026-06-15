import type { ConnectionOptions } from "bullmq";
import { env } from "../config/env.js";

export type QueueWorkerHandle = {
  close(): Promise<void>;
};

export function createQueueConnection(): ConnectionOptions {
  return {
    url: env.REDIS_URL,
    maxRetriesPerRequest: null
  };
}
