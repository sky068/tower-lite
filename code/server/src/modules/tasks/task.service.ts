import { NotificationType, Prisma, ProjectRole, TaskStatus } from "@prisma/client";
import { logger } from "../../config/logger.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../middleware/error-handler.js";
import { createActivityLog } from "../activity/activity.service.js";
import { createNotification } from "../notifications/notification.service.js";
import {
  assertProjectActive,
  requireActiveProjectEditor,
  requireProjectAccess,
  requireProjectManager
} from "../projects/project.policy.js";
import { publishProjectEvent } from "../realtime/realtime.service.js";
import {
  assertTaskListDeletable,
  assertTaskListEditable,
  assertTaskListNameAvailable,
  assertTaskDeletable,
  assertV01SubTaskParent,
  assertValidDateRange,
  normalizeTaskDateRange
} from "./task.rules.js";
import type {
  CreateCommentInput,
  CreateTaskInput,
  CreateTaskListInput,
  DeleteTaskListInput,
  MoveTaskInput,
  ReorderTaskListsInput,
  UpdateTaskListInput,
  UpdateTaskInput
} from "./task.schema.js";

function toTaskList(taskList: {
  id: string;
  name: string;
  isDefault: boolean;
  sortKey: Prisma.Decimal;
  deletedAt?: Date | null;
  tasks?: Array<ReturnType<typeof toTask>>;
}) {
  return {
    id: taskList.id,
    name: taskList.name,
    isDefault: taskList.isDefault,
    sortKey: taskList.sortKey.toString(),
    deletedAt: taskList.deletedAt ?? null,
    tasks: taskList.tasks ?? []
  };
}

function toTrashTask(task: {
  id: string;
  title: string;
  deletedAt: Date | null;
  deletedBy?: {
    id: string;
    name: string;
    email: string;
    avatarUrl: string | null;
  } | null;
  taskList: {
    id: string;
    name: string;
    deletedAt: Date | null;
  };
  parent?: {
    id: string;
    title: string;
    deletedAt: Date | null;
  } | null;
}) {
  return {
    id: task.id,
    title: task.title,
    deletedAt: task.deletedAt,
    deletedBy: task.deletedBy ?? null,
    taskList: task.taskList,
    parent: task.parent ?? null
  };
}

function toTask(task: {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  sortKey: Prisma.Decimal;
  startDate: Date | null;
  dueDate: Date | null;
  taskListId: string;
  projectId: string;
  creatorId: string;
  parentId: string | null;
  completedAt: Date | null;
  completedBy?: {
    id: string;
    name: string;
    avatarUrl: string | null;
  } | null;
  createdAt: Date;
  updatedAt: Date;
  assignees?: Array<{
    user: {
      id: string;
      userId?: string | null;
      name: string;
      email?: string;
      avatarUrl: string | null;
      status?: "ACTIVE" | "PENDING" | "REMOVED";
    };
  }>;
  tags?: Array<{
    tag: {
      id: string;
      name: string;
      color: string;
      projectId: string;
    };
  }>;
  _count?: {
    subTasks: number;
  };
}) {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    sortKey: task.sortKey.toString(),
    startDate: task.startDate,
    dueDate: task.dueDate,
    taskListId: task.taskListId,
    projectId: task.projectId,
    creatorId: task.creatorId,
    parentId: task.parentId,
    completedAt: task.completedAt,
    completedBy: task.completedBy
      ? {
          id: task.completedBy.id,
          name: task.completedBy.name,
          avatarUrl: task.completedBy.avatarUrl
        }
      : null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    assignees:
      task.assignees?.map(({ user }) => ({
        id: user.id,
        userId: user.userId,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
        status: user.status ?? "ACTIVE"
      })) ?? [],
    tags: task.tags?.map(({ tag }) => tag) ?? [],
    subTaskCount: task._count?.subTasks ?? 0
  };
}

async function getNextSortKey(taskListId: string) {
  const lastTask = await prisma.task.findFirst({
    where: {
      taskListId,
      deletedAt: null
    },
    orderBy: {
      sortKey: "desc"
    }
  });

  return lastTask ? lastTask.sortKey.plus(1000) : new Prisma.Decimal(1000);
}

async function assertTaskListInProject(taskListId: string, projectId: string) {
  const taskList = await prisma.taskList.findFirst({
    where: {
      id: taskListId,
      projectId,
      deletedAt: null
    }
  });

  if (!taskList) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "Task list does not belong to this project", 422);
  }

  return taskList;
}

async function assertTaskListNameUnique(projectId: string, name: string, taskListId?: string) {
  const existingTaskList = await prisma.taskList.findFirst({
    where: {
      projectId,
      name,
      deletedAt: null
    },
    select: {
      id: true
    }
  });

  assertTaskListNameAvailable(existingTaskList, taskListId);
}

async function getOrCreateDefaultTaskList(projectId: string) {
  const existingList = await prisma.taskList.findFirst({
    where: {
      projectId,
      deletedAt: null
    },
    orderBy: {
      sortKey: "asc"
    }
  });

  if (existingList) {
    return existingList;
  }

  return prisma.taskList.create({
    data: {
      name: "默认清单",
      isDefault: true,
      projectId,
      sortKey: new Prisma.Decimal(1000)
    }
  });
}

function getTaskStatusLabel(status: string) {
  const labels: Record<string, string> = {
    TODO: "待处理",
    IN_PROGRESS: "进行中",
    DONE: "已完成"
  };

  return labels[status] ?? status;
}

function getCompletionPatch(input: { nextStatus: TaskStatus; currentStatus?: TaskStatus; userId: string }) {
  if (input.nextStatus === TaskStatus.DONE && input.currentStatus !== TaskStatus.DONE) {
    return {
      completedAt: new Date(),
      completedById: input.userId
    };
  }

  if (input.nextStatus !== TaskStatus.DONE && input.currentStatus === TaskStatus.DONE) {
    return {
      completedAt: null,
      completedById: null
    };
  }

  return {};
}

