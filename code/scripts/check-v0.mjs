import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

const requiredFiles = [
  "client/src/features/auth/LoginPage.tsx",
  "client/src/features/auth/RegisterPage.tsx",
  "client/src/features/board/ProjectBoardPage.tsx",
  "client/src/features/board/ProjectGanttPage.tsx",
  "client/src/features/board/ProjectTaskListPage.tsx",
  "client/src/features/board/TaskDetailPanel.tsx",
  "client/src/components/layout/AppShell.tsx",
  "client/src/features/dashboard/DashboardPage.tsx",
  "client/src/features/project/ProjectSettingsPage.tsx",
  "client/src/features/project/ProjectTrashPage.tsx",
  "client/src/features/team/TeamDetailPage.tsx",
  "server/src/modules/auth/auth.routes.ts",
  "server/src/modules/activity/activity.routes.ts",
  "server/src/modules/feishu/feishu.routes.ts",
  "server/src/modules/memberships/membership.service.ts",
  "server/src/modules/teams/team.routes.ts",
  "server/src/modules/projects/project.routes.ts",
  "server/src/modules/tasks/task.routes.ts",
  "server/src/modules/tags/tag.routes.ts",
  "server/src/modules/users/user.routes.ts",
  "server/prisma/schema.prisma",
  "server/prisma/migrations/20260612000100_init/migration.sql",
  "server/prisma/seed.ts",
  "docs/api.http"
];

const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const requiredScripts = [
  "dev:client",
  "dev:server",
  "docker:up",
  "docker:down",
  "docker:reset",
  "doctor",
  "test",
  "typecheck",
  "build",
  "prisma:generate",
  "prisma:migrate",
  "prisma:seed"
];

const missingFiles = requiredFiles.filter((file) => !existsSync(join(root, file)));
const missingScripts = requiredScripts.filter((script) => !packageJson.scripts?.[script]);

if (missingFiles.length > 0 || missingScripts.length > 0) {
  console.error("V0 check failed");
  for (const file of missingFiles) {
    console.error(`Missing file: ${file}`);
  }
  for (const script of missingScripts) {
    console.error(`Missing script: ${script}`);
  }
  process.exit(1);
}

console.log("V0 structure check passed");
