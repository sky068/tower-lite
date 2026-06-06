import { DeliveryChannel, NotificationType, Prisma, TaskListType } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../middleware/error-handler.js";
import { requireProjectAccess, requireProjectEditor } from "../projects/project.policy.js";
import { assertV0SubTaskParent, assertValidDateRange } from "./task.rules.js";
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
  assigneeId: string | null;
  creatorId: string;
  parentId: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
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
    assigneeId: task.assigneeId,
    creatorId: task.creatorId,
    parentId: task.parentId,
    completedAt: task.completedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
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

async function assertAssigneeIsProjectMember(assigneeId: string | undefined | null, projectId: string) {
  if (!assigneeId) {
    return;
  }

  const member = await prisma.projectMember.findUnique({
    where: {
      projectId_userId: {
        projectId,
        userId: assigneeId
      }
    }
  });

  if (!member) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "Assignee must be a project member", 422);
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

async function assertV0ParentTask(parentId: string | undefined, projectId: string) {
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

  assertV0SubTaskParent(parentTask);
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
}) {
  if (input.recipientId === input.actorId) {
    return;
  }

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
        orderBy: {
          sortKey: "asc"
        }
      }
    },
    orderBy: {
      sortKey: "asc"
    }
  });

  return lists.map((list) =>
    toTaskList({
      ...list,
      tasks: list.tasks.map(toTask)
    })
  );
}

export async function createTaskList(userId: string, projectId: string, input: CreateTaskListInput) {
  await requireProjectEditor(userId, projectId);

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

  return toTaskList(taskList);
}

export async function updateTaskList(
  userId: string,
  projectId: string,
  taskListId: string,
  input: UpdateTaskListInput
) {
  await requireProjectEditor(userId, projectId);
  await assertTaskListInProject(taskListId, projectId);

  const taskList = await prisma.taskList.update({
    where: {
      id: taskListId
    },
    data: {
      name: input.name
    }
  });

  return toTaskList(taskList);
}

export async function deleteTaskList(
  userId: string,
  projectId: string,
  taskListId: string,
  input: DeleteTaskListInput
) {
  await requireProjectEditor(userId, projectId);
  await assertTaskListInProject(taskListId, projectId);

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

  if (input.targetTaskListId) {
    if (input.targetTaskListId === taskListId) {
      throw new AppError("BUSINESS_RULE_VIOLATION", "Target task list must be different", 422);
    }

    await assertTaskListInProject(input.targetTaskListId, projectId);
  }

  await prisma.$transaction(async (tx) => {
    if (input.targetTaskListId) {
      await tx.task.updateMany({
        where: {
          taskListId
        },
        data: {
          taskListId: input.targetTaskListId
        }
      });
    }

    await tx.taskList.delete({
      where: {
        id: taskListId
      }
    });
  });

  return { ok: true };
}

export async function reorderTaskLists(
  userId: string,
  projectId: string,
  input: ReorderTaskListsInput
) {
  await requireProjectEditor(userId, projectId);

  const count = await prisma.taskList.count({
    where: {
      projectId,
      id: {
        in: input.items.map((item) => item.id)
      }
    }
  });

  if (count !== input.items.length) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "All task lists must belong to this project", 422);
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

  return { ok: true };
}

export async function createTask(userId: string, projectId: string, input: CreateTaskInput) {
  await requireProjectEditor(userId, projectId);
  assertValidDateRange(input.startDate, input.dueDate);
  await assertTaskListInProject(input.taskListId, projectId);
  await assertAssigneeIsProjectMember(input.assigneeId, projectId);
  await assertTagsInProject(input.tagIds, projectId);
  await assertV0ParentTask(input.parentId, projectId);

  const task = await prisma.task.create({
    data: {
      title: input.title,
      description: input.description,
      priority: input.priority,
      startDate: input.startDate,
      dueDate: input.dueDate,
      taskListId: input.taskListId,
      projectId,
      assigneeId: input.assigneeId,
      creatorId: userId,
      parentId: input.parentId,
      sortKey: await getNextSortKey(input.taskListId),
      tags: {
        create: input.tagIds.map((tagId) => ({
          tagId
        }))
      }
    }
  });

  if (input.assigneeId) {
    await createNotification({
      type: NotificationType.TASK_ASSIGNED,
      recipientId: input.assigneeId,
      actorId: userId,
      projectId,
      taskId: task.id,
      title: "你有一个新任务",
      content: task.title,
      dedupeKey: `task_assigned:${task.id}:${input.assigneeId}`
    });
  }

  return toTask(task);
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

  return {
    ...toTask(task),
    subTasks: task.subTasks.map(toTask),
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
    }
  });

  if (!task) {
    throw new AppError("RESOURCE_NOT_FOUND", "Task not found", 404);
  }

  await requireProjectEditor(userId, task.projectId);
  assertValidDateRange(input.startDate ?? task.startDate, input.dueDate ?? task.dueDate);
  await assertAssigneeIsProjectMember(input.assigneeId, task.projectId);
  await assertTagsInProject(input.tagIds, task.projectId);

  const updatedTask = await prisma.$transaction(async (tx) => {
    const result = await tx.task.update({
      where: {
        id: taskId
      },
      data: {
        title: input.title,
        description: input.description,
        assigneeId: input.assigneeId,
        priority: input.priority,
        startDate: input.startDate,
        dueDate: input.dueDate
      }
    });

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

  if (input.assigneeId && input.assigneeId !== task.assigneeId) {
    await createNotification({
      type: NotificationType.TASK_ASSIGNED,
      recipientId: input.assigneeId,
      actorId: userId,
      projectId: task.projectId,
      taskId,
      title: "你被分配了一个任务",
      content: updatedTask.title,
      dedupeKey: `task_assigned:${taskId}:${input.assigneeId}:${updatedTask.updatedAt.toISOString()}`
    });
  }

  return toTask(updatedTask);
}

export async function moveTask(userId: string, taskId: string, input: MoveTaskInput) {
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      deletedAt: null
    }
  });

  if (!task) {
    throw new AppError("RESOURCE_NOT_FOUND", "Task not found", 404);
  }

  await requireProjectEditor(userId, task.projectId);
  const targetList = await assertTaskListInProject(input.targetTaskListId, task.projectId);

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

  if (targetList.type === TaskListType.DONE && !task.completedAt) {
    const recipientId = task.assigneeId ?? task.creatorId;
    await createNotification({
      type: NotificationType.TASK_COMPLETED,
      recipientId,
      actorId: userId,
      projectId: task.projectId,
      taskId,
      title: "任务已完成",
      content: updatedTask.title,
      dedupeKey: `task_completed:${taskId}:${updatedTask.completedAt?.toISOString() ?? "done"}`
    });
  }

  return toTask(updatedTask);
}

export async function deleteTask(userId: string, taskId: string) {
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      deletedAt: null
    }
  });

  if (!task) {
    throw new AppError("RESOURCE_NOT_FOUND", "Task not found", 404);
  }

  await requireProjectEditor(userId, task.projectId);

  await prisma.task.update({
    where: {
      id: taskId
    },
    data: {
      deletedAt: new Date()
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

  await requireProjectEditor(userId, task.projectId);

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

  await createMentionNotifications({
    actorId: userId,
    projectId: task.projectId,
    taskId,
    content: input.content
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

async function createMentionNotifications(input: {
  actorId: string;
  projectId: string;
  taskId: string;
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
        dedupeKey: `comment_mention:${input.taskId}:${member.userId}:${Date.now()}`
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