function normalizeProjectMemberIds(input: { projectMemberIds?: string[] }) {
  return [...new Set(input.projectMemberIds ?? [])];
}

async function assertAssigneesAreProjectMembers(
  projectMemberIds: string[],
  projectId: string,
  existingProjectMemberIds: string[] = []
) {
  if (projectMemberIds.length === 0) {
    return;
  }

  const existingProjectMemberSet = new Set(existingProjectMemberIds);
  const projectMemberIdsToValidate = projectMemberIds.filter((projectMemberId) => !existingProjectMemberSet.has(projectMemberId));

  if (projectMemberIdsToValidate.length === 0) {
    return;
  }

  const count = await prisma.projectMember.count({
    where: {
      projectId,
      id: {
        in: projectMemberIdsToValidate
      }
    }
  });

  if (count !== projectMemberIdsToValidate.length) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "Assignees must be project members", 422);
  }
}

async function assertTagsInProject(tagIds: string[] | undefined, projectId: string) {
  if (!tagIds || tagIds.length === 0) {
    return;
  }

  const count = await prisma.tag.count({
    where: {
      id: {
        in: tagIds
      },
      projectId
    }
  });

  if (count !== new Set(tagIds).size) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "All tags must belong to this project", 422);
  }
}

async function assertV01ParentTask(parentId: string | undefined, projectId: string) {
  if (!parentId) {
    return;
  }

  const parentTask = await prisma.task.findFirst({
    where: {
      id: parentId,
      projectId,
      deletedAt: null
    }
  });

  if (!parentTask) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "Parent task must belong to this project", 422);
  }

  const parentTrail = await getTaskParentTrail(parentTask.parentId, projectId);
  assertV01SubTaskParent({ depth: parentTrail.length });
}

async function getTaskParentTrail(parentId: string | null, projectId: string) {
  const trail: Array<{ id: string; title: string }> = [];
  let currentParentId = parentId;
  let guard = 0;

  while (currentParentId && guard < 20) {
    const parentTask = await prisma.task.findFirst({
      where: {
        id: currentParentId,
        projectId,
        deletedAt: null
      },
      select: {
        id: true,
        title: true,
        parentId: true
      }
    });

    if (!parentTask) {
      break;
    }

    trail.unshift({
      id: parentTask.id,
      title: parentTask.title
    });
    currentParentId = parentTask.parentId;
    guard += 1;
  }

  return trail;
}

type TaskAssigneeUser = {
  taskId: string;
  id: string;
  projectMemberId: string | null;
  userId: string | null;
  name: string;
  email: string;
  avatarUrl: string | null;
  status: "ACTIVE" | "PENDING" | "REMOVED";
};

async function getTaskAssigneeMap(taskIds: string[]) {
  if (taskIds.length === 0) {
    return new Map<string, TaskAssigneeUser[]>();
  }

  const rows = await prisma.$queryRaw<TaskAssigneeUser[]>`
    SELECT
      ta."taskId",
      ta."id",
      ta."projectMemberId",
      pm."userId",
      COALESCE(u."name", ta."assigneeNameSnapshot") AS "name",
      COALESCE(u."email", ta."assigneeEmailSnapshot") AS "email",
      COALESCE(u."avatarUrl", ta."assigneeAvatarSnapshot") AS "avatarUrl",
      CASE
        WHEN pm."id" IS NULL THEN 'REMOVED'
        WHEN pm."userId" IS NULL THEN 'PENDING'
        ELSE 'ACTIVE'
      END AS "status"
    FROM "TaskAssignee" ta
    LEFT JOIN "ProjectMember" pm ON pm."id" = ta."projectMemberId"
    LEFT JOIN "User" u ON u."id" = pm."userId"
    WHERE ta."taskId" IN (${Prisma.join(taskIds)})
    ORDER BY ta."createdAt" ASC
  `;

  const map = new Map<string, TaskAssigneeUser[]>();
  for (const row of rows) {
    const items = map.get(row.taskId) ?? [];
    items.push(row);
    map.set(row.taskId, items);
  }

  return map;
}

function attachAssignees<T extends { id: string }>(
  task: T,
  assigneeMap: Map<string, TaskAssigneeUser[]>
) {
  const assignees = assigneeMap.get(task.id)?.map((user) => ({
    user: {
      id: user.projectMemberId ?? user.id,
      userId: user.userId,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
      status: user.status
    }
  }));

  return {
    ...task,
    assignees
  };
}

