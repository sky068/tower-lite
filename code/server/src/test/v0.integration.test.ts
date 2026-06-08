import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import { Prisma } from "@prisma/client";
import { createApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

type ApiEnvelope<T> = {
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  requestId: string;
};

type AuthResponse = {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    name: string;
  };
};

type TeamResponse = {
  id: string;
  name: string;
};

type ProjectResponse = {
  id: string;
  name: string;
  status?: string;
};

type MemberResponse = {
  user: {
    id: string;
    email: string;
    name: string;
  };
  role: string;
};

type TaskListResponse = {
  id: string;
  name: string;
  type: "TODO" | "IN_PROGRESS" | "DONE" | "CUSTOM";
  tasks: TaskResponse[];
};

type TaskResponse = {
  id: string;
  title: string;
  taskListId: string;
  parentId: string | null;
  completedAt: string | null;
  assignees?: Array<{
    user: {
      id: string;
      name: string;
      isRemoved?: boolean;
    };
  }>;
};

type MyTaskResponse = {
  id: string;
  title: string;
  parentId: string | null;
  taskList: {
    id: string;
    name: string;
    type: string;
  };
};

type NotificationResponse = {
  id: string;
  type: string;
  title: string;
  content: string;
  isRead: boolean;
};

type NotificationReadResponse = {
  id: string;
  isRead: boolean;
  readAt: string | null;
};

type TagResponse = {
  id: string;
  name: string;
  color: string;
  projectId: string;
};

type TaskDetailResponse = TaskResponse & {
  tags: TagResponse[];
};

type TestUser = {
  id: string;
  email: string;
  name: string;
  token: string;
};

const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const emailDomain = `${runId}.integration.test`;
let server: Server | null = null;
let baseUrl = "";
let databaseConnected = false;

async function cleanupRunData() {
  const users = await prisma.user.findMany({
    where: {
      email: {
        endsWith: `@${emailDomain}`
      }
    },
    select: {
      id: true
    }
  });

  const userIds = users.map((user) => user.id);
  if (userIds.length === 0) {
    return;
  }

  const projectRows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT DISTINCT project."id"
    FROM "Project" project
    LEFT JOIN "ProjectMember" project_member ON project_member."projectId" = project."id"
    LEFT JOIN "TeamMember" team_member ON team_member."teamId" = project."teamId"
    WHERE project."createdById" IN (${Prisma.join(userIds)})
      OR project_member."userId" IN (${Prisma.join(userIds)})
      OR team_member."userId" IN (${Prisma.join(userIds)})
  `;
  const projectIds = projectRows.map((project) => project.id);

  const teamRows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT DISTINCT team."id"
    FROM "Team" team
    JOIN "TeamMember" team_member ON team_member."teamId" = team."id"
    WHERE team_member."userId" IN (${Prisma.join(userIds)})
  `;
  const teamIds = teamRows.map((team) => team.id);

  await prisma.$transaction([
    prisma.notificationDelivery.deleteMany({
      where: {
        notification: {
          OR: [
            { recipientId: { in: userIds } },
            { actorId: { in: userIds } },
            { projectId: { in: projectIds } }
          ]
        }
      }
    }),
    prisma.notification.deleteMany({
      where: {
        OR: [
          { recipientId: { in: userIds } },
          { actorId: { in: userIds } },
          { projectId: { in: projectIds } }
        ]
      }
    }),
    prisma.taskDependency.deleteMany({
      where: {
        OR: [
          { dependentTask: { projectId: { in: projectIds } } },
          { prerequisite: { projectId: { in: projectIds } } }
        ]
      }
    }),
    prisma.taskTag.deleteMany({
      where: {
        task: {
          projectId: {
            in: projectIds
          }
        }
      }
    }),
    prisma.comment.deleteMany({
      where: {
        OR: [
          { authorId: { in: userIds } },
          { task: { projectId: { in: projectIds } } }
        ]
      }
    }),
    prisma.taskAssignee.deleteMany({
      where: {
        OR: [
          { userId: { in: userIds } },
          { task: { projectId: { in: projectIds } } }
        ]
      }
    }),
    prisma.task.deleteMany({
      where: {
        projectId: {
          in: projectIds
        }
      }
    }),
    prisma.tag.deleteMany({
      where: {
        projectId: {
          in: projectIds
        }
      }
    }),
    prisma.taskList.deleteMany({
      where: {
        projectId: {
          in: projectIds
        }
      }
    }),
    prisma.projectMember.deleteMany({
      where: {
        OR: [
          { userId: { in: userIds } },
          { projectId: { in: projectIds } }
        ]
      }
    }),
    prisma.invitation.deleteMany({
      where: {
        OR: [
          { inviterId: { in: userIds } },
          { teamId: { in: teamIds } },
          { projectId: { in: projectIds } }
        ]
      }
    }),
    prisma.project.deleteMany({
      where: {
        id: {
          in: projectIds
        }
      }
    }),
    prisma.teamMember.deleteMany({
      where: {
        OR: [
          { userId: { in: userIds } },
          { teamId: { in: teamIds } }
        ]
      }
    }),
    prisma.team.deleteMany({
      where: {
        id: {
          in: teamIds
        }
      }
    }),
    prisma.refreshToken.deleteMany({
      where: {
        userId: {
          in: userIds
        }
      }
    }),
    prisma.user.deleteMany({
      where: {
        id: {
          in: userIds
        }
      }
    })
  ]);
}

