import { config } from "dotenv";
import { resolve } from "node:path";
import { Prisma, PrismaClient, Priority, TaskStatus } from "@prisma/client";

config();
config({ path: resolve(process.cwd(), "../.env") });

const prisma = new PrismaClient();
const titlePrefix = "[测试排期]";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`
Generate local test tasks for the Gantt/task tree workflow.

Usage:
  npm run prisma:test-tasks
  TEST_TASK_PROJECT_ID=<project-id> npm run prisma:test-tasks

Behavior:
  - Default target is "Demo Project".
  - Set TEST_TASK_PROJECT_ID to write into another project.
  - Removes previously generated "${titlePrefix}" tasks in the target project before creating new ones.
  - Creates a broad scenario set covering:
    - no children, 1 child, multiple children, and grandchild task trees
    - scheduled, unscheduled, one-day, long-span, and completed tasks
    - TODO, IN_PROGRESS, and DONE status samples
    - LOW, MEDIUM, HIGH, and URGENT priority samples
    - 1 assignee, 2 assignees, and no assignee samples
    - parent summary bars and blank unscheduled child rows in the Gantt chart
`);
  process.exit(0);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function decimalSortKey(index: number) {
  return new Prisma.Decimal(index * 1000);
}

function assigneesForCase(projectMemberIds: string[], index: number) {
  if (index % 3 === 1) {
    return projectMemberIds.slice(0, 1);
  }

  if (index % 3 === 2) {
    return projectMemberIds.slice(0, 2);
  }

  return [];
}

function scheduleFrom(today: Date, startOffset: number, durationDays: number) {
  const startDate = addDays(today, startOffset);

  return {
    startDate,
    dueDate: addDays(startDate, durationDays)
  };
}

async function resolveTargetProject() {
  const projectId = process.env.TEST_TASK_PROJECT_ID;

  const project = projectId
    ? await prisma.project.findFirst({
        where: {
          id: projectId,
          deletedAt: null
        },
        include: {
          members: {
            where: {
              userId: {
                not: null
              }
            },
            include: {
              user: true,
              teamMember: true
            },
            orderBy: {
              createdAt: "asc"
            }
          }
        }
      })
    : await prisma.project.findFirst({
        where: {
          name: "Demo Project",
          deletedAt: null
        },
        include: {
          members: {
            where: {
              userId: {
                not: null
              }
            },
            include: {
              user: true,
              teamMember: true
            },
            orderBy: {
              createdAt: "asc"
            }
          }
        },
        orderBy: {
          createdAt: "asc"
        }
      });

  if (!project) {
    throw new Error(
      projectId
        ? `Project ${projectId} not found.`
        : "Demo Project not found. Run npm run prisma:seed first or set TEST_TASK_PROJECT_ID."
    );
  }

  const creatorId = project.members.find((member) => member.role === "ADMIN")?.userId ?? project.members[0]?.userId;

  if (!creatorId) {
    throw new Error(`Project ${project.name} has no members. Add a project member before generating test tasks.`);
  }

  let taskList = await prisma.taskList.findFirst({
    where: {
      projectId: project.id,
      deletedAt: null,
      isDefault: true
    },
    orderBy: {
      sortKey: "asc"
    }
  });

  taskList ??= await prisma.taskList.findFirst({
    where: {
      projectId: project.id,
      deletedAt: null
    },
    orderBy: {
      sortKey: "asc"
    }
  });

  if (!taskList) {
    taskList = await prisma.taskList.create({
      data: {
        name: "默认清单",
        isDefault: true,
        sortKey: decimalSortKey(1),
        projectId: project.id
      }
    });
  }

  return {
    project,
    creatorId,
    taskList
  };
}