async function replaceTaskAssignees(
  tx: Prisma.TransactionClient | typeof prisma,
  taskId: string,
  projectMemberIds: string[]
) {
  await tx.taskAssignee.deleteMany({
    where: {
      taskId,
      projectMemberId: {
        not: null
      }
    }
  });

  if (projectMemberIds.length === 0) {
    return;
  }

  const members = await tx.projectMember.findMany({
    where: {
      id: {
        in: projectMemberIds
      }
    },
    include: {
      user: true,
      teamMember: {
        include: {
          user: true
        }
      }
    }
  });
  const memberMap = new Map(members.map((member) => [member.id, member]));

  await tx.taskAssignee.createMany({
    data: projectMemberIds
      .map((projectMemberId) => {
        const member = memberMap.get(projectMemberId);

        if (!member) {
          return null;
        }

        const displayName = member.user?.name ?? member.teamMember.email;
        const displayEmail = member.user?.email ?? member.teamMember.email;

        return {
          taskId,
          projectMemberId: member.id,
          assigneeNameSnapshot: displayName,
          assigneeEmailSnapshot: displayEmail,
          assigneeAvatarSnapshot: member.user?.avatarUrl ?? null
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item)),
    skipDuplicates: true
  });
}

async function getActiveProjectMemberRecipientIds(projectId: string, projectMemberIds: string[]) {
  const uniqueProjectMemberIds = [...new Set(projectMemberIds)];

  if (uniqueProjectMemberIds.length === 0) {
    return [];
  }

  const rows = await prisma.$queryRaw<Array<{ userId: string }>>`
    SELECT DISTINCT project_member."userId"
    FROM (
      SELECT UNNEST(ARRAY[${Prisma.join(uniqueProjectMemberIds)}]::text[]) AS "projectMemberId"
    ) candidate
    JOIN "ProjectMember" project_member
      ON project_member."id" = candidate."projectMemberId"
      AND project_member."projectId" = ${projectId}
      AND project_member."userId" IS NOT NULL
    JOIN "Project" project ON project."id" = project_member."projectId"
    JOIN "TeamMember" team_member ON team_member."id" = project_member."teamMemberId"
    WHERE project."deletedAt" IS NULL
      AND team_member."userId" IS NOT NULL
  `;

  return [...new Set(rows.map((row) => row.userId))];
}

async function filterActiveProjectRecipients(projectId: string, userIds: string[]) {
  const uniqueUserIds = [...new Set(userIds)];

  if (uniqueUserIds.length === 0) {
    return [];
  }

  const rows = await prisma.projectMember.findMany({
    where: {
      projectId,
      userId: {
        in: uniqueUserIds
      },
      project: {
        deletedAt: null
      },
      teamMember: {
        userId: {
          not: null
        }
      }
    },
    select: {
      userId: true
    }
  });
  const activeUserIds = new Set(rows.map((row) => row.userId).filter(Boolean));
  return uniqueUserIds.filter((userId) => activeUserIds.has(userId));
}

async function getActiveTaskAssigneeUserIds(taskId: string) {
  const assigneeMap = await getTaskAssigneeMap([taskId]);
  return assigneeMap.get(taskId)
    ?.filter((assignee) => assignee.status === "ACTIVE" && assignee.userId)
    .map((assignee) => assignee.userId!) ?? [];
}

async function createTaskAssignedNotifications(input: {
  actorId: string;
  projectId: string;
  taskId: string;
  taskTitle: string;
  projectMemberIds: string[];
  dedupeSuffix?: string;
}) {
  const recipientIds = await getActiveProjectMemberRecipientIds(input.projectId, input.projectMemberIds);

  await Promise.all(
    recipientIds.map((recipientId) =>
      createNotification({
        type: NotificationType.TASK_ASSIGNED,
        recipientId,
        actorId: input.actorId,
        projectId: input.projectId,
        taskId: input.taskId,
        title: "你被分配了一个任务",
        content: input.taskTitle,
        dedupeKey: [
          "task_assigned",
          input.taskId,
          recipientId,
          input.dedupeSuffix
        ].filter(Boolean).join(":"),
        skipActor: true
      })
    )
  );
}

export async function listProjectTaskLists(userId: string, projectId: string) {
  await requireProjectAccess(userId, projectId);

  const lists = await prisma.taskList.findMany({
    where: {
      projectId,
      deletedAt: null
    },
    include: {
      tasks: {
        where: {
          deletedAt: null,
          parentId: null
        },
        include: {
          tags: {
            include: {
              tag: true
            }
          },
          completedBy: true,
          _count: {
            select: {
              subTasks: {
                where: {
                  deletedAt: null
                }
              }
            }
          }
        },
        orderBy: {
          sortKey: "asc"
        }
      }
    },
    orderBy: {
      sortKey: "asc"
    }
  });

  const taskIds = lists.flatMap((list) => list.tasks.map((task) => task.id));
  const assigneeMap = await getTaskAssigneeMap(taskIds);

  return lists.map((list) =>
    toTaskList({
      ...list,
      tasks: list.tasks.map((task) => toTask(attachAssignees(task, assigneeMap)))
    })
  );
}

export async function listProjectTaskListView(userId: string, projectId: string) {
  await requireProjectAccess(userId, projectId);

  const lists = await prisma.taskList.findMany({
    where: {
      projectId,
      deletedAt: null
    },
    include: {
      tasks: {
        where: {
          deletedAt: null
        },
        include: {
          tags: {
            include: {
              tag: true
            }
          },
          completedBy: true,
          _count: {
            select: {
              subTasks: {
                where: {
                  deletedAt: null
                }
              }
            }
          }
        },
        orderBy: {
          sortKey: "asc"
        }
      }
    },
    orderBy: {
      sortKey: "asc"
    }
  });

  const taskIds = lists.flatMap((list) => list.tasks.map((task) => task.id));
  const assigneeMap = await getTaskAssigneeMap(taskIds);

  return lists.map((list) =>
    toTaskList({
      ...list,
      tasks: list.tasks.map((task) => toTask(attachAssignees(task, assigneeMap)))
    })
  );
}

export async function createTaskList(userId: string, projectId: string, input: CreateTaskListInput) {
  const { project } = await requireProjectManager(userId, projectId);
  assertProjectActive(project);
  await assertTaskListNameUnique(projectId, input.name);

  const lastList = await prisma.taskList.findFirst({
    where: {
      projectId,
      deletedAt: null
    },
    orderBy: {
      sortKey: "desc"
    }
  });

  const taskList = await prisma.taskList.create({
    data: {
      name: input.name,
      projectId,
      sortKey: lastList ? lastList.sortKey.plus(1000) : new Prisma.Decimal(1000)
    }
  });

  await publishProjectEvent(projectId, { type: "task.changed", projectId });
  await createActivityLog({
    actorId: userId,
    teamId: project.teamId,
    projectId,
    action: "task_list.created",
    targetType: "task_list",
    targetId: taskList.id,
    metadata: {
      name: taskList.name
    }
  });

  return toTaskList(taskList);
}

export async function updateTaskList(
  userId: string,
  projectId: string,
  taskListId: string,
  input: UpdateTaskListInput
) {
  const { project } = await requireProjectManager(userId, projectId);
  assertProjectActive(project);
  const taskList = await assertTaskListInProject(taskListId, projectId);
  assertTaskListEditable(taskList);
  await assertTaskListNameUnique(projectId, input.name, taskListId);

  const updatedTaskList = await prisma.taskList.update({
    where: {
      id: taskListId
    },
    data: {
      name: input.name
    }
  });

  await publishProjectEvent(projectId, { type: "task.changed", projectId });
  await createActivityLog({
    actorId: userId,
    teamId: project.teamId,
    projectId,
    action: "task_list.updated",
    targetType: "task_list",
    targetId: taskListId,
    metadata: {
      beforeName: taskList.name,
      name: updatedTaskList.name
    }
  });

  return toTaskList(updatedTaskList);
}

async function getTaskListTaskIdsWithDescendants(taskListId: string, includeDeleted = false) {
  const taskIds = new Set(
    (
      await prisma.task.findMany({
        where: {
          taskListId,
          ...(includeDeleted ? {} : { deletedAt: null })
        },
        select: {
          id: true
        }
      })
    ).map((task) => task.id)
  );
  let frontier = [...taskIds];

  while (frontier.length > 0) {
    const children = await prisma.task.findMany({
      where: {
        ...(includeDeleted ? {} : { deletedAt: null }),
        parentId: {
          in: frontier
        }
      },
      select: {
        id: true
      }
    });
    const nextFrontier = children
      .map((task) => task.id)
      .filter((taskId) => !taskIds.has(taskId));

    nextFrontier.forEach((taskId) => taskIds.add(taskId));
    frontier = nextFrontier;
  }

  return [...taskIds];
}

async function deleteTasksByIds(tx: Prisma.TransactionClient, taskIds: string[]) {
  if (taskIds.length === 0) {
    return;
  }

  await tx.taskDependency.deleteMany({
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
  await tx.taskAssignee.deleteMany({
    where: {
      taskId: {
        in: taskIds
      }
    }
  });
  await tx.taskTag.deleteMany({
    where: {
      taskId: {
        in: taskIds
      }
    }
  });
  await tx.commentMention.deleteMany({
    where: {
      comment: {
        taskId: {
          in: taskIds
        }
      }
    }
  });
  await tx.comment.deleteMany({
    where: {
      taskId: {
        in: taskIds
      }
    }
  });
  await tx.task.updateMany({
    where: {
      id: {
        in: taskIds
      }
    },
    data: {
      parentId: null
    }
  });
  await tx.task.deleteMany({
    where: {
      id: {
        in: taskIds
      }
    }
  });
}

export async function deleteTaskList(
  userId: string,
  projectId: string,
  taskListId: string,
  _input: DeleteTaskListInput
) {
  const { project } = await requireProjectManager(userId, projectId);
  assertProjectActive(project);
  const taskList = await assertTaskListInProject(taskListId, projectId);
  assertTaskListDeletable(taskList);

  const taskIds = await getTaskListTaskIdsWithDescendants(taskListId);
  const deletedAt = new Date();

  await prisma.$transaction(async (tx) => {
    if (taskIds.length > 0) {
      await tx.task.updateMany({
        where: {
          id: {
            in: taskIds
          }
        },
        data: {
          deletedAt,
          deletedWithTaskListId: taskListId,
          deletedById: userId
        }
      });
    }

    await tx.taskList.update({
      where: {
        id: taskListId
      },
      data: {
        deletedAt,
        deletedById: userId
      }
    });
  });

  await publishProjectEvent(projectId, { type: "task.changed", projectId });
  await createActivityLog({
    actorId: userId,
    teamId: project.teamId,
    projectId,
    action: "task_list.deleted",
    targetType: "task_list",
    targetId: taskListId,
    metadata: {
      name: taskList.name,
      deletedTaskCount: taskIds.length
    }
  });

  return { ok: true };
}

export async function listProjectTrash(userId: string, projectId: string) {
  await requireProjectManager(userId, projectId);

  const taskLists = await prisma.taskList.findMany({
    where: {
      projectId,
      deletedAt: {
        not: null
      }
    },
    include: {
      deletedBy: {
        select: {
          id: true,
          name: true,
          email: true,
          avatarUrl: true
        }
      },
      _count: {
        select: {
          tasks: {
            where: {
              deletedWithTaskListId: {
                not: null
              }
            }
          }
        }
      }
    },
    orderBy: {
      deletedAt: "desc"
    }
  });

  const tasks = await prisma.task.findMany({
    where: {
      projectId,
      deletedAt: {
        not: null
      },
      deletedWithTaskListId: null,
      taskList: {
        deletedAt: null
      }
    },
    include: {
      taskList: {
        select: {
          id: true,
          name: true,
          deletedAt: true
        }
      },
      deletedBy: {
        select: {
          id: true,
          name: true,
          email: true,
          avatarUrl: true
        }
      },
      parent: {
        select: {
          id: true,
          title: true,
          deletedAt: true
        }
      }
    },
    orderBy: {
      deletedAt: "desc"
    }
  });

  return {
    taskLists: taskLists.map((taskList) => ({
      id: taskList.id,
      name: taskList.name,
      deletedAt: taskList.deletedAt,
      deletedBy: taskList.deletedBy,
      taskCount: taskList._count.tasks
    })),
    tasks: tasks.map(toTrashTask)
  };
}

export async function restoreTaskList(userId: string, projectId: string, taskListId: string) {
  const { project } = await requireProjectManager(userId, projectId);
  assertProjectActive(project);

  const taskList = await prisma.taskList.findFirst({
    where: {
      id: taskListId,
      projectId,
      deletedAt: {
        not: null
      }
    }
  });

  if (!taskList) {
    throw new AppError("RESOURCE_NOT_FOUND", "Task list not found in trash", 404);
  }

  await assertTaskListNameUnique(projectId, taskList.name, taskListId);

  const restoredTaskCount = await prisma.task.count({
    where: {
      taskListId,
      deletedWithTaskListId: taskListId
    }
  });

  await prisma.$transaction(async (tx) => {
    await tx.taskList.update({
      where: {
        id: taskListId
      },
      data: {
        deletedAt: null,
        deletedById: null
      }
    });

    await tx.task.updateMany({
      where: {
        taskListId,
        deletedWithTaskListId: taskListId
      },
      data: {
        deletedAt: null,
        deletedWithTaskListId: null,
        deletedById: null
      }
    });
  });

  await publishProjectEvent(projectId, { type: "task.changed", projectId });
  await createActivityLog({
    actorId: userId,
    teamId: project.teamId,
    projectId,
    action: "task_list.restored",
    targetType: "task_list",
    targetId: taskListId,
    metadata: {
      name: taskList.name,
      restoredTaskCount
    }
  });

  return { ok: true };
}

export async function purgeTaskList(userId: string, projectId: string, taskListId: string) {
  const { project } = await requireProjectManager(userId, projectId);
  assertProjectActive(project);

  const taskList = await prisma.taskList.findFirst({
    where: {
      id: taskListId,
      projectId,
      deletedAt: {
        not: null
      }
    }
  });

  if (!taskList) {
    throw new AppError("RESOURCE_NOT_FOUND", "Task list not found in trash", 404);
  }

  const taskIds = await getTaskListTaskIdsWithDescendants(taskListId, true);

  await prisma.$transaction(async (tx) => {
    await deleteTasksByIds(tx, taskIds);
    await tx.taskList.delete({
      where: {
        id: taskListId
      }
    });
  });

  await publishProjectEvent(projectId, { type: "task.changed", projectId });
  await createActivityLog({
    actorId: userId,
    teamId: project.teamId,
    projectId,
    action: "task_list.purged",
    targetType: "task_list",
    targetId: taskListId,
    metadata: {
      name: taskList.name,
      purgedTaskCount: taskIds.length
    }
  });

  return { ok: true };
}

async function getTaskIdsWithDescendants(taskId: string) {
  const taskIds = new Set([taskId]);
  let frontier = [taskId];

  while (frontier.length > 0) {
    const children = await prisma.task.findMany({
      where: {
        parentId: {
          in: frontier
        }
      },
      select: {
        id: true
      }
    });
    const nextFrontier = children
      .map((task) => task.id)
      .filter((childTaskId) => !taskIds.has(childTaskId));

    nextFrontier.forEach((childTaskId) => taskIds.add(childTaskId));
    frontier = nextFrontier;
  }

  return [...taskIds];
}

export async function restoreTask(userId: string, taskId: string) {
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      deletedAt: {
        not: null
      },
      deletedWithTaskListId: null
    },
    include: {
      taskList: true,
      parent: true
    }
  });

  if (!task) {
    throw new AppError("RESOURCE_NOT_FOUND", "Task not found in trash", 404);
  }

  const { project } = await requireProjectManager(userId, task.projectId);
  assertProjectActive(project);

  if (task.taskList.deletedAt) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "Task list must be restored first", 422);
  }

  if (task.parent?.deletedAt) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "Parent task must be restored first", 422);
  }

  await prisma.task.update({
    where: {
      id: taskId
    },
    data: {
      deletedAt: null,
      deletedById: null
    }
  });

  await publishProjectEvent(task.projectId, { type: "task.changed", projectId: task.projectId, taskId });
  await createActivityLog({
    actorId: userId,
    teamId: project.teamId,
    projectId: task.projectId,
    taskId,
    action: "task.restored",
    targetType: "task",
    targetId: taskId,
    metadata: {
      title: task.title
    }
  });

  return { ok: true };
}

