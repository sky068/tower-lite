import bcrypt from "bcryptjs";
import { config } from "dotenv";
import { resolve } from "node:path";
import { Prisma, PrismaClient, ProjectRole, TaskListType, TeamRole } from "@prisma/client";

config();
config({ path: resolve(process.cwd(), "../.env") });

const prisma = new PrismaClient();

const demoIds = {
  user: "00000000-0000-4000-8000-000000000001",
  team: "00000000-0000-4000-8000-000000000002",
  project: "00000000-0000-4000-8000-000000000003",
  todoList: "00000000-0000-4000-8000-000000000004",
  doingList: "00000000-0000-4000-8000-000000000005",
  doneList: "00000000-0000-4000-8000-000000000006",
  task: "00000000-0000-4000-8000-000000000007"
};

async function main() {
  const passwordHash = await bcrypt.hash("password123", 12);

  const existingDemoUser = await prisma.user.findUnique({
    where: {
      email: "demo@tower.local"
    }
  });

  const user = existingDemoUser
    ? await prisma.user.update({
        where: {
          id: existingDemoUser.id
        },
        data: {
          name: "Demo User",
          passwordHash,
          deletedAt: null
        }
      })
    : await prisma.user.create({
        data: {
          id: demoIds.user,
          email: "demo@tower.local",
          name: "Demo User",
          passwordHash
        }
      });

  await prisma.user.update({
    where: {
      id: user.id
    },
    data: {
      email: "demo@tower.local",
      name: "Demo User",
      passwordHash,
      deletedAt: null
    }
  });

  const team = await prisma.team.upsert({
    where: {
      id: demoIds.team
    },
    update: {
      name: "Demo Team",
      deletedAt: null
    },
    create: {
      id: demoIds.team,
      name: "Demo Team",
      members: {
        create: {
          userId: user.id,
          role: TeamRole.OWNER
        }
      }
    }
  });

  await prisma.teamMember.upsert({
    where: {
      userId_teamId: {
        userId: user.id,
        teamId: team.id
      }
    },
    update: {
      role: TeamRole.OWNER
    },
    create: {
      userId: user.id,
      teamId: team.id,
      role: TeamRole.OWNER
    }
  });

  const project = await prisma.project.upsert({
    where: {
      id: demoIds.project
    },
    update: {
      name: "Demo Project",
      description: "V0 demo workspace",
      deletedAt: null,
      status: "ACTIVE"
    },
    create: {
      id: demoIds.project,
      name: "Demo Project",
      description: "V0 demo workspace",
      teamId: team.id,
      createdById: user.id,
      members: {
        create: {
          userId: user.id,
          role: ProjectRole.OWNER
        }
      },
      taskLists: {
        create: [
          {
            id: demoIds.todoList,
            name: "待处理",
            type: TaskListType.TODO,
            sortKey: new Prisma.Decimal(1000)
          },
          {
            id: demoIds.doingList,
            name: "进行中",
            type: TaskListType.IN_PROGRESS,
            sortKey: new Prisma.Decimal(2000)
          },
          {
            id: demoIds.doneList,
            name: "已完成",
            type: TaskListType.DONE,
            sortKey: new Prisma.Decimal(3000)
          }
        ]
      }
    },
    include: {
      taskLists: true
    }
  });

  await prisma.projectMember.upsert({
    where: {
      projectId_userId: {
        projectId: project.id,
        userId: user.id
      }
    },
    update: {
      role: ProjectRole.OWNER
    },
    create: {
      projectId: project.id,
      userId: user.id,
      role: ProjectRole.OWNER
    }
  });

  const taskLists = [
    { id: demoIds.todoList, name: "待处理", type: TaskListType.TODO, sortKey: "1000" },
    { id: demoIds.doingList, name: "进行中", type: TaskListType.IN_PROGRESS, sortKey: "2000" },
    { id: demoIds.doneList, name: "已完成", type: TaskListType.DONE, sortKey: "3000" }
  ];

  for (const list of taskLists) {
    await prisma.taskList.upsert({
      where: {
        id: list.id
      },
      update: {
        name: list.name,
        type: list.type,
        sortKey: new Prisma.Decimal(list.sortKey)
      },
      create: {
        id: list.id,
        name: list.name,
        type: list.type,
        sortKey: new Prisma.Decimal(list.sortKey),
        projectId: project.id
      }
    });
  }

  await prisma.task.upsert({
    where: {
      id: demoIds.task
    },
    update: {
      title: "体验 V0 看板",
      description: "打开任务详情，试试评论、标签和一层子任务。",
      priority: "HIGH",
      projectId: project.id,
      taskListId: demoIds.todoList,
      creatorId: user.id,
      assigneeId: user.id,
      sortKey: new Prisma.Decimal(1000),
      deletedAt: null
    },
    create: {
      id: demoIds.task,
      title: "体验 V0 看板",
      description: "打开任务详情，试试评论、标签和一层子任务。",
      priority: "HIGH",
      projectId: project.id,
      taskListId: demoIds.todoList,
      creatorId: user.id,
      assigneeId: user.id,
      sortKey: new Prisma.Decimal(1000)
    }
  });

  console.log("Seed completed");
  console.log("Login: demo@tower.local / password123");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
