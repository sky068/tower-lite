import { DeliveryChannel, NotificationType, Prisma, ProjectRole, TaskListType } from "@prisma/client";
import { logger } from "../../config/logger.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../middleware/error-handler.js";
import { createActivityLog } from "../activity/activity.service.js";
import {
  assertProjectActive,
  requireActiveProjectEditor,
  requireProjectAccess,
  requireProjectManager
} from "../projects/project.policy.js";
import { publishProjectEvent, publishToUser } from "../realtime/realtime.service.js";
import {
  assertCustomTaskListName,
  assertTaskListEditable,
  assertTaskListDeletable,
  assertTaskDeletable,
  assertV01SubTaskParent,
  assertValidDateRange
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
  type: TaskListType;
  sortKey: Prisma.Decimal;
  tasks?: Array<ReturnType<typeof toTask>>;
}) {
  return {
    id: taskList.id,
    name: taskList.name,
    type: taskList.type,
    sortKey: taskList.sortKey.toString(),
    tasks: taskList.tasks ?? []
  };
}

function toTask(task: {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  sortKey: Prisma.Decimal;
  startDate: Date | null;
  dueDate: Date | null;
  taskListId: string;
  projectId: string;
  creatorId: string;
  parentId: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  assignees?: Array<{
    user: {
      id: string;
      name: string;
      avatarUrl: string | null;
      isRemoved?: boolean;
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
    priority: task.priority,
    sortKey: task.sortKey.toString(),
    startDate: task.startDate,
    dueDate: task.dueDate,
    taskListId: task.taskListId,
    projectId: task.projectId,
    creatorId: task.creatorId,
    parentId: task.parentId,
    completedAt: task.completedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    assignees:
      task.assignees?.map(({ user }) => ({
        id: user.id,
        name: user.name,
        avatarUrl: user.avatarUrl,
        isRemoved: user.isRemoved
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
      projectId
    }
  });

  if (!taskList) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "Task list does not belong to this project", 422);
  }

  return taskList;
}

function normalizeAssigneeIds(input: { assigneeIds?: string[] }) {
  return [...new Set(input.assigneeIds ?? [])];
}

async function assertAssigneesAreProjectMembers(
  assigneeIds: string[],
  projectId: string,
  existingAssigneeIds: string[] = []
) {
  if (assigneeIds.length === 0) {
    return;
  }

  const existingAssigneeSet = new Set(existingAssigneeIds);
  const assigneeIdsToValidate = assigneeIds.filter((assigneeId) => !existingAssigneeSet.has(assigneeId));

  if (assigneeIdsToValidate.length === 0) {
    return;
  }

  const count = await prisma.projectMember.count({
    where: {
      projectId,
      userId: {
        in: assigneeIdsToValidate
      }
    }
  });

  if (count !== assigneeIdsToValidate.length) {
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

async function createNotification(input: {
  type: NotificationType;
  recipientId: string;
  actorId: string;
  projectId: string;
  taskId: string;
  title: string;
  content: string;
  dedupeKey: string;
  skipActor?: boolean;
}) {
  if (input.skipActor && input.recipientId === input.actorId) {
    return;
  }

  try {
    await prisma.notification.upsert({
      where: {
        dedupeKey: input.dedupeKey
      },
      update: {},
      create: {
        type: input.type,
        title: input.title,
        content: input.content,
        link: `/tasks/${input.taskId}`,
        recipientId: input.recipientId,
        actorId: input.actorId,
        projectId: input.projectId,
        taskId: input.taskId,
        dedupeKey: input.dedupeKey,
        deliveries: {
          create: {
            channel: DeliveryChannel.IN_APP,
            status: "SENT",
            sentAt: new Date()
          }
        }
      }
    });
    publishToUser(input.recipientId, { type: "notification.changed" });
  } catch (error) {
    logger.error(
      {
        err: error,
        type: input.type,
        recipientId: input.recipientId,
        taskId: input.taskId
      },
      "Failed to create task notification"
    );
  }
}

type TaskAssigneeUser = {
  taskId: string;
  userId: string;
  name: string;
  avatarUrl: string | null;
  isRemoved: boolean;
};

async function getTaskAssigneeMap(taskIds: string[]) {
  if (taskIds.length === 0) {
    return new Map<string, TaskAssigneeUser[]>();
  }

  const rows = await prisma.$queryRaw<TaskAssigneeUser[]>`
    SELECT
      ta."taskId",
      u."id" AS "userId",
      u."name",
      u."avatarUrl",
      CASE WHEN pm."id" IS NULL THEN TRUE ELSE FALSE END AS "isRemoved"
    FROM "TaskAssignee" ta
    JOIN "Task" task ON task."id" = ta."taskId"
    JOIN "User" u ON u."id" = ta."userId"
    LEFT JOIN "ProjectMember" pm
      ON pm."projectId" = task."projectId"
      AND pm."userId" = ta."userId"
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
      id: user.userId,
      name: user.name,
      avatarUrl: user.avatarUrl,
      isRemoved: user.isRemoved
    }
  }));

  return {
    ...task,
    assignees
  };
}

async function replaceTaskAssignees(
  tx: Prisma.TransactionClient,
  taskId: string,
  assigneeIds: string[]
) {
  await tx.$executeRaw`DELETE FROM "TaskAssignee" WHERE "taskId" = ${taskId}`;

  await Promise.all(
    assigneeIds.map((assigneeId) =>
      tx.$executeRaw`
        INSERT INTO "TaskAssignee" ("taskId", "userId")
        VALUES (${taskId}, ${assigneeId})
        ON CONFLICT DO NOTHING
      `
    )
  );
}

async function filterActiveProjectRecipients(projectId: string, userIds: string[]) {
  const uniqueUserIds = [...new Set(userIds)];

  if (uniqueUserIds.length === 0) {
    return [];
  }

  const rows = await prisma.$queryRaw<Array<{ userId: string }>>`
    SELECT DISTINCT candidate."userId"
    FROM (
      SELECT UNNEST(ARRAY[${Prisma.join(uniqueUserIds)}]::text[]) AS "userId"
    ) candidate
    JOIN "Project" project ON project."id" = ${projectId}
    JOIN "TeamMember" team_member
      ON team_member."teamId" = project."teamId"
      AND team_member."userId" = candidate."userId"
    LEFT JOIN "ProjectMember" project_member
      ON project_member."projectId" = project."id"
      AND project_member."userId" = candidate."userId"
    WHERE project."deletedAt" IS NULL
      AND (
        team_member."role" IN ('OWNER', 'ADMIN')
        OR project_member."id" IS NOT NULL
      )
  `;

  const activeUserIds = new Set(rows.map((row) => row.userId));
  return uniqueUserIds.filter((userId) => activeUserIds.has(userId));
}

async function getActiveTaskAssigneeIds(taskId: string) {
  const assigneeMap = await getTaskAssigneeMap([taskId]);
  return assigneeMap.get(taskId)
    ?.filter((assignee) => !assignee.isRemoved)
    .map((assignee) => assignee.userId) ?? [];
}

async function createTaskAssignedNotifications(input: {
  actorId: string;
  projectId: string;
  taskId: string;
  taskTitle: string;
  assigneeIds: string[];
  dedupeSuffix?: string;
}) {
  const recipientIds = await filterActiveProjectRecipients(input.projectId, input.assigneeIds);

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
      projectId
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
  assertCustomTaskListName(input.name);

  const lastList = await prisma.taskList.findFirst({
    where: {
      projectId
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
  const taskList = await assertTaskListInProject(taskListId, projectId);
  assertTaskListEditable(taskList);
  assertCustomTaskListName(input.name);

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

export async function deleteTaskList(
  userId: string,
  projectId: string,
  taskListId: string,
  input: DeleteTaskListInput
) {
  const { project } = await requireProjectManager(userId, projectId);
  const taskList = await assertTaskListInProject(taskListId, projectId);
  assertTaskListDeletable(taskList);

  const listCount = await prisma.taskList.count({
    where: {
      projectId
    }
  });

  if (listCount <= 1) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "Project must keep at least one task list", 422);
  }

  const taskCount = await prisma.task.count({
    where: {
      taskListId,
      deletedAt: null
    }
  });

  if (taskCount > 0 && !input.targetTaskListId) {
    throw new AppError(
      "BUSINESS_RULE_VIOLATION",
      "Target task list is required when deleting a non-empty list",
      422
    );
  }

  const targetTaskList = input.targetTaskListId
    ? await assertTaskListInProject(input.targetTaskListId, projectId)
    : null;

  if (input.targetTaskListId) {
    if (input.targetTaskListId === taskListId) {
      throw new AppError("BUSINESS_RULE_VIOLATION", "Target task list must be different", 422);
    }
  }

  await prisma.$transaction(async (tx) => {
    if (input.targetTaskListId && targetTaskList) {
      await tx.task.updateMany({
        where: {
          taskListId
        },
        data: {
          taskListId: input.targetTaskListId,
          completedAt: targetTaskList.type === TaskListType.DONE ? new Date() : null
        }
      });
    }

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
    action: "task_list.deleted",
    targetType: "task_list",
    targetId: taskListId,
    metadata: {
      name: taskList.name,
      targetTaskListId: input.targetTaskListId ?? null
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

  const taskLists = await prisma.taskList.findMany({
    where: {
      projectId,
      id: {
        in: input.items.map((item) => item.id)
      }
    }
  });

  if (taskLists.length !== input.items.length) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "All task lists must belong to this project", 422);
  }

  for (const taskList of taskLists) {
    assertTaskListEditable(taskList);
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
  const assigneeIds = normalizeAssigneeIds(input);
  assertValidDateRange(input.startDate, input.dueDate);
  const taskList = await assertTaskListInProject(input.taskListId, projectId);
  await assertAssigneesAreProjectMembers(assigneeIds, projectId);
  await assertTagsInProject(input.tagIds, projectId);
  await assertV01ParentTask(input.parentId, projectId);

  const task = await prisma.task.create({
    data: {
      title: input.title,
      description: input.description,
      priority: input.priority,
      startDate: input.startDate,
      dueDate: input.dueDate,
      taskListId: input.taskListId,
      projectId,
      creatorId: userId,
      parentId: input.parentId,
      completedAt: taskList.type === TaskListType.DONE ? new Date() : null,
      sortKey: await getNextSortKey(input.taskListId),
      tags: {
        create: input.tagIds.map((tagId) => ({
          tagId
        }))
      }
    }
  });

  await replaceTaskAssignees(prisma, task.id, assigneeIds);

  await createTaskAssignedNotifications({
    actorId: userId,
    projectId,
    taskId: task.id,
    taskTitle: task.title,
    assigneeIds
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
      assigneeIds
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
        orderBy: {
          sortKey: "asc"
        }
      },
      comments: {
        where: {
          deletedAt: null
        },
        include: {
          author: true
        },
        orderBy: {
          createdAt: "asc"
        }
      },
      tags: {
        include: {
          tag: true
        }
      }
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
      }
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
  const shouldUpdateAssignees = input.assigneeIds !== undefined;
  const assigneeIds = shouldUpdateAssignees ? normalizeAssigneeIds(input) : undefined;
  const previousAssigneeMap = await getTaskAssigneeMap([taskId]);
  const previousAssigneeIds = new Set([
    ...(previousAssigneeMap.get(taskId)?.map((assignee) => assignee.userId) ?? [])
  ]);
  assertValidDateRange(input.startDate ?? task.startDate, input.dueDate ?? task.dueDate);
  if (assigneeIds) {
    await assertAssigneesAreProjectMembers(assigneeIds, task.projectId, [...previousAssigneeIds]);
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
        priority: input.priority,
        startDate: input.startDate,
        dueDate: input.dueDate
      }
    });

    if (assigneeIds) {
      await replaceTaskAssignees(tx, taskId, assigneeIds);
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

  const addedAssigneeIds = assigneeIds?.filter((assigneeId) => !previousAssigneeIds.has(assigneeId)) ?? [];

  await createTaskAssignedNotifications({
    actorId: userId,
    projectId: task.projectId,
    taskId,
    taskTitle: updatedTask.title,
    assigneeIds: addedAssigneeIds,
    dedupeSuffix: updatedTask.updatedAt.toISOString()
  });

  await publishProjectEvent(task.projectId, { type: "task.changed", projectId: task.projectId, taskId });
  await createActivityLog({
    actorId: userId,
    teamId: project.teamId,
    projectId: task.projectId,
    taskId,
    action: "task.updated",
    targetType: "task",
    targetId: taskId,
    metadata: {
      title: updatedTask.title,
      assigneeIds: assigneeIds ?? undefined,
      addedAssigneeIds
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
  const hasStatusChanged = task.taskListId !== input.targetTaskListId;

  const updatedTask = await prisma.task.update({
    where: {
      id: taskId
    },
    data: {
      taskListId: input.targetTaskListId,
      sortKey: new Prisma.Decimal(input.sortKey),
      completedAt:
        targetList.type === TaskListType.DONE
          ? task.completedAt ?? new Date()
          : null
    }
  });

  if (hasStatusChanged) {
    try {
      const recipientIds = await filterActiveProjectRecipients(
        task.projectId,
        await getActiveTaskAssigneeIds(taskId)
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
            content: `${updatedTask.title}: ${task.taskList.name} -> ${targetList.name}`,
            dedupeKey: `task_status_changed:${taskId}:${recipientId}:${task.taskListId}:${input.targetTaskListId}:${updatedTask.updatedAt.toISOString()}`,
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
    action: hasStatusChanged ? "task.status_changed" : "task.moved",
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
      deletedAt: new Date()
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

  const comment = await prisma.comment.create({
    data: {
      content: input.content,
      taskId,
      authorId: userId
    },
    include: {
      author: true
    }
  });

  const mentionedUserIds = await createMentionNotifications({
    actorId: userId,
    projectId: task.projectId,
    taskId,
    commentId: comment.id,
    content: input.content
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
    }
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
    access.projectMember?.role === ProjectRole.OWNER;

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
  commentId: string;
  content: string;
}) {
  const members = await prisma.projectMember.findMany({
    where: {
      projectId: input.projectId
    },
    include: {
      user: true
    }
  });

  const mentionedMembers = members.filter((member) => {
    const nameToken = `@${member.user.name}`;
    const emailToken = `@${member.user.email}`;
    return input.content.includes(nameToken) || input.content.includes(emailToken);
  });

  await Promise.all(
    mentionedMembers.map((member) =>
      createNotification({
        type: NotificationType.COMMENT_MENTION,
        recipientId: member.userId,
        actorId: input.actorId,
        projectId: input.projectId,
        taskId: input.taskId,
        title: "评论中提到了你",
        content: input.content.slice(0, 120),
        dedupeKey: `comment_mention:${input.taskId}:${input.commentId}:${member.userId}`,
        skipActor: true
      })
    )
  );

  return mentionedMembers.map((member) => member.userId);
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
  const assigneeIds = await getActiveTaskAssigneeIds(input.taskId);
  const recipientIds = await filterActiveProjectRecipients(input.projectId, [
    input.creatorId,
    ...assigneeIds
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
      author: true
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
    }
  }));
}