export async function purgeTask(userId: string, taskId: string) {
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      deletedAt: {
        not: null
      }
    }
  });

  if (!task) {
    throw new AppError("RESOURCE_NOT_FOUND", "Task not found in trash", 404);
  }

  const { project } = await requireProjectManager(userId, task.projectId);
  assertProjectActive(project);
  const taskIds = await getTaskIdsWithDescendants(taskId);

  await prisma.$transaction(async (tx) => {
    await deleteTasksByIds(tx, taskIds);
  });

  await publishProjectEvent(task.projectId, { type: "task.changed", projectId: task.projectId, taskId });
  await createActivityLog({
    actorId: userId,
    teamId: project.teamId,
    projectId: task.projectId,
    taskId,
    action: "task.purged",
    targetType: "task",
    targetId: taskId,
    metadata: {
      title: task.title,
      purgedTaskCount: taskIds.length
    }
  });

  return { ok: true };
}

export async function reorderTaskLists(
  userId: string,
  projectId: string,
  input: ReorderTaskListsInput
) {
  const { project } = await requireProjectManager(userId, projectId);
  assertProjectActive(project);

  const taskLists = await prisma.taskList.findMany({
    where: {
      projectId,
      deletedAt: null,
      id: {
        in: input.items.map((item) => item.id)
      }
    }
  });

  if (taskLists.length !== input.items.length) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "All task lists must belong to this project", 422);
  }

  if (taskLists.some((taskList) => taskList.isDefault)) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "Default task list cannot be edited", 422);
  }

  await prisma.$transaction(
    input.items.map((item) =>
      prisma.taskList.update({
        where: {
          id: item.id
        },
        data: {
          sortKey: new Prisma.Decimal(item.sortKey)
        }
      })
    )
  );

  await publishProjectEvent(projectId, { type: "task.changed", projectId });
  await createActivityLog({
    actorId: userId,
    teamId: project.teamId,
    projectId,
    action: "task_list.reordered",
    targetType: "task_list",
    metadata: {
      itemCount: input.items.length
    }
  });

  return { ok: true };
}