async function cleanupGeneratedTasks(projectId: string) {
  const generatedTasks = await prisma.task.findMany({
    where: {
      projectId,
      title: {
        startsWith: titlePrefix
      }
    },
    select: {
      id: true
    }
  });
  const taskIds = generatedTasks.map((task) => task.id);

  if (taskIds.length === 0) {
    return;
  }

  await prisma.taskAssignee.deleteMany({
    where: {
      taskId: {
        in: taskIds
      }
    }
  });
  await prisma.taskTag.deleteMany({
    where: {
      taskId: {
        in: taskIds
      }
    }
  });
  await prisma.taskDependency.deleteMany({
    where: {
      OR: [
        {
          dependentTaskId: {
            in: taskIds
          }
        },
        {
          prerequisiteId: {
            in: taskIds
          }
        }
      ]
    }
  });
  await prisma.commentMention.deleteMany({
    where: {
      comment: {
        taskId: {
          in: taskIds
        }
      }
    }
  });
  await prisma.comment.deleteMany({
    where: {
      taskId: {
        in: taskIds
      }
    }
  });
  await prisma.task.deleteMany({
    where: {
      id: {
        in: taskIds
      }
    }
  });
}

async function createTask(input: {
  title: string;
  description: string;
  projectId: string;
  taskListId: string;
  creatorId: string;
  parentId?: string;
  sortIndex: number;
  startDate?: Date | null;
  dueDate?: Date | null;
  priority?: Priority;
  status?: TaskStatus;
  projectMemberIds?: string[];
  completedAt?: Date | null;
  completedById?: string | null;
}) {
  return prisma.task.create({
    data: {
      title: input.title,
      description: input.description,
      projectId: input.projectId,
      taskListId: input.taskListId,
      creatorId: input.creatorId,
      parentId: input.parentId,
      sortKey: decimalSortKey(input.sortIndex),
      startDate: input.startDate ?? null,
      dueDate: input.dueDate ?? null,
      priority: input.priority ?? Priority.MEDIUM,
      status: input.status ?? TaskStatus.TODO,
      completedAt: input.completedAt ?? null,
      completedById: input.completedById ?? null,
      assignees: input.projectMemberIds?.length
        ? {
            create: await Promise.all(input.projectMemberIds.map(async (projectMemberId) => {
              const member = await prisma.projectMember.findUnique({
                where: {
                  id: projectMemberId
                },
                include: {
                  user: true,
                  teamMember: true
                }
              });

              return {
                projectMemberId,
                assigneeNameSnapshot: member?.user?.name ?? member?.teamMember.email ?? "未认领成员",
                assigneeEmailSnapshot: member?.user?.email ?? member?.teamMember.email ?? "unknown@example.local",
                assigneeAvatarSnapshot: member?.user?.avatarUrl ?? null
              };
            }))
          }
        : undefined
    }
  });
}

