import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import { Prisma } from "@prisma/client";
import { createApp } from "../app.js";
import { runDueReminderScan } from "../jobs/due-reminder.js";
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
    avatarUrl: string | null;
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
  isDefault: boolean;
  tasks: TaskResponse[];
};

type TaskResponse = {
  id: string;
  title: string;
  status: "TODO" | "IN_PROGRESS" | "DONE";
  taskListId: string;
  parentId: string | null;
  completedAt: string | null;
  completedBy: {
    id: string;
    name: string;
  } | null;
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
  status: "TODO" | "IN_PROGRESS" | "DONE";
  parentId: string | null;
  completedAt: string | null;
  completedBy: {
    id: string;
    name: string;
  } | null;
  taskList: {
    id: string;
    name: string;
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

type InvitationResponse = {
  id: string;
  email: string;
  token: string;
  status: "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED";
  teamRole: string | null;
  projectRole: string | null;
  teamId: string;
  projectId: string | null;
  acceptPath: string;
};

type AcceptInvitationResponse = {
  ok: boolean;
  teamId: string;
  projectId: string | null;
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

type ActivityLogResponse = {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  teamId: string;
  projectId: string | null;
  taskId: string | null;
  metadata: Record<string, unknown> | null;
  actor: {
    id: string;
    name: string;
    email: string;
  } | null;
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
    prisma.activityLog.deleteMany({
      where: {
        OR: [
          { actorId: { in: userIds } },
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
    const directAddedMember = await registerUser("DirectAddedMember");
    const invitedTeamMember = await registerUser("InvitedTeamMember");
    const invitedProjectMember = await registerUser("InvitedProjectMember");
    const concurrentProjectInvitee = await registerUser("ConcurrentProjectInvitee");

    const updatedOwner = (await request<AuthResponse["user"]>("PATCH", "/api/v1/users/me/profile", {
      token: owner.token,
      body: {
        name: "Updated Owner",
        avatarUrl: "data:image/png;base64,iVBORw0KGgo="
      }
    })).data;
    assert.equal(updatedOwner.name, "Updated Owner");
    assert.equal(updatedOwner.avatarUrl, "data:image/png;base64,iVBORw0KGgo=");

    await request<AuthResponse["user"]>("PATCH", "/api/v1/users/me/profile", {
      token: owner.token,
      expectedStatus: 400,
      body: {
        name: "Updated Owner",
        avatarUrl: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="
      }
    });

    await request<{ ok: boolean }>("PATCH", "/api/v1/users/me/password", {
      token: owner.token,
      expectedStatus: 401,
      body: {
        currentPassword: "wrong-password",
        newPassword: "Password456!"
      }
    });
    await request<{ ok: boolean }>("PATCH", "/api/v1/users/me/password", {
      token: owner.token,
      body: {
        currentPassword: "Password123!",
        newPassword: "Password456!"
      }
    });
    await request<AuthResponse>("POST", "/api/v1/auth/login", {
      expectedStatus: 401,
      body: {
        email: owner.email,
        password: "Password123!"
      }
    });
    await request<AuthResponse>("POST", "/api/v1/auth/login", {
      body: {
        email: owner.email,
        password: "Password456!"
      }
    });

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

    const disposableTeam = (await request<TeamResponse>("POST", "/api/v1/teams", {
      token: owner.token,
      expectedStatus: 201,
      body: {
        name: `Disposable Team ${runId}`
      }
    })).data;
    await request<{ ok: boolean }>("DELETE", `/api/v1/teams/${disposableTeam.id}`, {
      token: owner.token
    });
    const ownerTeamsAfterDisposableDelete = (await request<TeamResponse[]>("GET", "/api/v1/teams", {
      token: owner.token
    })).data;
    assert.equal(ownerTeamsAfterDisposableDelete.some((item) => item.id === disposableTeam.id), false);
    await request<TeamResponse>("GET", `/api/v1/teams/${disposableTeam.id}`, {
      token: owner.token,
      expectedStatus: 403
    });

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
    await request<MemberResponse>("POST", `/api/v1/teams/${team.id}/members`, {
      token: owner.token,
      expectedStatus: 404,
      body: {
        email: `missing-user@${emailDomain}`,
        role: "MEMBER"
      }
    });
    await request<MemberResponse>("POST", `/api/v1/teams/${team.id}/members`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        email: ` ${directAddedMember.email.toUpperCase()} `,
        role: "MEMBER"
      }
    });
    await request<MemberResponse>("PATCH", `/api/v1/teams/${team.id}/members/${directAddedMember.id}/role`, {
      token: owner.token,
      body: {
        role: "ADMIN"
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

    const teamInvitation = (await request<InvitationResponse>(
      "POST",
      `/api/v1/teams/${team.id}/invitations`,
      {
        token: owner.token,
        expectedStatus: 201,
        body: {
          email: invitedTeamMember.email,
          role: "MEMBER"
        }
      }
    )).data;
    assert.equal(teamInvitation.status, "PENDING");
    assert.equal(teamInvitation.projectId, null);
    assert.ok(teamInvitation.acceptPath.includes(teamInvitation.token));

    const teamInvitations = (await request<InvitationResponse[]>(
      "GET",
      `/api/v1/teams/${team.id}/invitations`,
      {
        token: owner.token
      }
    )).data;
    assert.ok(teamInvitations.some((invitation) => invitation.id === teamInvitation.id));

    const acceptedTeamInvitation = (await request<AcceptInvitationResponse>(
      "POST",
      "/api/v1/invitations/accept",
      {
        token: invitedTeamMember.token,
        body: {
          token: teamInvitation.acceptPath.split("token=")[1]
        }
      }
    )).data;
    assert.equal(acceptedTeamInvitation.teamId, team.id);
    assert.equal(acceptedTeamInvitation.projectId, null);

    const acceptedTeamInvitationAgain = (await request<AcceptInvitationResponse>(
      "POST",
      "/api/v1/invitations/accept",
      {
        token: invitedTeamMember.token,
        body: {
          token: teamInvitation.token
        }
      }
    )).data;
    assert.equal(acceptedTeamInvitationAgain.teamId, team.id);

    await request<InvitationResponse>("PATCH", `/api/v1/invitations/${teamInvitation.id}/revoke`, {
      token: owner.token,
      expectedStatus: 422
    });

    const invitedTeamProjects = (await request<ProjectResponse[]>(
      "GET",
      `/api/v1/teams/${team.id}/projects`,
      {
        token: invitedTeamMember.token
      }
    )).data;
    assert.equal(invitedTeamProjects.some((item) => item.id === project.id), false);

    await request<TaskListResponse[]>("GET", `/api/v1/projects/${project.id}/lists`, {
      token: invitedTeamMember.token,
      expectedStatus: 403
    });

    const mismatchedInvitation = (await request<InvitationResponse>(
      "POST",
      `/api/v1/teams/${team.id}/invitations`,
      {
        token: owner.token,
        expectedStatus: 201,
        body: {
          email: `not-${viewer.email}`,
          role: "MEMBER"
        }
      }
    )).data;
    await request<AcceptInvitationResponse>("POST", "/api/v1/invitations/accept", {
      token: viewer.token,
      expectedStatus: 422,
      body: {
        token: mismatchedInvitation.token
      }
    });

    const revokeInvitation = (await request<InvitationResponse>(
      "POST",
      `/api/v1/teams/${team.id}/invitations`,
      {
        token: owner.token,
        expectedStatus: 201,
        body: {
          email: `revoked-${invitedTeamMember.email}`,
          role: "MEMBER"
        }
      }
    )).data;
    const revokedInvitation = (await request<InvitationResponse>(
      "PATCH",
      `/api/v1/invitations/${revokeInvitation.id}/revoke`,
      {
        token: owner.token
      }
    )).data;
    assert.equal(revokedInvitation.status, "REVOKED");

    await request<{ ok: boolean }>("DELETE", `/api/v1/teams/${team.id}`, {
      token: owner.token,
      expectedStatus: 422
    });

    const projectInvitation = (await request<InvitationResponse>(
      "POST",
      `/api/v1/projects/${project.id}/invitations`,
      {
        token: owner.token,
        expectedStatus: 201,
        body: {
          email: invitedProjectMember.email,
          teamRole: "MEMBER",
          projectRole: "EDITOR"
        }
      }
    )).data;
    assert.equal(projectInvitation.status, "PENDING");
    assert.equal(projectInvitation.projectId, project.id);

    const projectInvitations = (await request<InvitationResponse[]>(
      "GET",
      `/api/v1/projects/${project.id}/invitations`,
      {
        token: owner.token
      }
    )).data;
    assert.ok(projectInvitations.some((invitation) => invitation.id === projectInvitation.id));

    const acceptedProjectInvitation = (await request<AcceptInvitationResponse>(
      "POST",
      "/api/v1/invitations/accept",
      {
        token: invitedProjectMember.token,
        body: {
          token: projectInvitation.acceptPath.split("token=")[1]
        }
      }
    )).data;
    assert.equal(acceptedProjectInvitation.teamId, team.id);
    assert.equal(acceptedProjectInvitation.projectId, project.id);

    const concurrentProjectInvitation = (await request<InvitationResponse>(
      "POST",
      `/api/v1/projects/${project.id}/invitations`,
      {
        token: owner.token,
        expectedStatus: 201,
        body: {
          email: concurrentProjectInvitee.email,
          teamRole: "MEMBER",
          projectRole: "VIEWER"
        }
      }
    )).data;

    const [firstConcurrentAccept, secondConcurrentAccept] = await Promise.all([
      request<AcceptInvitationResponse>("POST", "/api/v1/invitations/accept", {
        token: concurrentProjectInvitee.token,
        body: {
          token: concurrentProjectInvitation.token
        }
      }),
      request<AcceptInvitationResponse>("POST", "/api/v1/invitations/accept", {
        token: concurrentProjectInvitee.token,
        body: {
          token: concurrentProjectInvitation.token
        }
      })
    ]);
    assert.equal(firstConcurrentAccept.data.projectId, project.id);
    assert.equal(secondConcurrentAccept.data.projectId, project.id);

    const invitedProjectMembers = (await request<MemberResponse[]>(
      "GET",
      `/api/v1/projects/${project.id}/members`,
      {
        token: owner.token
      }
    )).data;
    assert.ok(invitedProjectMembers.some((member) => member.user.id === invitedProjectMember.id));

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
    assert.equal(lists.length, 0);

    const defaultedTask = (await request<TaskResponse>("POST", `/api/v1/projects/${project.id}/tasks`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        title: "Task creates default list"
      }
    })).data;
    assert.equal(defaultedTask.status, "TODO");
    const listsAfterDefaultTask = (await request<TaskListResponse[]>("GET", `/api/v1/projects/${project.id}/lists`, {
      token: owner.token
    })).data;
    const defaultList = listsAfterDefaultTask.find((list) => list.id === defaultedTask.taskListId);
    assert.ok(defaultList);
    assert.equal(defaultList.name, "默认清单");
    assert.equal(defaultList.isDefault, true);
    await request<TaskListResponse>("PATCH", `/api/v1/projects/${project.id}/lists/${defaultList.id}`, {
      token: owner.token,
      expectedStatus: 422,
      body: {
        name: "不能改名"
      }
    });
    await request<{ ok: boolean }>("DELETE", `/api/v1/projects/${project.id}/lists/${defaultList.id}`, {
      token: owner.token,
      expectedStatus: 422
    });

    const customList = (await request<TaskListResponse>("POST", `/api/v1/projects/${project.id}/lists`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        name: "Backlog"
      }
    })).data;
    const updatedCustomList = (await request<TaskListResponse>("PATCH", `/api/v1/projects/${project.id}/lists/${customList.id}`, {
      token: owner.token,
      body: {
        name: "开发清单"
      }
    })).data;
    assert.equal(updatedCustomList.name, "开发清单");
    await request<TaskListResponse>("POST", `/api/v1/projects/${project.id}/lists`, {
      token: owner.token,
      expectedStatus: 422,
      body: {
        name: "开发清单"
      }
    });
    const anotherList = (await request<TaskListResponse>("POST", `/api/v1/projects/${project.id}/lists`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        name: "测试清单"
      }
    })).data;
    await request<TaskListResponse>("PATCH", `/api/v1/projects/${project.id}/lists/${anotherList.id}`, {
      token: owner.token,
      expectedStatus: 422,
      body: {
        name: "开发清单"
      }
    });
    const taskDeletedWithList = (await request<TaskResponse>("POST", `/api/v1/projects/${project.id}/tasks`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        taskListId: anotherList.id,
        title: "Task deleted with list"
      }
    })).data;
    await request<{ ok: boolean }>("DELETE", `/api/v1/projects/${project.id}/lists/${anotherList.id}`, {
      token: owner.token
    });
    await request<TaskResponse>("GET", `/api/v1/tasks/${taskDeletedWithList.id}`, {
      token: owner.token,
      expectedStatus: 404
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
        taskListId: customList.id,
        title: "Viewer cannot create tasks"
      }
    });

    const task = (await request<TaskResponse>("POST", `/api/v1/projects/${project.id}/tasks`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
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
        taskListId: task.taskListId,
        parentId: task.id,
        title: "One level subtask",
        assigneeIds: [editor.id]
      }
    })).data;
    assert.equal(subTask.parentId, task.id);

    const secondLevelSubTask = (await request<TaskResponse>("POST", `/api/v1/projects/${project.id}/tasks`, {
      token: editor.token,
      expectedStatus: 201,
      body: {
        taskListId: task.taskListId,
        parentId: subTask.id,
        title: "Second level subtask is allowed in V0.1"
      }
    })).data;
    assert.equal(secondLevelSubTask.parentId, subTask.id);

    await request<TaskResponse>("POST", `/api/v1/projects/${project.id}/tasks`, {
      token: editor.token,
      expectedStatus: 422,
      body: {
        taskListId: task.taskListId,
        parentId: secondLevelSubTask.id,
        title: "Third level subtask is not allowed in V0.1"
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
        targetTaskListId: customList.id,
        sortKey: "1000"
      }
    })).data;
    assert.equal(movedTask.completedAt, null);

    const completedTask = (await request<TaskResponse>("PATCH", `/api/v1/tasks/${task.id}`, {
      token: owner.token,
      body: {
        status: "DONE"
      }
    })).data;
    assert.equal(completedTask.status, "DONE");
    assert.equal(completedTask.completedAt !== null, true);
    assert.equal(completedTask.completedBy?.id, owner.id);
    const editorCompletedTasks = (await request<MyTaskResponse[]>("GET", "/api/v1/users/me/tasks", {
      token: editor.token
    })).data;
    const editorCompletedTask = editorCompletedTasks.find((item) => item.id === task.id);
    assert.ok(editorCompletedTask);
    assert.equal(editorCompletedTask.completedAt !== null, true);
    assert.equal(editorCompletedTask.completedBy?.id, owner.id);

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

    const dueSoonTask = (await request<TaskResponse>("POST", `/api/v1/projects/${project.id}/tasks`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        taskListId: task.taskListId,
        title: "Due soon task",
        dueDate: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        assigneeIds: [editor.id]
      }
    })).data;
    await runDueReminderScan();
    await runDueReminderScan();
    const editorNotificationsAfterDueScan = (await request<NotificationResponse[]>(
      "GET",
      "/api/v1/users/me/notifications",
      {
        token: editor.token
      }
    )).data;
    const dueSoonNotifications = editorNotificationsAfterDueScan.filter(
      (notification) =>
        notification.type === "TASK_DUE_SOON" &&
        notification.content.includes("Due soon task")
    );
    assert.equal(dueSoonNotifications.length, 1);

    await request<{ ok: boolean }>("DELETE", `/api/v1/tasks/${dueSoonTask.id}`, {
      token: owner.token
    });
    await request<TaskResponse>("GET", `/api/v1/tasks/${dueSoonTask.id}`, {
      token: owner.token,
      expectedStatus: 404
    });

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

    const teamActivity = (await request<ActivityLogResponse[]>(
      "GET",
      `/api/v1/teams/${team.id}/activity`,
      {
        token: owner.token
      }
    )).data;
    assert.ok(teamActivity.some((log) => log.action === "team_member.added"));
    assert.ok(teamActivity.some((log) => log.action === "team_invitation.accepted"));
    assert.ok(teamActivity.some((log) => log.action === "project.created"));
    assert.ok(!teamActivity.some((log) => log.action.startsWith("task.")));
    assert.ok(!teamActivity.some((log) => log.action.startsWith("task_list.")));
    assert.ok(!teamActivity.some((log) => log.action.startsWith("comment.")));
    assert.ok(!teamActivity.some((log) => log.action.startsWith("project_invitation.")));

    await request<ActivityLogResponse[]>("GET", `/api/v1/teams/${team.id}/activity`, {
      token: directAddedMember.token,
      expectedStatus: 403
    });

    const projectActivity = (await request<ActivityLogResponse[]>(
      "GET",
      `/api/v1/projects/${project.id}/activity`,
      {
        token: owner.token
      }
    )).data;
    assert.ok(projectActivity.some((log) => log.action === "task.created" && log.taskId === task.id));
    assert.ok(projectActivity.some((log) => log.action === "task.status_changed" && log.taskId === task.id));
    assert.ok(projectActivity.some((log) => log.action === "task.deleted" && log.taskId === dueSoonTask.id));
    assert.ok(projectActivity.some((log) => log.action === "comment.created" && log.taskId === task.id));

    await request<ActivityLogResponse[]>("GET", `/api/v1/projects/${project.id}/activity`, {
      token: directAddedMember.token
    });
    await request<ActivityLogResponse[]>("GET", `/api/v1/projects/${project.id}/activity`, {
      token: editor.token,
      expectedStatus: 403
    });

    const archivedProject = (await request<ProjectResponse>("PATCH", `/api/v1/projects/${project.id}/archive`, {
      token: owner.token
    })).data;
    assert.equal(archivedProject.status, "ARCHIVED");

    await request<TaskResponse>("POST", `/api/v1/projects/${project.id}/tasks`, {
      token: owner.token,
      expectedStatus: 422,
      body: {
        taskListId: task.taskListId,
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