export async function createTask(userId: string, projectId: string, input: CreateTaskInput) {
  const { project } = await requireActiveProjectEditor(userId, projectId);
  const projectMemberIds = normalizeProjectMemberIds(input);
  const normalizedDates = normalizeTaskDateRange(input.startDate, input.dueDate);
  assertValidDateRange(normalizedDates.startDate, normalizedDates.dueDate);
  const taskList = input.taskListId
    ? await assertTaskListInProject(input.taskListId, projectId)
    : await getOrCreateDefaultTaskList(projectId);
  const taskStatus = input.status ?? TaskStatus.TODO;
  await assertAssigneesAreProjectMembers(projectMemberIds, projectId);
  await assertTagsInProject(input.tagIds, projectId);
  await assertV01ParentTask(input.parentId, projectId);

  const task = await prisma.task.create({
    data: {
      title: input.title,
      description: input.description,
      status: taskStatus,
      priority: input.priority,
      startDate: normalizedDates.startDate,
      dueDate: normalizedDates.dueDate,
      taskListId: taskList.id,
      projectId,
      creatorId: userId,
      parentId: input.parentId,
      ...getCompletionPatch({ nextStatus: taskStatus, userId }),
      sortKey: await getNextSortKey(taskList.id),
      tags: {
        create: input.tagIds.map((tagId) => ({
          tagId
        }))
      }
    }
  });

  await replaceTaskAssignees(prisma, task.id, projectMemberIds);

  await createTaskAssignedNotifications({
    actorId: userId,
    projectId,
    taskId: task.id,
    taskTitle: task.title,
    projectMemberIds
  });

  await publishProjectEvent(projectId, { type: "task.changed", projectId, taskId: task.id });
  await createActivityLog({
    actorId: userId,
    teamId: project.teamId,
    projectId,
    taskId: task.id,
    action: "task.created",
    targetType: "task",
    targetId: task.id,
    metadata: {
      title: task.title,
      parentId: task.parentId,
      taskListId: task.taskListId,
      projectMemberIds
    }
  });

  const assigneeMap = await getTaskAssigneeMap([task.id]);
  return toTask(attachAssignees(task, assigneeMap));
}

