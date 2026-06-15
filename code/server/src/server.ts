import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { startDueReminderWorker } from "./jobs/due-reminder.js";
import type { QueueWorkerHandle } from "./lib/queue.js";
import { prisma } from "./lib/prisma.js";
import { createApp } from "./app.js";
import { startFeishuDeliveryWorker } from "./modules/feishu/feishu.service.js";
import { installRealtimeServer } from "./modules/realtime/realtime.service.js";
import { ensureConfiguredSystemAdmin } from "./modules/system/system.service.js";

const app = createApp();
const host = "127.0.0.1";
const workerHandles: QueueWorkerHandle[] = [];

await ensureConfiguredSystemAdmin();

const server = app.listen(env.API_PORT, host, () => {
  logger.info({ host, port: env.API_PORT }, "Tower API server started");
  void startDueReminderWorker()
    .then((handle) => workerHandles.push(handle))
    .catch((error) => {
      logger.error({ err: error }, "Due reminder BullMQ worker failed to start");
    });
  void startFeishuDeliveryWorker()
    .then((handle) => {
      if (handle) {
        workerHandles.push(handle);
      }
    })
    .catch((error) => {
      logger.error({ err: error }, "Feishu delivery BullMQ worker failed to start");
    });
});
installRealtimeServer(server);

async function shutdown() {
  logger.info("Shutting down Tower API server");
  server.close(async () => {
    await Promise.all(workerHandles.map((handle) => handle.close()));
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
