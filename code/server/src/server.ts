import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { startDueReminderWorker } from "./jobs/due-reminder.js";
import { prisma } from "./lib/prisma.js";
import { createApp } from "./app.js";

const app = createApp();
const host = "127.0.0.1";

const server = app.listen(env.API_PORT, host, () => {
  logger.info({ host, port: env.API_PORT }, "Tower API server started");
  startDueReminderWorker();
});

async function shutdown() {
  logger.info("Shutting down Tower API server");
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