export async function getTask(userId: string, taskId: string) {
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      deletedAt: null
    },
    include: {
      subTasks: {
        where: {
          deletedAt: null
        },
        include: {
          completedBy: true
        },
        orderBy: {
          sortKey: "asc"
        }
      },
      comments: {
        where: {
          deletedAt: null
        },
        include: {
          author: true,
          mentions: {
            include: {
              user: true
            }
          }
        },
        orderBy: {
          createdAt: "asc"
        }
      },
      tags: {
        include: {
          tag: true
        }
      },
      completedBy: true
    }
  });

  if (!task) {
    throw new AppError("RESOURCE_NOT_FOUND", "Task not found", 404);
  }

  await requireProjectAccess(userId, task.projectId);

  const assigneeMap = await getTaskAssigneeMap([task.id, ...task.subTasks.map((subTask) => subTask.id)]);
  const parentTrail = await getTaskParentTrail(task.parentId, task.projectId);

  return {
    ...toTask(attachAssignees(task, assigneeMap)),
    parentTrail,
    subTasks: task.subTasks.map((subTask) => toTask(attachAssignees(subTask, assigneeMap))),
    tags: task.tags.map(({ tag }) => tag),
    comments: task.comments.map((comment) => ({
      id: comment.id,
      content: comment.content,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      author: {
        id: comment.author.id,
        name: comment.author.name,
        avatarUrl: comment.author.avatarUrl
      },
      mentions: comment.mentions.map((mention) => ({
        id: mention.user.id,
        name: mention.user.name,
        avatarUrl: mention.user.avatarUrl
      }))
    }))
  };
}

export async function updateTask(userId: string, taskId: string, input: UpdateTaskInput) {
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      deletedAt: null
    },
    include: {
      taskList: true
    }
  });

  if (!task) {
    throw new AppError("RESOURCE_NOT_FOUND", "Task not found", 404);
  }

  const { project } = await requireActiveProjectEditor(userId, task.projectId);
  const shouldUpdateAssignees = input.projectMemberIds !== undefined;
  const projectMemberIds = shouldUpdateAssignees ? normalizeProjectMemberIds(input) : undefined;
  const previousProjectMemberMap = await getTaskAssigneeMap([taskId]);
  const previousProjectMemberIds = new Set([
    ...(previousProjectMemberMap.get(taskId)?.map((assignee) => assignee.projectMemberId).filter((id): id is string => Boolean(id)) ?? [])
  ]);
  const shouldUpdateDates = input.startDate !== undefined || input.dueDate !== undefined;
  const nextDates = normalizeTaskDateRange(
    input.startDate !== undefined ? input.startDate : task.startDate,
    input.dueDate !== undefined ? input.dueDate : task.dueDate
  );
  assertValidDateRange(nextDates.startDate, nextDates.dueDate);
  if (projectMemberIds) {
    await assertAssigneesAreProjectMembers(projectMemberIds, task.projectId, [...previousProjectMemberIds]);
  }
  await assertTagsInProject(input.tagIds, task.projectId);

  const updatedTask = await prisma.$transaction(async (tx) => {
    const result = await tx.task.update({
      where: {
        id: taskId
      },
      data: {
        title: input.title,
        description: input.description,
        status: input.status,
        priority: input.priority,
        ...(shouldUpdateDates
          ? {
              startDate: nextDates.startDate,
              dueDate: nextDates.dueDate
            }
          : {}),
        ...(input.status
          ? getCompletionPatch({
              nextStatus: input.status,
              currentStatus: task.status,
              userId
            })
          : {})
      },
      include: {
        completedBy: true
      }
    });

    if (projectMemberIds) {
      await replaceTaskAssignees(tx, taskId, projectMemberIds);
    }

    if (input.tagIds) {
      await tx.taskTag.deleteMany({
        where: {
          taskId
        }
      });
      await tx.taskTag.createMany({
        data: input.tagIds.map((tagId) => ({
          taskId,
          tagId
        }))
      });
    }

    return result;
  });

  const addedProjectMemberIds = projectMemberIds?.filter((projectMemberId) => !previousProjectMemberIds.has(projectMemberId)) ?? [];
  const hasStatusChanged = Boolean(input.status && input.status !== task.status);

  await createTaskAssignedNotifications({
    actorId: userId,
    projectId: task.projectId,
    taskId,
    taskTitle: updatedTask.title,
    projectMemberIds: addedProjectMemberIds,
    dedupeSuffix: updatedTask.updatedAt.toISOString()
  });

  if (hasStatusChanged && input.status) {
    try {
      const recipientIds = await filterActiveProjectRecipients(
        task.projectId,
        await getActiveTaskAssigneeUserIds(taskId)
      );

      await Promise.all(
        recipientIds.map((recipientId) =>
          createNotification({
            type: NotificationType.TASK_STATUS_CHANGED,
            recipientId,
            actorId: userId,
            projectId: task.projectId,
            taskId,
            title: "任务状态已变更",
            content: `${updatedTask.title}: ${getTaskStatusLabel(task.status)} -> ${getTaskStatusLabel(input.status!)}`,
            dedupeKey: `task_status_changed:${taskId}:${recipientId}:${task.status}:${input.status}:${updatedTask.updatedAt.toISOString()}`,
            skipActor: true
          })
        )
      );
    } catch (error) {
      logger.error(
        { err: error, taskId, projectId: task.projectId },
        "Failed to create task status change notifications"
      );
    }
  }

  await publishProjectEvent(task.projectId, { type: "task.changed", projectId: task.projectId, taskId });
  await createActivityLog({
    actorId: userId,
    teamId: project.teamId,
    projectId: task.projectId,
    taskId,
    action: hasStatusChanged ? "task.status_changed" : "task.updated",
    targetType: "task",
    targetId: taskId,
    metadata: {
      title: updatedTask.title,
      fromStatus: hasStatusChanged ? task.status : undefined,
      toStatus: hasStatusChanged ? input.status : undefined,
      projectMemberIds: projectMemberIds ?? undefined,
      addedProjectMemberIds
    }
  });

  const assigneeMap = await getTaskAssigneeMap([updatedTask.id]);
  return toTask(attachAssignees(updatedTask, assigneeMap));
}

