import cors from "cors";
import express from "express";
import helmet from "helmet";
import { logger } from "./config/logger.js";
import { errorHandler } from "./middleware/error-handler.js";
import { requestId } from "./middleware/request-id.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { healthRoutes } from "./modules/health/health.routes.js";
import { invitationRoutes } from "./modules/invitations/invitation.routes.js";
import { projectRoutes } from "./modules/projects/project.routes.js";
import { taskRoutes } from "./modules/tasks/task.routes.js";
import { tagRoutes } from "./modules/tags/tag.routes.js";
import { teamRoutes } from "./modules/teams/team.routes.js";
import { userRoutes } from "./modules/users/user.routes.js";

const API_PREFIX = "/api/v1";

export function createApp() {
  const app = express();

  app.use(requestId);
  app.use((req, _res, next) => {
    logger.info({ requestId: req.requestId, method: req.method, path: req.path }, "Incoming request");
    next();
  });
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.use(API_PREFIX, healthRoutes);
  app.use(API_PREFIX, authRoutes);
  app.use(API_PREFIX, userRoutes);
  app.use(API_PREFIX, invitationRoutes);
  app.use(API_PREFIX, teamRoutes);
  app.use(API_PREFIX, projectRoutes);
  app.use(API_PREFIX, taskRoutes);
  app.use(API_PREFIX, tagRoutes);

  app.use(errorHandler);

  return app;
}