function listen(app: ReturnType<typeof createApp>) {
  return new Promise<Server>((resolve) => {
    const httpServer = app.listen(0, "127.0.0.1", () => resolve(httpServer));
  });
}

async function request<T>(
  method: string,
  path: string,
  input?: {
    token?: string;
    body?: unknown;
    expectedStatus?: number;
  }
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(input?.token ? { authorization: `Bearer ${input.token}` } : {})
    },
    body: input?.body === undefined ? undefined : JSON.stringify(input.body)
  });
  const envelope = (await response.json()) as ApiEnvelope<T>;

  if (input?.expectedStatus !== undefined) {
    assert.equal(response.status, input.expectedStatus, envelope.error?.message);
  } else {
    assert.ok(response.status >= 200 && response.status < 300, envelope.error?.message);
  }

  return {
    status: response.status,
    envelope,
    data: envelope.data as T
  };
}

async function registerUser(name: string): Promise<TestUser> {
  const email = `${name.toLowerCase()}@${emailDomain}`;
  const response = await request<AuthResponse>("POST", "/api/v1/auth/register", {
    expectedStatus: 201,
    body: {
      email,
      name,
      password: "Password123!"
    }
  });

  return {
    id: response.data.user.id,
    email,
    name,
    token: response.data.accessToken
  };
}