export async function moveTask(userId: string, taskId: string, input: MoveTaskInput) {
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      deletedAt: null
    },
    include: {
      taskList: true
    }
  });

  if (!task) {
    throw new AppError("RESOURCE_NOT_FOUND", "Task not found", 404);
  }

  const { project } = await requireActiveProjectEditor(userId, task.projectId);
  const targetList = await assertTaskListInProject(input.targetTaskListId, task.projectId);
  const hasListChanged = task.taskListId !== input.targetTaskListId;

  const updatedTask = await prisma.task.update({
    where: {
      id: taskId
    },
    data: {
      taskListId: input.targetTaskListId,
      sortKey: new Prisma.Decimal(input.sortKey)
    },
    include: {
      completedBy: true
    }
  });

  await publishProjectEvent(task.projectId, { type: "task.changed", projectId: task.projectId, taskId });
  await createActivityLog({
    actorId: userId,
    teamId: project.teamId,
    projectId: task.projectId,
    taskId,
    action: hasListChanged ? "task.moved" : "task.updated",
    targetType: "task",
    targetId: taskId,
    metadata: {
      title: updatedTask.title,
      fromTaskListId: task.taskListId,
      toTaskListId: input.targetTaskListId,
      fromTaskListName: task.taskList.name,
      toTaskListName: targetList.name
    }
  });

  const assigneeMap = await getTaskAssigneeMap([updatedTask.id]);
  return toTask(attachAssignees(updatedTask, assigneeMap));
}

export async function deleteTask(userId: string, taskId: string) {
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      deletedAt: null
    },
    include: {
      _count: {
        select: {
          subTasks: {
            where: {
              deletedAt: null
            }
          }
        }
      }
    }
  });

  if (!task) {
    throw new AppError("RESOURCE_NOT_FOUND", "Task not found", 404);
  }

  const { project } = await requireActiveProjectEditor(userId, task.projectId);
  assertTaskDeletable({ subTaskCount: task._count.subTasks });

  await prisma.task.update({
    where: {
      id: taskId
    },
    data: {
      deletedAt: new Date(),
      deletedWithTaskListId: null,
      deletedById: userId
    }
  });

  await publishProjectEvent(task.projectId, { type: "task.changed", projectId: task.projectId, taskId });
  await createActivityLog({
    actorId: userId,
    teamId: project.teamId,
    projectId: task.projectId,
    taskId,
    action: "task.deleted",
    targetType: "task",
    targetId: taskId,
    metadata: {
      title: task.title
    }
  });

  return { ok: true };
}

