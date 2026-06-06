import { Router } from "express";
import { prisma } from "../../lib/prisma.js";

export const healthRoutes = Router();

healthRoutes.get("/health", async (req, res) => {
  await prisma.$queryRaw`SELECT 1`;

  res.json({
    data: {
      ok: true,
      database: "ok",
      uptimeSeconds: Math.round(process.uptime())
    },
    requestId: req.requestId
  });
});