function closeServer() {
  if (!server) {
    return Promise.resolve();
  }

  const httpServer = server;
  server = null;

  return new Promise<void>((resolve, reject) => {
    httpServer.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

before(async () => {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  databaseConnected = true;
  await cleanupRunData();
  server = await listen(createApp());
  const address = server.address();
  assert.ok(address && typeof address === "object");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await closeServer();
  if (databaseConnected) {
    await cleanupRunData();
  }
  await prisma.$disconnect();
});

describe("V0 HTTP integration", () => {
  it("covers the team, project, board, task, notification, and permission workflow", async () => {
    const owner = await registerUser("Owner");
    const editor = await registerUser("Editor");
    const viewer = await registerUser("Viewer");

    const team = (await request<TeamResponse>("POST", "/api/v1/teams", {
      token: owner.token,
      expectedStatus: 201,
      body: {
        name: `Integration Team ${runId}`
      }
    })).data;

    const ownerTeams = (await request<TeamResponse[]>("GET", "/api/v1/teams", {
      token: owner.token
    })).data;
    assert.ok(ownerTeams.some((item) => item.id === team.id));

    await request<MemberResponse>("POST", `/api/v1/teams/${team.id}/members`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        email: editor.email,
        role: "MEMBER"
      }
    });
    await request<MemberResponse>("POST", `/api/v1/teams/${team.id}/members`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        email: viewer.email,
        role: "MEMBER"
      }
    });

    await request<ProjectResponse>("POST", `/api/v1/teams/${team.id}/projects`, {
      token: editor.token,
      expectedStatus: 403,
      body: {
        name: "Editor cannot create projects"
      }
    });

    const project = (await request<ProjectResponse>("POST", `/api/v1/teams/${team.id}/projects`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        name: `Integration Project ${runId}`,
        description: "V0 integration workflow"
      }
    })).data;

    await request<{ ok: boolean }>("DELETE", `/api/v1/teams/${team.id}`, {
      token: owner.token,
      expectedStatus: 422
    });

    await request<MemberResponse>("POST", `/api/v1/projects/${project.id}/members`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        userId: editor.id,
        role: "EDITOR"
      }
    });
    await request<MemberResponse>("POST", `/api/v1/projects/${project.id}/members`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        userId: viewer.id,
        role: "VIEWER"
      }
    });

    const lists = (await request<TaskListResponse[]>("GET", `/api/v1/projects/${project.id}/lists`, {
      token: owner.token
    })).data;
    assert.deepEqual(
      lists.map((list) => list.type),
      ["TODO", "IN_PROGRESS", "DONE"]
    );

    const todoList = lists.find((list) => list.type === "TODO");
    const doneList = lists.find((list) => list.type === "DONE");
    assert.ok(todoList);
    assert.ok(doneList);

    await request<TaskListResponse>("PATCH", `/api/v1/projects/${project.id}/lists/${todoList.id}`, {
      token: owner.token,
      expectedStatus: 422,
      body: {
        name: "Backlog"
      }
    });

    await request<TaskListResponse>("POST", `/api/v1/projects/${project.id}/lists`, {
      token: editor.token,
      expectedStatus: 403,
      body: {
        name: "Editor list"
      }
    });

    await request<TaskResponse>("POST", `/api/v1/projects/${project.id}/tasks`, {
      token: viewer.token,
      expectedStatus: 403,
      body: {
        taskListId: todoList.id,
        title: "Viewer cannot create tasks"
      }
    });

    const task = (await request<TaskResponse>("POST", `/api/v1/projects/${project.id}/tasks`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        taskListId: todoList.id,
        title: "Assigned integration task",
        description: "Created by owner and assigned to editor",
        priority: "HIGH",
        assigneeIds: [editor.id]
      }
    })).data;
    assert.equal(task.title, "Assigned integration task");

    const editorTasks = (await request<MyTaskResponse[]>("GET", "/api/v1/users/me/tasks", {
      token: editor.token
    })).data;
    assert.ok(editorTasks.some((item) => item.id === task.id));

    const editorNotifications = (await request<NotificationResponse[]>(
      "GET",
      "/api/v1/users/me/notifications",
      {
        token: editor.token
      }
    )).data;
    assert.ok(
      editorNotifications.some(
        (notification) =>
          notification.type === "TASK_ASSIGNED" &&
          notification.title === "你被分配了一个任务"
      )
    );

    const ownerNotificationsAfterAssign = (await request<NotificationResponse[]>(
      "GET",
      "/api/v1/users/me/notifications",
      {
        token: owner.token
      }
    )).data;
    assert.equal(
      ownerNotificationsAfterAssign.some((notification) => notification.type === "TASK_ASSIGNED"),
      false
    );

    const subTask = (await request<TaskResponse>("POST", `/api/v1/projects/${project.id}/tasks`, {
      token: editor.token,
      expectedStatus: 201,
      body: {
        taskListId: todoList.id,
        parentId: task.id,
        title: "One level subtask",
        assigneeIds: [editor.id]
      }
    })).data;
    assert.equal(subTask.parentId, task.id);

    await request<TaskResponse>("POST", `/api/v1/projects/${project.id}/tasks`, {
      token: editor.token,
      expectedStatus: 422,
      body: {
        taskListId: todoList.id,
        parentId: subTask.id,
        title: "Nested subtask is not allowed in V0"
      }
    });

    const tag = (await request<TagResponse>("POST", `/api/v1/projects/${project.id}/tags`, {
      token: editor.token,
      expectedStatus: 201,
      body: {
        name: "Integration Tag",
        color: "#16a34a"
      }
    })).data;
    assert.equal(tag.projectId, project.id);

    const projectTags = (await request<TagResponse[]>("GET", `/api/v1/projects/${project.id}/tags`, {
      token: viewer.token
    })).data;
    assert.ok(projectTags.some((item) => item.id === tag.id));

    await request<{ ok: boolean }>("POST", `/api/v1/tasks/${task.id}/tags/${tag.id}`, {
      token: editor.token
    });

    const taskWithTag = (await request<TaskDetailResponse>("GET", `/api/v1/tasks/${task.id}`, {
      token: viewer.token
    })).data;
    assert.ok(taskWithTag.tags.some((item) => item.id === tag.id));

    const updatedTag = (await request<TagResponse>("PATCH", `/api/v1/projects/${project.id}/tags/${tag.id}`, {
      token: editor.token,
      body: {
        name: "Integration Tag Updated",
        color: "#dc2626"
      }
    })).data;
    assert.equal(updatedTag.name, "Integration Tag Updated");

    await request<{ ok: boolean }>("DELETE", `/api/v1/tasks/${task.id}/tags/${tag.id}`, {
      token: editor.token
    });
    await request<{ ok: boolean }>("DELETE", `/api/v1/projects/${project.id}/tags/${tag.id}`, {
      token: editor.token
    });

    const movedTask = (await request<TaskResponse>("PATCH", `/api/v1/tasks/${task.id}/move`, {
      token: owner.token,
      body: {
        targetTaskListId: doneList.id,
        sortKey: "1000"
      }
    })).data;
    assert.equal(movedTask.completedAt !== null, true);

    const editorNotificationsAfterMove = (await request<NotificationResponse[]>(
      "GET",
      "/api/v1/users/me/notifications",
      {
        token: editor.token
      }
    )).data;
    assert.ok(
      editorNotificationsAfterMove.some(
        (notification) => notification.type === "TASK_STATUS_CHANGED"
      )
    );
    const unreadNotification = editorNotificationsAfterMove.find((notification) => !notification.isRead);
    assert.ok(unreadNotification);

    const readNotification = (await request<NotificationReadResponse>(
      "PATCH",
      `/api/v1/users/me/notifications/${unreadNotification.id}/read`,
      {
        token: editor.token
      }
    )).data;
    assert.equal(readNotification.isRead, true);

    await request<{ ok: boolean }>("PATCH", "/api/v1/users/me/notifications/read-all", {
      token: editor.token
    });
    const editorNotificationsAfterReadAll = (await request<NotificationResponse[]>(
      "GET",
      "/api/v1/users/me/notifications",
      {
        token: editor.token
      }
    )).data;
    assert.equal(editorNotificationsAfterReadAll.every((notification) => notification.isRead), true);

    await request<{ id: string }>("POST", `/api/v1/tasks/${task.id}/comments`, {
      token: editor.token,
      expectedStatus: 201,
      body: {
        content: "Owner should receive a comment notification"
      }
    });

    const ownerNotificationsAfterComment = (await request<NotificationResponse[]>(
      "GET",
      "/api/v1/users/me/notifications",
      {
        token: owner.token
      }
    )).data;
    assert.ok(
      ownerNotificationsAfterComment.some(
        (notification) => notification.type === "TASK_COMMENTED"
      )
    );

    const archivedProject = (await request<ProjectResponse>("PATCH", `/api/v1/projects/${project.id}/archive`, {
      token: owner.token
    })).data;
    assert.equal(archivedProject.status, "ARCHIVED");

    await request<TaskResponse>("POST", `/api/v1/projects/${project.id}/tasks`, {
      token: owner.token,
      expectedStatus: 422,
      body: {
        taskListId: todoList.id,
        title: "Archived projects reject writes"
      }
    });

    await request<TagResponse>("POST", `/api/v1/projects/${project.id}/tags`, {
      token: owner.token,
      expectedStatus: 422,
      body: {
        name: "Archived Tag",
        color: "#2563eb"
      }
    });
  });
});