export async function createComment(userId: string, taskId: string, input: CreateCommentInput) {
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      deletedAt: null
    }
  });

  if (!task) {
    throw new AppError("RESOURCE_NOT_FOUND", "Task not found", 404);
  }

  const { project } = await requireActiveProjectEditor(userId, task.projectId);
  const requestedMentionIds = [...new Set(input.mentionIds)];
  const requestedMentionMembers = requestedMentionIds.length > 0
    ? await prisma.projectMember.findMany({
        where: {
          projectId: task.projectId,
          userId: {
            in: requestedMentionIds
          }
        },
        select: {
          userId: true
        }
      })
    : [];

  if (requestedMentionMembers.length !== requestedMentionIds.length) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "Mentioned user must be a project member", 422);
  }

  const projectMembers = await prisma.projectMember.findMany({
    where: {
      projectId: task.projectId,
      userId: {
        not: null
      }
    },
    include: {
      user: true
    }
  });
  const contentMentionIds = projectMembers
    .filter((member) => {
      if (!member.user) {
        return false;
      }
      const user = member.user;
      const nameToken = `@${user.name}`;
      const emailToken = `@${user.email}`;
      return input.content.includes(nameToken) || input.content.includes(emailToken);
    })
    .map((member) => member.userId)
    .filter((mentionedUserId): mentionedUserId is string => Boolean(mentionedUserId));
  const mentionIds = [...new Set([...requestedMentionIds, ...contentMentionIds])];

  const comment = await prisma.$transaction(async (tx) =>
    tx.comment.create({
      data: {
        content: input.content,
        taskId,
        authorId: userId,
        mentions: {
          create: mentionIds.map((mentionedUserId) => ({
            userId: mentionedUserId
          }))
        }
      },
      include: {
        author: true,
        mentions: {
          include: {
            user: true
          }
        }
      }
    })
  );

  const mentionedUserIds = await createMentionNotifications({
    actorId: userId,
    projectId: task.projectId,
    taskId,
    taskTitle: task.title,
    commentId: comment.id,
    content: input.content,
    mentionIds
  });
  await createTaskCommentNotifications({
    actorId: userId,
    projectId: task.projectId,
    taskId,
    taskTitle: task.title,
    commentId: comment.id,
    creatorId: task.creatorId,
    content: input.content,
    excludeUserIds: mentionedUserIds
  });

  await publishProjectEvent(task.projectId, { type: "task.changed", projectId: task.projectId, taskId });
  await createActivityLog({
    actorId: userId,
    teamId: project.teamId,
    projectId: task.projectId,
    taskId,
    action: "comment.created",
    targetType: "comment",
    targetId: comment.id,
    metadata: {
      taskTitle: task.title,
      contentPreview: comment.content.slice(0, 120)
    }
  });

  return {
    id: comment.id,
    content: comment.content,
    createdAt: comment.createdAt,
    author: {
      id: comment.author.id,
      name: comment.author.name,
      avatarUrl: comment.author.avatarUrl
    },
    mentions: comment.mentions.map((mention) => ({
      id: mention.user.id,
      name: mention.user.name,
      avatarUrl: mention.user.avatarUrl
    }))
  };
}

export async function deleteComment(userId: string, taskId: string, commentId: string) {
  const comment = await prisma.comment.findFirst({
    where: {
      id: commentId,
      taskId,
      deletedAt: null,
      task: {
        deletedAt: null
      }
    },
    include: {
      task: true
    }
  });

  if (!comment) {
    throw new AppError("RESOURCE_NOT_FOUND", "Comment not found", 404);
  }

  const access = await requireProjectAccess(userId, comment.task.projectId);
  assertProjectActive(access.project);
  const canDelete =
    comment.authorId === userId ||
    access.isTeamAdmin ||
    access.projectMember?.role === ProjectRole.ADMIN;

  if (!canDelete) {
    throw new AppError("FORBIDDEN", "Comment delete permission is required", 403);
  }

  await prisma.comment.update({
    where: {
      id: commentId
    },
    data: {
      deletedAt: new Date()
    }
  });

  await publishProjectEvent(comment.task.projectId, {
    type: "task.changed",
    projectId: comment.task.projectId,
    taskId
  });
  await createActivityLog({
    actorId: userId,
    teamId: access.project.teamId,
    projectId: comment.task.projectId,
    taskId,
    action: "comment.deleted",
    targetType: "comment",
    targetId: commentId,
    metadata: {
      taskTitle: comment.task.title,
      contentPreview: comment.content.slice(0, 120)
    }
  });

  return { ok: true };
}

async function createMentionNotifications(input: {
  actorId: string;
  projectId: string;
  taskId: string;
  taskTitle: string;
  commentId: string;
  content: string;
  mentionIds: string[];
}) {
  const mentionedUserIds = [...new Set(input.mentionIds)];

  await Promise.all(
    mentionedUserIds.map((recipientId) =>
      createNotification({
        type: NotificationType.COMMENT_MENTION,
        recipientId,
        actorId: input.actorId,
        projectId: input.projectId,
        taskId: input.taskId,
        title: "评论中提到了你",
        content: `${input.taskTitle}: ${input.content.slice(0, 120)}`,
        dedupeKey: `comment_mention:${input.taskId}:${input.commentId}:${recipientId}`,
        skipActor: true
      })
    )
  );

  return mentionedUserIds;
}

async function createTaskCommentNotifications(input: {
  actorId: string;
  projectId: string;
  taskId: string;
  taskTitle: string;
  commentId: string;
  creatorId: string;
  content: string;
  excludeUserIds: string[];
}) {
  const assigneeUserIds = await getActiveTaskAssigneeUserIds(input.taskId);
  const recipientIds = await filterActiveProjectRecipients(input.projectId, [
    input.creatorId,
    ...assigneeUserIds
  ]);
  const excludedUserIds = new Set(input.excludeUserIds);

  await Promise.all(
    recipientIds
      .filter((recipientId) => recipientId !== input.actorId && !excludedUserIds.has(recipientId))
      .map((recipientId) =>
        createNotification({
          type: NotificationType.TASK_COMMENTED,
          recipientId,
          actorId: input.actorId,
          projectId: input.projectId,
          taskId: input.taskId,
          title: "任务有新评论",
          content: `${input.taskTitle}: ${input.content.slice(0, 120)}`,
          dedupeKey: `task_commented:${input.taskId}:${input.commentId}:${recipientId}`
        })
      )
  );
}

export async function listComments(userId: string, taskId: string) {
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      deletedAt: null
    }
  });

  if (!task) {
    throw new AppError("RESOURCE_NOT_FOUND", "Task not found", 404);
  }

  await requireProjectAccess(userId, task.projectId);

  const comments = await prisma.comment.findMany({
    where: {
      taskId,
      deletedAt: null
    },
    include: {
      author: true,
      mentions: {
        include: {
          user: true
        }
      }
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  return comments.map((comment) => ({
    id: comment.id,
    content: comment.content,
    createdAt: comment.createdAt,
    author: {
      id: comment.author.id,
      name: comment.author.name,
      avatarUrl: comment.author.avatarUrl
    },
    mentions: comment.mentions.map((mention) => ({
      id: mention.user.id,
      name: mention.user.name,
      avatarUrl: mention.user.avatarUrl
    }))
  }));
}
