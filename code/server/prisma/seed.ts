import bcrypt from "bcryptjs";
import { config } from "dotenv";
import { resolve } from "node:path";
import { Prisma, PrismaClient, ProjectRole, TeamRole } from "@prisma/client";

config();
config({ path: resolve(process.cwd(), "../.env") });

const prisma = new PrismaClient();

const demoIds = {
  user: "00000000-0000-4000-8000-000000000001",
  teammate: "00000000-0000-4000-8000-000000000008",
  team: "00000000-0000-4000-8000-000000000002",
  task: "00000000-0000-4000-8000-000000000007"
};

async function main() {
  const passwordHash = await bcrypt.hash("password123", 12);

  const user = await prisma.user.create({
    data: {
      id: demoIds.user,
      email: "demo@tower.local",
      name: "Demo User",
      passwordHash
    }
  });

  const teammate = await prisma.user.create({
    data: {
      id: demoIds.teammate,
      email: "teammate@tower.local",
      name: "Teammate User",
      passwordHash
    }
  });

  const team = await prisma.team.create({
    data: {
      id: demoIds.team,
      name: "Demo Team",
      members: {
        create: [
          {
            userId: user.id,
            role: TeamRole.OWNER
          },
          {
            userId: teammate.id,
            role: TeamRole.MEMBER
          }
        ]
      }
    }
  });

  const project = await prisma.project.create({
    data: {
      name: "Demo Project",
      description: "V0 demo workspace",
      teamId: team.id,
      createdById: user.id,
      members: {
        create: [
          {
            userId: user.id,
            role: ProjectRole.OWNER
          },
          {
            userId: teammate.id,
            role: ProjectRole.EDITOR
          }
        ]
      }
    }
  });

  const defaultList = await prisma.taskList.create({
    data: {
      name: "默认清单",
      isDefault: true,
      projectId: project.id,
      sortKey: new Prisma.Decimal(1000)
    }
  });

  await prisma.task.create({
    data: {
      id: demoIds.task,
      title: "体验 V0 看板",
      description: "打开任务详情，试试评论、标签和一层子任务。",
      priority: "HIGH",
      projectId: project.id,
      taskListId: defaultList.id,
      creatorId: user.id,
      sortKey: new Prisma.Decimal(1000),
      assignees: {
        create: [
          {
            userId: user.id
          },
          {
            userId: teammate.id
          }
        ]
      }
    }
  });

  console.log("Seed completed");
  console.log("Login: demo@tower.local / password123");
  console.log("Login: teammate@tower.local / password123");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