async function main() {
  const { project, creatorId, taskList } = await resolveTargetProject();
  const projectMemberIds = project.members.map((member) => member.id);
  const today = startOfDay(new Date());
  let sortIndex = 100;

  await cleanupGeneratedTasks(project.id);

  const baseTaskInput = {
    projectId: project.id,
    taskListId: taskList.id,
    creatorId
  };

  const singleScheduled = scheduleFrom(today, 1, 2);
  const singleScheduledRoot = await createTask({
    ...baseTaskInput,
    title: `${titlePrefix} 单子任务 / 父有时间 / 1负责人`,
    description: "父任务有真实排期，子任务未排期；用于确认子任务不继承父任务日期。",
    sortIndex: sortIndex++,
    ...singleScheduled,
    priority: Priority.HIGH,
    projectMemberIds: assigneesForCase(projectMemberIds, 1)
  });
  await createTask({
    ...baseTaskInput,
    title: `${titlePrefix} 单子任务 / 父有时间 / 子无时间`,
    description: "未排期子任务，应在甘特图任务树中作为空白行展示。",
    parentId: singleScheduledRoot.id,
    sortIndex: sortIndex++,
    priority: Priority.LOW,
    projectMemberIds: assigneesForCase(projectMemberIds, 1)
  });

  const singleChildScheduledRoot = await createTask({
    ...baseTaskInput,
    title: `${titlePrefix} 单子任务 / 父无时间 / 2负责人`,
    description: "父任务无真实排期，子任务有排期；用于测试父任务汇总条。",
    sortIndex: sortIndex++,
    priority: Priority.MEDIUM,
    projectMemberIds: assigneesForCase(projectMemberIds, 2)
  });
  await createTask({
    ...baseTaskInput,
    title: `${titlePrefix} 单子任务 / 父无时间 / 子有时间`,
    description: "有真实排期的一级子任务。",
    parentId: singleChildScheduledRoot.id,
    sortIndex: sortIndex++,
    ...scheduleFrom(today, 4, 1),
    priority: Priority.HIGH,
    projectMemberIds: assigneesForCase(projectMemberIds, 2)
  });

  const singleUnscheduledRoot = await createTask({
    ...baseTaskInput,
    title: `${titlePrefix} 单子任务 / 全无时间 / 无负责人`,
    description: "父子任务都未排期，应整体出现在未排期任务区域。",
    sortIndex: sortIndex++,
    priority: Priority.LOW,
    projectMemberIds: assigneesForCase(projectMemberIds, 3)
  });
  await createTask({
    ...baseTaskInput,
    title: `${titlePrefix} 单子任务 / 全无时间 / 子任务`,
    description: "未排期一级子任务。",
    parentId: singleUnscheduledRoot.id,
    sortIndex: sortIndex++,
    priority: Priority.LOW,
    projectMemberIds: assigneesForCase(projectMemberIds, 3)
  });

  const multipleSummaryRoot = await createTask({
    ...baseTaskInput,
    title: `${titlePrefix} 多子任务 / 父无时间 / 1负责人`,
    description: "父任务无真实排期，多个子任务有不同排期；用于测试汇总条跨度。",
    sortIndex: sortIndex++,
    priority: Priority.HIGH,
    projectMemberIds: assigneesForCase(projectMemberIds, 4)
  });
  await createTask({
    ...baseTaskInput,
    title: `${titlePrefix} 多子任务 / 子A有时间`,
    description: "汇总条起点样本。",
    parentId: multipleSummaryRoot.id,
    sortIndex: sortIndex++,
    ...scheduleFrom(today, 7, 1),
    priority: Priority.MEDIUM,
    projectMemberIds: assigneesForCase(projectMemberIds, 4)
  });
  await createTask({
    ...baseTaskInput,
    title: `${titlePrefix} 多子任务 / 子B有时间`,
    description: "汇总条终点样本。",
    parentId: multipleSummaryRoot.id,
    sortIndex: sortIndex++,
    ...scheduleFrom(today, 10, 2),
    priority: Priority.URGENT,
    projectMemberIds: assigneesForCase(projectMemberIds, 4)
  });

  const multipleOwnRoot = await createTask({
    ...baseTaskInput,
    title: `${titlePrefix} 多子任务 / 父有时间 / 2负责人`,
    description: "父任务有真实排期，显示自身任务条；子任务各自按真实日期或空白行显示。",
    sortIndex: sortIndex++,
    ...scheduleFrom(today, 12, 2),
    priority: Priority.HIGH,
    projectMemberIds: assigneesForCase(projectMemberIds, 5)
  });
  await createTask({
    ...baseTaskInput,
    title: `${titlePrefix} 多子任务 / 父有时间 / 子无时间`,
    description: "未排期子任务，不继承父任务日期。",
    parentId: multipleOwnRoot.id,
    sortIndex: sortIndex++,
    priority: Priority.LOW,
    projectMemberIds: assigneesForCase(projectMemberIds, 5)
  });
  await createTask({
    ...baseTaskInput,
    title: `${titlePrefix} 多子任务 / 父有时间 / 子有时间`,
    description: "有真实排期的子任务。",
    parentId: multipleOwnRoot.id,
    sortIndex: sortIndex++,
    ...scheduleFrom(today, 15, 1),
    priority: Priority.MEDIUM,
    projectMemberIds: assigneesForCase(projectMemberIds, 5)
  });

  const multipleUnscheduledRoot = await createTask({
    ...baseTaskInput,
    title: `${titlePrefix} 多子任务 / 全无时间 / 无负责人`,
    description: "多子任务全未排期，用于测试未排期区域树形展示。",
    sortIndex: sortIndex++,
    priority: Priority.MEDIUM,
    projectMemberIds: assigneesForCase(projectMemberIds, 6)
  });
  for (const childName of ["子A无时间", "子B无时间"]) {
    await createTask({
      ...baseTaskInput,
      title: `${titlePrefix} 多子任务 / 全无时间 / ${childName}`,
      description: "未排期子任务。",
      parentId: multipleUnscheduledRoot.id,
      sortIndex: sortIndex++,
      priority: Priority.LOW,
      projectMemberIds: assigneesForCase(projectMemberIds, 6)
    });
  }

  const grandchildSummaryRoot = await createTask({
    ...baseTaskInput,
    title: `${titlePrefix} 孙子任务 / 仅孙子有时间 / 1负责人`,
    description: "父和子无真实排期，孙子任务有排期；用于测试多层汇总条。",
    sortIndex: sortIndex++,
    priority: Priority.HIGH,
    projectMemberIds: assigneesForCase(projectMemberIds, 7)
  });
  const grandchildSummaryChild = await createTask({
    ...baseTaskInput,
    title: `${titlePrefix} 孙子任务 / 仅孙子有时间 / 一级子任务`,
    description: "无真实排期，应显示为子任务汇总行。",
    parentId: grandchildSummaryRoot.id,
    sortIndex: sortIndex++,
    priority: Priority.MEDIUM,
    projectMemberIds: assigneesForCase(projectMemberIds, 7)
  });
  await createTask({
    ...baseTaskInput,
    title: `${titlePrefix} 孙子任务 / 仅孙子有时间 / 二级子任务`,
    description: "有真实排期的二级子任务。",
    parentId: grandchildSummaryChild.id,
    sortIndex: sortIndex++,
    ...scheduleFrom(today, 18, 3),
    priority: Priority.URGENT,
    projectMemberIds: assigneesForCase(projectMemberIds, 7)
  });

  const grandchildOwnRoot = await createTask({
    ...baseTaskInput,
    title: `${titlePrefix} 孙子任务 / 父和孙子有时间 / 2负责人`,
    description: "父任务有真实排期，孙子任务也有真实排期；用于测试自身显示优先且祖先汇总不漏孙子。",
    sortIndex: sortIndex++,
    ...scheduleFrom(today, 21, 1),
    priority: Priority.HIGH,
    projectMemberIds: assigneesForCase(projectMemberIds, 8)
  });
  const grandchildOwnChild = await createTask({
    ...baseTaskInput,
    title: `${titlePrefix} 孙子任务 / 父和孙子有时间 / 一级子任务无时间`,
    description: "无真实排期，但有排期孙子，显示汇总条。",
    parentId: grandchildOwnRoot.id,
    sortIndex: sortIndex++,
    priority: Priority.MEDIUM,
    projectMemberIds: assigneesForCase(projectMemberIds, 8)
  });
  await createTask({
    ...baseTaskInput,
    title: `${titlePrefix} 孙子任务 / 父和孙子有时间 / 二级子任务有时间`,
    description: "有真实排期的二级子任务。",
    parentId: grandchildOwnChild.id,
    sortIndex: sortIndex++,
    ...scheduleFrom(today, 24, 2),
    priority: Priority.HIGH,
    projectMemberIds: assigneesForCase(projectMemberIds, 8)
  });

  const grandchildUnassignedRoot = await createTask({
    ...baseTaskInput,
    title: `${titlePrefix} 孙子任务 / 子有时间孙无时间 / 无负责人`,
    description: "一级子任务有真实排期，二级子任务无排期。",
    sortIndex: sortIndex++,
    priority: Priority.MEDIUM,
    projectMemberIds: assigneesForCase(projectMemberIds, 9)
  });
  const grandchildUnassignedChild = await createTask({
    ...baseTaskInput,
    title: `${titlePrefix} 孙子任务 / 子有时间孙无时间 / 一级子任务`,
    description: "有真实排期的一级子任务。",
    parentId: grandchildUnassignedRoot.id,
    sortIndex: sortIndex++,
    ...scheduleFrom(today, 27, 2),
    priority: Priority.MEDIUM,
    projectMemberIds: assigneesForCase(projectMemberIds, 9)
  });
  await createTask({
    ...baseTaskInput,
    title: `${titlePrefix} 孙子任务 / 子有时间孙无时间 / 二级子任务无时间`,
    description: "未排期二级子任务，不继承父任务日期。",
    parentId: grandchildUnassignedChild.id,
    sortIndex: sortIndex++,
    priority: Priority.LOW,
    projectMemberIds: assigneesForCase(projectMemberIds, 9)
  });

  await createTask({
    ...baseTaskInput,
    title: `${titlePrefix} 无子任务 / 单日排期 / 1负责人`,
    description: "无子任务的单日任务，用于测试开始和截止日期相同的甘特条。",
    sortIndex: sortIndex++,
    ...scheduleFrom(today, 2, 0),
    priority: Priority.URGENT,
    status: TaskStatus.IN_PROGRESS,
    projectMemberIds: assigneesForCase(projectMemberIds, 10)
  });

  await createTask({
    ...baseTaskInput,
    title: `${titlePrefix} 无子任务 / 未排期 / 2负责人`,
    description: "无子任务且无排期，用于测试未排期任务列表中的负责人展示。",
    sortIndex: sortIndex++,
    priority: Priority.MEDIUM,
    projectMemberIds: assigneesForCase(projectMemberIds, 11)
  });

  await createTask({
    ...baseTaskInput,
    title: `${titlePrefix} 无子任务 / 已完成 / 无负责人`,
    description: "已完成的有排期任务，用于测试灰色完成态任务条和完成人信息。",
    sortIndex: sortIndex++,
    ...scheduleFrom(today, -3, 1),
    priority: Priority.LOW,
    status: TaskStatus.DONE,
    completedAt: addDays(today, -1),
    completedById: creatorId,
    projectMemberIds: assigneesForCase(projectMemberIds, 12)
  });

  const crossMonthRoot = await createTask({
    ...baseTaskInput,
    title: `${titlePrefix} 跨月长任务 / 父无时间 / 1负责人`,
    description: "父任务无真实排期，子任务跨月；用于测试周/月视图和父任务汇总跨度。",
    sortIndex: sortIndex++,
    priority: Priority.HIGH,
    status: TaskStatus.IN_PROGRESS,
    projectMemberIds: assigneesForCase(projectMemberIds, 13)
  });
  await createTask({
    ...baseTaskInput,
    title: `${titlePrefix} 跨月长任务 / 子任务45天`,
    description: "跨月长周期子任务。",
    parentId: crossMonthRoot.id,
    sortIndex: sortIndex++,
    ...scheduleFrom(today, 30, 45),
    priority: Priority.HIGH,
    status: TaskStatus.IN_PROGRESS,
    projectMemberIds: assigneesForCase(projectMemberIds, 13)
  });
  await createTask({
    ...baseTaskInput,
    title: `${titlePrefix} 跨月长任务 / 单日里程碑`,
    description: "长任务旁边的单日任务，用于测试同一父级下宽窄色块。",
    parentId: crossMonthRoot.id,
    sortIndex: sortIndex++,
    ...scheduleFrom(today, 50, 0),
    priority: Priority.URGENT,
    projectMemberIds: assigneesForCase(projectMemberIds, 13)
  });

  const mixedStatusRoot = await createTask({
    ...baseTaskInput,
    title: `${titlePrefix} 混合状态 / 父有时间 / 2负责人`,
    description: "父任务有真实排期，子任务覆盖待处理、进行中、已完成三种状态。",
    sortIndex: sortIndex++,
    ...scheduleFrom(today, 34, 7),
    priority: Priority.MEDIUM,
    projectMemberIds: assigneesForCase(projectMemberIds, 14)
  });
  await createTask({
    ...baseTaskInput,
    title: `${titlePrefix} 混合状态 / 待处理子任务`,
    description: "待处理子任务。",
    parentId: mixedStatusRoot.id,
    sortIndex: sortIndex++,
    ...scheduleFrom(today, 35, 1),
    priority: Priority.LOW,
    status: TaskStatus.TODO,
    projectMemberIds: assigneesForCase(projectMemberIds, 14)
  });
  await createTask({
    ...baseTaskInput,
    title: `${titlePrefix} 混合状态 / 进行中子任务`,
    description: "进行中子任务。",
    parentId: mixedStatusRoot.id,
    sortIndex: sortIndex++,
    ...scheduleFrom(today, 37, 2),
    priority: Priority.HIGH,
    status: TaskStatus.IN_PROGRESS,
    projectMemberIds: assigneesForCase(projectMemberIds, 14)
  });
  await createTask({
    ...baseTaskInput,
    title: `${titlePrefix} 混合状态 / 已完成子任务`,
    description: "已完成子任务。",
    parentId: mixedStatusRoot.id,
    sortIndex: sortIndex++,
    ...scheduleFrom(today, 40, 1),
    priority: Priority.URGENT,
    status: TaskStatus.DONE,
    completedAt: addDays(today, -1),
    completedById: creatorId,
    projectMemberIds: assigneesForCase(projectMemberIds, 14)
  });

  const allUnscheduledDeepRoot = await createTask({
    ...baseTaskInput,
    title: `${titlePrefix} 全未排期深层 / 父任务 / 无负责人`,
    description: "父、子、孙都无排期，用于测试未排期区域的深层树形折叠。",
    sortIndex: sortIndex++,
    priority: Priority.LOW,
    projectMemberIds: assigneesForCase(projectMemberIds, 15)
  });
  const allUnscheduledDeepChild = await createTask({
    ...baseTaskInput,
    title: `${titlePrefix} 全未排期深层 / 一级子任务`,
    description: "未排期一级子任务。",
    parentId: allUnscheduledDeepRoot.id,
    sortIndex: sortIndex++,
    priority: Priority.MEDIUM,
    projectMemberIds: assigneesForCase(projectMemberIds, 15)
  });
  await createTask({
    ...baseTaskInput,
    title: `${titlePrefix} 全未排期深层 / 二级子任务`,
    description: "未排期二级子任务。",
    parentId: allUnscheduledDeepChild.id,
    sortIndex: sortIndex++,
    priority: Priority.HIGH,
    projectMemberIds: assigneesForCase(projectMemberIds, 15)
  });

  const siblingRangeRoot = await createTask({
    ...baseTaskInput,
    title: `${titlePrefix} 兄弟跨度 / 父无时间 / 1负责人`,
    description: "兄弟任务时间跨度分散，用于测试父级汇总条随最早和最晚子任务变化。",
    sortIndex: sortIndex++,
    priority: Priority.MEDIUM,
    projectMemberIds: assigneesForCase(projectMemberIds, 16)
  });
  await createTask({
    ...baseTaskInput,
    title: `${titlePrefix} 兄弟跨度 / 较早子任务`,
    description: "汇总条较早起点。",
    parentId: siblingRangeRoot.id,
    sortIndex: sortIndex++,
    ...scheduleFrom(today, -8, 2),
    priority: Priority.LOW,
    projectMemberIds: assigneesForCase(projectMemberIds, 16)
  });
  await createTask({
    ...baseTaskInput,
    title: `${titlePrefix} 兄弟跨度 / 较晚子任务`,
    description: "汇总条较晚终点。",
    parentId: siblingRangeRoot.id,
    sortIndex: sortIndex++,
    ...scheduleFrom(today, 70, 5),
    priority: Priority.URGENT,
    projectMemberIds: assigneesForCase(projectMemberIds, 16)
  });

  const generatedTaskCount = await prisma.task.count({
    where: {
      projectId: project.id,
      title: {
        startsWith: titlePrefix
      }
    }
  });
  const generatedRootCount = await prisma.task.count({
    where: {
      projectId: project.id,
      parentId: null,
      title: {
        startsWith: titlePrefix
      }
    }
  });

  console.log(`Generated ${generatedTaskCount} test tasks across ${generatedRootCount} root scenarios in ${project.name}.`);
  console.log("Pattern coverage: no-child, single-child, multi-child, grandchild, and deep unscheduled task trees.");
  console.log("Schedule coverage: scheduled, unscheduled, one-day, long-span, completed, parent summary bars, and blank unscheduled rows.");
  console.log("Field coverage: TODO/IN_PROGRESS/DONE statuses, LOW/MEDIUM/HIGH/URGENT priorities, and 0/1/2 assignees.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
