import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import { AccountTokenType, Prisma } from "@prisma/client";
import { createApp } from "../app.js";
import { env } from "../config/env.js";
import { runDueReminderScan } from "../jobs/due-reminder.js";
import { prisma } from "../lib/prisma.js";
import { hashToken } from "../utils/token.js";

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
    hasPassword: boolean;
    emailVerifiedAt?: string | null;
  };
  emailVerificationQueued?: boolean;
};

type CurrentUserResponse = AuthResponse["user"] & {
  feishuBound: boolean;
  hasPassword: boolean;
  feishuOpenId: string | null;
  feishuUnionId: string | null;
};

type EmailChangeResponse = {
  ok: boolean;
  email: string;
  verificationQueued: boolean;
  user: CurrentUserResponse;
};

type EmailVerificationResponse = {
  ok: boolean;
  type: "EMAIL_VERIFY" | "EMAIL_CHANGE";
  email: string;
  user: AuthResponse["user"];
};

type EmailVerificationSendResponse = {
  ok: boolean;
  alreadyVerified: boolean;
  verificationQueued: boolean;
  devVerificationPath?: string | null;
};

type PasswordResetRequestResponse = {
  ok: boolean;
  resetQueued?: boolean;
};

type EmailOutboxResponse = {
  id: string;
  type: AccountTokenType;
  toEmail: string;
  subject: string;
  status: "PENDING" | "SENT" | "FAILED";
  createdAt: string;
  sentAt: string | null;
  lastError: string | null;
  user: {
    id: string;
    name: string;
    email: string;
  };
  actionPath?: string;
};

type FeishuAuthorizeResponse = {
  configured: boolean;
  authorizeUrl: string | null;
};

type FeishuWebhookResponse = {
  ok: boolean;
  duplicate: boolean;
  eventId: string;
  eventType: string;
};

type FeishuDeliveryResponse = {
  id: string;
  status: string;
  attemptCount: number;
  lastError: string | null;
  canRetry: boolean;
  notification: {
    id: string;
    type: string;
  };
  recipient: {
    id: string;
    feishuBound: boolean;
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
  id: string;
  teamMemberId?: string;
  email: string;
  inviteAcceptPath?: string | null;
  status: "ACTIVE" | "PENDING";
  user: {
    id: string;
    email: string;
    name: string;
  } | null;
  role: string;
};

type BatchImportMembersResponse = {
  importedCount: number;
  members: MemberResponse[];
};

type TaskListResponse = {
  id: string;
  name: string;
  isDefault: boolean;
  tasks: TaskResponse[];
};

type ProjectTrashResponse = {
  taskLists: Array<{
    id: string;
    name: string;
    taskCount: number;
    deletedAt: string | null;
    deletedBy: {
      id: string;
      name: string;
      email: string;
    } | null;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    deletedAt: string | null;
    deletedBy: {
      id: string;
      name: string;
      email: string;
    } | null;
    taskList: {
      id: string;
      name: string;
    };
  }>;
};

type TeamProjectTrashResponse = {
  projects: Array<{
    id: string;
    name: string;
    status: string;
    deletedAt: string | null;
    deletedBy: {
      id: string;
      name: string;
      email: string;
    } | null;
  }>;
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
    id: string;
    name: string;
    status?: "ACTIVE" | "PENDING" | "REMOVED";
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
  project: {
    id: string;
    name: string;
    team: {
      id: string;
      name: string;
    };
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

type CommentResponse = {
  id: string;
  content: string;
  mentions: Array<{
    id: string;
    name: string;
  }>;
};

type TagResponse = {
  id: string;
  name: string;
  color: string;
  projectId: string;
};

type TaskDetailResponse = TaskResponse & {
  tags: TagResponse[];
  comments: CommentResponse[];
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

type ClearActivityLogsResponse = {
  deletedCount: number;
};

type ClearFeishuDeliveriesResponse = {
  deletedCount: number;
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
    prisma.feishuEvent.deleteMany({
      where: {
        eventId: {
          contains: runId
        }
      }
    }),
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
    prisma.commentMention.deleteMany({
      where: {
        OR: [
          { userId: { in: userIds } },
          { comment: { task: { projectId: { in: projectIds } } } }
        ]
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
        task: { projectId: { in: projectIds } }
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
    prisma.emailOutbox.deleteMany({
      where: {
        userId: {
          in: userIds
        }
      }
    }),
    prisma.accountToken.deleteMany({
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

function tokenFromPath(path: string | null) {
  assert.ok(path);
  const url = new URL(path, "http://tower.test");
  const token = url.searchParams.get("token");
  assert.ok(token);
  return token;
}

async function latestEmailActionToken(email: string, type: AccountTokenType) {
  const emailItem = await prisma.emailOutbox.findFirst({
    where: {
      toEmail: email.toLowerCase(),
      type
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return tokenFromPath(emailItem?.actionPath ?? null);
}

async function verifyRegisteredEmail(response: AuthResponse) {
  await request<EmailVerificationResponse>("POST", "/api/v1/auth/email-verification/confirm", {
    body: {
      token: await latestEmailActionToken(response.user.email, AccountTokenType.EMAIL_VERIFY)
    }
  });
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
  await verifyRegisteredEmail(response.data);

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
    const systemAdminOnly = await registerUser("SystemAdminOnly");
    await prisma.user.update({
      where: {
        id: owner.id
      },
      data: {
        systemRole: "ADMIN"
      }
    });
    await prisma.user.update({
      where: {
        id: systemAdminOnly.id
      },
      data: {
        systemRole: "ADMIN"
      }
    });
    const unverifiedSystemAdmin = (await request<AuthResponse>("POST", "/api/v1/auth/register", {
      expectedStatus: 201,
      body: {
        email: `unverified-system-admin@${emailDomain}`,
        name: "Unverified System Admin",
        password: "Password123!"
      }
    })).data;
    await prisma.user.update({
      where: {
        id: unverifiedSystemAdmin.user.id
      },
      data: {
        systemRole: "ADMIN"
      }
    });
    await request<TeamResponse[]>("GET", "/api/v1/teams", {
      token: unverifiedSystemAdmin.accessToken
    });
    await request<TeamResponse>("POST", "/api/v1/teams", {
      token: unverifiedSystemAdmin.accessToken,
      expectedStatus: 403,
      body: {
        name: `Unverified Admin Team ${runId}`,
        adminEmail: owner.email
      }
    });
    await request<EmailOutboxResponse[]>("GET", "/api/v1/system/email-outbox?status=ALL&limit=20", {
      token: unverifiedSystemAdmin.accessToken,
      expectedStatus: 403
    });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await request<EmailVerificationSendResponse>("POST", "/api/v1/auth/email-verification/send", {
        token: unverifiedSystemAdmin.accessToken
      });
    }

    const systemEmailOutbox = (await request<EmailOutboxResponse[]>(
      "GET",
      "/api/v1/system/email-outbox?status=ALL&limit=20",
      {
        token: owner.token
      }
    )).data;
    assert.ok(systemEmailOutbox.some((item) => item.toEmail === owner.email));
    assert.equal("actionPath" in systemEmailOutbox[0], false);
    await request<EmailOutboxResponse[]>("GET", "/api/v1/system/email-outbox?status=ALL&limit=20", {
      token: editor.token,
      expectedStatus: 403
    });
    await request<EmailOutboxResponse>("POST", `/api/v1/system/email-outbox/${systemEmailOutbox[0].id}/retry`, {
      token: owner.token,
      expectedStatus: 422
    });

    const rateLimitedEmail = `rate-limited-${runId}@${emailDomain}`;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await request<AuthResponse>("POST", "/api/v1/auth/login", {
        expectedStatus: 401,
        body: {
          email: rateLimitedEmail,
          password: "wrong-password"
        }
      });
    }
    await request<AuthResponse>("POST", "/api/v1/auth/login", {
      expectedStatus: 429,
      body: {
        email: rateLimitedEmail,
        password: "wrong-password"
      }
    });

    const feishuAuthorize = (await request<FeishuAuthorizeResponse>(
      "GET",
      "/api/v1/auth/feishu/authorize-url?redirectTo=/dashboard"
    )).data;
    if (process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET) {
      assert.equal(feishuAuthorize.configured, true);
      assert.ok(feishuAuthorize.authorizeUrl?.includes("/open-apis/authen/v1/index"));
      assert.ok(feishuAuthorize.authorizeUrl?.includes("scope=contact%3Auser.email%3Areadonly"));
    } else {
      assert.equal(feishuAuthorize.configured, false);
      assert.equal(feishuAuthorize.authorizeUrl, null);
    }
    await request<AuthResponse & { redirectTo: string }>("POST", "/api/v1/auth/feishu/callback", {
      expectedStatus: feishuAuthorize.configured ? 401 : 422,
      body: {
        code: "fake-code",
        state: "fake-state"
      }
    });
    const feishuWebhookToken = env.FEISHU_VERIFICATION_TOKEN || "integration-token";
    const feishuChallengeResponse = await fetch(`${baseUrl}/api/v1/feishu/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        type: "url_verification",
        token: feishuWebhookToken,
        challenge: `challenge-${runId}`
      })
    });
    const feishuChallenge = await feishuChallengeResponse.json() as { challenge?: string; error?: { message?: string } };
    assert.equal(feishuChallengeResponse.status, 200, feishuChallenge.error?.message);
    assert.equal(feishuChallenge.challenge, `challenge-${runId}`);

    const feishuWebhookEvent = (await request<FeishuWebhookResponse>("POST", "/api/v1/feishu/webhook", {
      body: {
        schema: "2.0",
        header: {
          event_id: `feishu-event-${runId}`,
          event_type: "im.message.receive_v1",
          token: feishuWebhookToken
        },
        event: {
          message: {
            message_id: `message-${runId}`
          }
        }
      }
    })).data;
    assert.equal(feishuWebhookEvent.ok, true);
    assert.equal(feishuWebhookEvent.duplicate, false);
    assert.equal(feishuWebhookEvent.eventType, "im.message.receive_v1");

    const duplicateFeishuWebhookEvent = (await request<FeishuWebhookResponse>("POST", "/api/v1/feishu/webhook", {
      body: {
        schema: "2.0",
        header: {
          event_id: `feishu-event-${runId}`,
          event_type: "im.message.receive_v1",
          token: feishuWebhookToken
        },
        event: {
          message: {
            message_id: `message-${runId}`
          }
        }
      }
    })).data;
    assert.equal(duplicateFeishuWebhookEvent.duplicate, true);

    if (env.FEISHU_VERIFICATION_TOKEN) {
      await request<FeishuWebhookResponse>("POST", "/api/v1/feishu/webhook", {
        expectedStatus: 401,
        body: {
          schema: "2.0",
          header: {
            event_id: `feishu-event-invalid-${runId}`,
            event_type: "im.message.receive_v1",
            token: "invalid-token"
          },
          event: {}
        }
      });
    }

    const updatedOwner = (await request<AuthResponse["user"]>("PATCH", "/api/v1/users/me/profile", {
      token: owner.token,
      body: {
        name: "Updated Owner",
        avatarUrl: "data:image/png;base64,iVBORw0KGgo="
      }
    })).data;
    assert.equal(updatedOwner.name, "Updated Owner");
    assert.equal(updatedOwner.avatarUrl, "data:image/png;base64,iVBORw0KGgo=");

    const ownerUpdatedEmail = `updated-owner@${emailDomain}`;
    const ownerEmailChange = (await request<EmailChangeResponse>("PATCH", "/api/v1/users/me/email", {
      token: owner.token,
      body: {
        email: ownerUpdatedEmail
      }
    })).data;
    assert.equal(ownerEmailChange.email, ownerUpdatedEmail);
    assert.equal(ownerEmailChange.user.email, owner.email);
    const updatedOwnerEmail = (await request<EmailVerificationResponse>("POST", "/api/v1/auth/email-verification/confirm", {
      body: {
        token: await latestEmailActionToken(ownerUpdatedEmail, AccountTokenType.EMAIL_CHANGE)
      }
    })).data;
    assert.equal(updatedOwnerEmail.email, ownerUpdatedEmail);
    owner.email = ownerUpdatedEmail;

    await request<EmailChangeResponse>("PATCH", "/api/v1/users/me/email", {
      token: owner.token,
      expectedStatus: 409,
      body: {
        email: editor.email
      }
    });

    const boundEditor = (await request<CurrentUserResponse>("PATCH", "/api/v1/users/me/feishu-binding", {
      token: editor.token,
      body: {
        openId: `ou_${runId}`,
        unionId: `on_${runId}`
      }
    })).data;
    assert.equal(boundEditor.feishuBound, true);
    assert.equal(boundEditor.hasPassword, true);
    assert.equal(boundEditor.feishuOpenId, `ou_${runId}`);

    await request<CurrentUserResponse>("PATCH", "/api/v1/users/me/feishu-binding", {
      token: viewer.token,
      expectedStatus: 409,
      body: {
        openId: `ou_${runId}`
      }
    });

    const boundDirectAddedMember = (await request<CurrentUserResponse>("PATCH", "/api/v1/users/me/feishu-binding", {
      token: directAddedMember.token,
      body: {
        openId: `ou_unbind_${runId}`
      }
    })).data;
    assert.equal(boundDirectAddedMember.feishuBound, true);
    const unboundDirectAddedMember = (await request<CurrentUserResponse>("DELETE", "/api/v1/users/me/feishu-binding", {
      token: directAddedMember.token
    })).data;
    assert.equal(unboundDirectAddedMember.feishuBound, false);

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
    const passwordReset = (await request<PasswordResetRequestResponse>("POST", "/api/v1/auth/password-reset/request", {
      body: {
        email: owner.email
      }
    })).data;
    assert.ok(passwordReset.ok);
    assert.equal(passwordReset.resetQueued, true);
    await request<{ ok: boolean }>("POST", "/api/v1/auth/password-reset/confirm", {
      body: {
        token: await latestEmailActionToken(owner.email, AccountTokenType.PASSWORD_RESET),
        newPassword: "Password789!"
      }
    });
    await request<AuthResponse>("POST", "/api/v1/auth/login", {
      expectedStatus: 401,
      body: {
        email: owner.email,
        password: "Password456!"
      }
    });
    await request<AuthResponse>("POST", "/api/v1/auth/login", {
      body: {
        email: owner.email,
        password: "Password789!"
      }
    });
    const missingPasswordReset = (await request<PasswordResetRequestResponse>("POST", "/api/v1/auth/password-reset/request", {
      body: {
        email: `missing-${runId}@${emailDomain}`
      }
    })).data;
    assert.equal(missingPasswordReset.ok, true);
    assert.equal(missingPasswordReset.resetQueued, false);
    const expiredVerificationEmail = `expired-verify@${emailDomain}`;
    await request<AuthResponse>("POST", "/api/v1/auth/register", {
      expectedStatus: 201,
      body: {
        email: expiredVerificationEmail,
        name: "Expired Verify",
        password: "Password123!"
      }
    });
    const expiredVerificationToken = await latestEmailActionToken(
      expiredVerificationEmail,
      AccountTokenType.EMAIL_VERIFY
    );
    await prisma.accountToken.update({
      where: {
        tokenHash: hashToken(expiredVerificationToken)
      },
      data: {
        expiresAt: new Date(Date.now() - 1000)
      }
    });
    await request<EmailVerificationResponse>("POST", "/api/v1/auth/email-verification/confirm", {
      expectedStatus: 401,
      body: {
        token: expiredVerificationToken
      }
    });

    const team = (await request<TeamResponse>("POST", "/api/v1/teams", {
      token: owner.token,
      expectedStatus: 201,
      body: {
        name: `Integration Team ${runId}`,
        adminEmail: owner.email
      }
    })).data;
    await request<TeamResponse>("POST", "/api/v1/teams", {
      token: owner.token,
      expectedStatus: 422,
      body: {
        name: `Integration Team ${runId}`,
        adminEmail: owner.email
      }
    });

    const ownerTeams = (await request<TeamResponse[]>("GET", "/api/v1/teams", {
      token: owner.token
    })).data;
    assert.ok(ownerTeams.some((item) => item.id === team.id));
    const ownerTeamMember = (await request<MemberResponse[]>("GET", `/api/v1/teams/${team.id}/members`, {
      token: owner.token
    })).data.find((member) => member.user?.id === owner.id);
    assert.ok(ownerTeamMember);
    await request<MemberResponse>("POST", `/api/v1/teams/${team.id}/members`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        email: `pending-last-admin@${emailDomain}`,
        role: "ADMIN"
      }
    });
    await request<MemberResponse>("PATCH", `/api/v1/teams/${team.id}/members/${ownerTeamMember.id}/role`, {
      token: owner.token,
      expectedStatus: 422,
      body: {
        role: "MEMBER"
      }
    });

    const disposableTeam = (await request<TeamResponse>("POST", "/api/v1/teams", {
      token: owner.token,
      expectedStatus: 201,
      body: {
        name: `Disposable Team ${runId}`,
        adminEmail: owner.email
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
      expectedStatus: 404
    });

    const trashOnlyTeam = (await request<TeamResponse>("POST", "/api/v1/teams", {
      token: owner.token,
      expectedStatus: 201,
      body: {
        name: `Trash Only Team ${runId}`,
        adminEmail: owner.email
      }
    })).data;
    const trashOnlyTeamAdmin = (await request<MemberResponse[]>("GET", `/api/v1/teams/${trashOnlyTeam.id}/members`, {
      token: owner.token
    })).data.find((member) => member.user?.id === owner.id);
    assert.ok(trashOnlyTeamAdmin);
    const trashOnlyProject = (await request<ProjectResponse>("POST", `/api/v1/teams/${trashOnlyTeam.id}/projects`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        name: `Trash Only Project ${runId}`,
        projectAdminTeamMemberId: trashOnlyTeamAdmin.id
      }
    })).data;
    await request<{ ok: boolean }>("DELETE", `/api/v1/projects/${trashOnlyProject.id}`, {
      token: owner.token
    });
    await request<{ ok: boolean }>("DELETE", `/api/v1/teams/${trashOnlyTeam.id}`, {
      token: owner.token,
      expectedStatus: 422
    });
    await request<{ ok: boolean }>("DELETE", `/api/v1/teams/${trashOnlyTeam.id}/project-trash/${trashOnlyProject.id}`, {
      token: owner.token
    });
    await request<{ ok: boolean }>("DELETE", `/api/v1/teams/${trashOnlyTeam.id}`, {
      token: owner.token
    });

    const editorTeamMember = (await request<MemberResponse>("POST", `/api/v1/teams/${team.id}/members`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        email: editor.email,
        role: "MEMBER"
      }
    })).data;
    const viewerTeamMember = (await request<MemberResponse>("POST", `/api/v1/teams/${team.id}/members`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        email: viewer.email,
        role: "MEMBER"
      }
    })).data;
    await request<MemberResponse>("POST", `/api/v1/teams/${team.id}/members`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        email: `missing-user@${emailDomain}`,
        role: "MEMBER"
      }
    });
    const batchImportedMembers = (await request<BatchImportMembersResponse>("POST", `/api/v1/teams/${team.id}/members/batch`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        members: [
          {
            email: `batch-admin@${emailDomain}`,
            role: "ADMIN",
            lineNumber: 2
          },
          {
            email: `batch-member@${emailDomain}`,
            role: "MEMBER",
            lineNumber: 3
          }
        ]
      }
    })).data;
    assert.equal(batchImportedMembers.importedCount, 2);
    assert.equal(batchImportedMembers.members.length, 2);
    assert.ok(batchImportedMembers.members.every((member) => member.status === "PENDING"));
    const membersBeforeRejectedBatch = (await request<MemberResponse[]>("GET", `/api/v1/teams/${team.id}/members`, {
      token: owner.token
    })).data.length;
    await request<BatchImportMembersResponse>("POST", `/api/v1/teams/${team.id}/members/batch`, {
      token: owner.token,
      expectedStatus: 422,
      body: {
        members: [
          {
            email: `batch-duplicate@${emailDomain}`,
            role: "MEMBER",
            lineNumber: 2
          },
          {
            email: `BATCH-DUPLICATE@${emailDomain}`,
            role: "ADMIN",
            lineNumber: 3
          }
        ]
      }
    });
    const membersAfterRejectedBatch = (await request<MemberResponse[]>("GET", `/api/v1/teams/${team.id}/members`, {
      token: owner.token
    })).data.length;
    assert.equal(membersAfterRejectedBatch, membersBeforeRejectedBatch);
    const directAddedTeamMember = (await request<MemberResponse>("POST", `/api/v1/teams/${team.id}/members`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        email: ` ${directAddedMember.email.toUpperCase()} `,
        role: "MEMBER"
      }
    })).data;
    assert.equal(directAddedTeamMember.email, directAddedMember.email);
    const duplicateCaseTeamMember = (await request<MemberResponse>("POST", `/api/v1/teams/${team.id}/members`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        email: directAddedMember.email.toUpperCase(),
        role: "MEMBER"
      }
    })).data;
    assert.equal(duplicateCaseTeamMember.id, directAddedTeamMember.id);
    await request<MemberResponse>("PATCH", `/api/v1/teams/${team.id}/members/${directAddedTeamMember.id}/role`, {
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
    await request<ProjectResponse>("POST", `/api/v1/teams/${team.id}/projects`, {
      token: owner.token,
      expectedStatus: 422,
      body: {
        name: "System admin must choose a project admin"
      }
    });

    const project = (await request<ProjectResponse>("POST", `/api/v1/teams/${team.id}/projects`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        name: `Integration Project ${runId}`,
        description: "V0 integration workflow",
        projectAdminTeamMemberId: directAddedTeamMember.id
      }
    })).data;
    const projectMembersForSystemAdmin = (await request<MemberResponse[]>(
      "GET",
      `/api/v1/projects/${project.id}/members`,
      {
        token: systemAdminOnly.token
      }
    )).data;
    assert.ok(!projectMembersForSystemAdmin.some((member) => member.user?.id === systemAdminOnly.id));
    assert.ok(!projectMembersForSystemAdmin.some((member) => member.user?.id === owner.id));
    assert.ok(
      projectMembersForSystemAdmin.some(
        (member) => member.user?.id === directAddedMember.id && member.role === "ADMIN"
      )
    );
    const directProjectAdmin = projectMembersForSystemAdmin.find(
      (member) => member.user?.id === directAddedMember.id && member.role === "ADMIN"
    );
    assert.ok(directProjectAdmin);
    const readdedProjectAdmin = (await request<MemberResponse>("POST", `/api/v1/projects/${project.id}/members`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        teamMemberId: directAddedTeamMember.id,
        role: "EDITOR"
      }
    })).data;
    assert.equal(readdedProjectAdmin.id, directProjectAdmin.id);
    assert.equal(readdedProjectAdmin.role, "ADMIN");
    const pendingProjectAdminTeamMember = (await request<MemberResponse>("POST", `/api/v1/teams/${team.id}/members`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        email: `pending-project-admin@${emailDomain}`,
        role: "MEMBER"
      }
    })).data;
    await request<MemberResponse>("POST", `/api/v1/projects/${project.id}/members`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        teamMemberId: pendingProjectAdminTeamMember.id,
        role: "ADMIN"
      }
    });
    await request<MemberResponse>("PATCH", `/api/v1/projects/${project.id}/members/${directProjectAdmin.id}/role`, {
      token: owner.token,
      expectedStatus: 422,
      body: {
        role: "EDITOR"
      }
    });
    await request<TaskResponse>("POST", `/api/v1/projects/${project.id}/tasks`, {
      token: owner.token,
      expectedStatus: 422,
      body: {
        title: "Cannot assign system admin only",
        projectMemberIds: [systemAdminOnly.id]
      }
    });
    const defaultJoinUser = await registerUser("DefaultJoinUser");
    const defaultJoinTeams = (await request<TeamResponse[]>("GET", "/api/v1/teams", {
      token: defaultJoinUser.token
    })).data;
    assert.equal(defaultJoinTeams.some((item) => item.id === team.id), false);
    await request<ProjectResponse[]>("GET", `/api/v1/teams/${team.id}/projects`, {
      token: defaultJoinUser.token,
      expectedStatus: 403
    });
    const emailUpdateClaimEmail = `email-update-claim@${emailDomain}`;
    const emailUpdatePendingTeamMember = (await request<MemberResponse>("POST", `/api/v1/teams/${team.id}/members`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        email: emailUpdateClaimEmail,
        role: "ADMIN"
      }
    })).data;
    const emailUpdatePendingProjectMember = (await request<MemberResponse>("POST", `/api/v1/projects/${project.id}/members`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        teamMemberId: emailUpdatePendingTeamMember.id,
        role: "ADMIN"
      }
    })).data;
    const emailUpdateClaimTask = (await request<TaskResponse>("POST", `/api/v1/projects/${project.id}/tasks`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        title: "Email update claims pending assignment",
        projectMemberIds: [emailUpdatePendingProjectMember.id]
      }
    })).data;
    const emailUpdateClaimRequest = (await request<EmailChangeResponse>("PATCH", "/api/v1/users/me/email", {
      token: defaultJoinUser.token,
      body: {
        email: emailUpdateClaimEmail
      }
    })).data;
    assert.equal(emailUpdateClaimRequest.verificationQueued, true);
    await request<EmailVerificationResponse>("POST", "/api/v1/auth/email-verification/confirm", {
      body: {
        token: await latestEmailActionToken(emailUpdateClaimEmail, AccountTokenType.EMAIL_CHANGE)
      }
    });
    const emailUpdateClaimedTeamMembers = (await request<MemberResponse[]>("GET", `/api/v1/teams/${team.id}/members`, {
      token: owner.token
    })).data;
    assert.ok(
      emailUpdateClaimedTeamMembers.some(
        (member) => member.user?.id === defaultJoinUser.id && member.role === "ADMIN"
      )
    );
    assert.equal(
      emailUpdateClaimedTeamMembers.some(
        (member) => member.email === emailUpdateClaimEmail && member.status === "PENDING"
      ),
      false
    );
    const emailUpdateClaimedTasks = (await request<MyTaskResponse[]>("GET", "/api/v1/users/me/tasks", {
      token: defaultJoinUser.token
    })).data;
    assert.ok(emailUpdateClaimedTasks.some((item) => item.id === emailUpdateClaimTask.id));
    await request<ProjectResponse>("POST", `/api/v1/teams/${team.id}/projects`, {
      token: owner.token,
      expectedStatus: 422,
      body: {
        name: `Integration Project ${runId}`,
        projectAdminTeamMemberId: directAddedTeamMember.id
      }
    });
    const restorableProject = (await request<ProjectResponse>("POST", `/api/v1/teams/${team.id}/projects`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        name: `Restorable Project ${runId}`,
        projectAdminTeamMemberId: directAddedTeamMember.id
      }
    })).data;
    await request<{ ok: boolean }>("DELETE", `/api/v1/projects/${restorableProject.id}`, {
      token: owner.token
    });
    let teamProjectTrash = (await request<TeamProjectTrashResponse>(
      "GET",
      `/api/v1/teams/${team.id}/project-trash`,
      {
        token: owner.token
      }
    )).data;
    assert.ok(
      teamProjectTrash.projects.some(
        (trashProject) =>
          trashProject.id === restorableProject.id && trashProject.deletedBy?.id === owner.id
      )
    );
    const restoredProject = (await request<ProjectResponse>(
      "PATCH",
      `/api/v1/teams/${team.id}/project-trash/${restorableProject.id}/restore`,
      {
        token: owner.token
      }
    )).data;
    assert.equal(restoredProject.id, restorableProject.id);
    const projectsAfterRestore = (await request<ProjectResponse[]>("GET", `/api/v1/teams/${team.id}/projects`, {
      token: owner.token
    })).data;
    assert.ok(projectsAfterRestore.some((item) => item.id === restorableProject.id));

    const purgeProject = (await request<ProjectResponse>("POST", `/api/v1/teams/${team.id}/projects`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        name: `Purge Project ${runId}`,
        projectAdminTeamMemberId: directAddedTeamMember.id
      }
    })).data;
    await request<{ ok: boolean }>("DELETE", `/api/v1/projects/${purgeProject.id}`, {
      token: owner.token
    });
    await request<{ ok: boolean }>("DELETE", `/api/v1/teams/${team.id}/project-trash/${purgeProject.id}`, {
      token: owner.token
    });
    await request<ProjectResponse>("GET", `/api/v1/projects/${purgeProject.id}`, {
      token: owner.token,
      expectedStatus: 404
    });
    const trashAfterPurge = (await request<TeamProjectTrashResponse>(
      "GET",
      `/api/v1/teams/${team.id}/project-trash`,
      {
        token: owner.token
      }
    )).data;
    assert.ok(!trashAfterPurge.projects.some((trashProject) => trashProject.id === purgeProject.id));

    const conflictProject = (await request<ProjectResponse>("POST", `/api/v1/teams/${team.id}/projects`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        name: `Trash Conflict Project ${runId}`,
        projectAdminTeamMemberId: directAddedTeamMember.id
      }
    })).data;
    await request<{ ok: boolean }>("DELETE", `/api/v1/projects/${conflictProject.id}`, {
      token: owner.token
    });
    await request<ProjectResponse>("POST", `/api/v1/teams/${team.id}/projects`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        name: `Trash Conflict Project ${runId}`,
        projectAdminTeamMemberId: directAddedTeamMember.id
      }
    });
    await request<ProjectResponse>(
      "PATCH",
      `/api/v1/teams/${team.id}/project-trash/${conflictProject.id}/restore`,
      {
        token: owner.token,
        expectedStatus: 422
      }
    );
    teamProjectTrash = (await request<TeamProjectTrashResponse>(
      "GET",
      `/api/v1/teams/${team.id}/project-trash`,
      {
        token: directAddedMember.token
      }
    )).data;
    assert.ok(teamProjectTrash.projects.some((trashProject) => trashProject.id === conflictProject.id));
    await request<TeamProjectTrashResponse>("GET", `/api/v1/teams/${team.id}/project-trash`, {
      token: editor.token,
      expectedStatus: 403
    });

    const autoAdminEmail = `auto-admin@${emailDomain}`;
    const pendingAutoAdmin = (await request<MemberResponse>("POST", `/api/v1/teams/${team.id}/members`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        email: autoAdminEmail,
        role: "ADMIN"
      }
    })).data;
    assert.equal(pendingAutoAdmin.status, "PENDING");
    assert.equal(pendingAutoAdmin.role, "ADMIN");
    const pendingAutoAdminListItem = (await request<MemberResponse[]>("GET", `/api/v1/teams/${team.id}/members`, {
      token: owner.token
    })).data.find((member) => member.id === pendingAutoAdmin.id);
    assert.ok(pendingAutoAdminListItem?.inviteAcceptPath?.includes("token="));

    const autoAdmin = (await request<AuthResponse>("POST", "/api/v1/auth/register", {
      expectedStatus: 201,
      body: {
        email: autoAdminEmail,
        name: "Auto Admin",
        password: "Password123!"
      }
    })).data;
    let autoAdminMembers = (await request<MemberResponse[]>("GET", `/api/v1/teams/${team.id}/members`, {
      token: owner.token
    })).data;
    assert.equal(
      autoAdminMembers.some((member) => member.user?.id === autoAdmin.user.id && member.role === "ADMIN"),
      false
    );
    const unverifiedAutoAdminLogin = (await request<AuthResponse>("POST", "/api/v1/auth/login", {
      body: {
        email: autoAdminEmail,
        password: "Password123!"
      }
    })).data;
    autoAdminMembers = (await request<MemberResponse[]>("GET", `/api/v1/teams/${team.id}/members`, {
      token: owner.token
    })).data;
    assert.equal(
      autoAdminMembers.some((member) => member.user?.id === autoAdmin.user.id && member.role === "ADMIN"),
      false
    );
    const unverifiedAutoAdminTeams = (await request<TeamResponse[]>("GET", "/api/v1/teams", {
      token: unverifiedAutoAdminLogin.accessToken
    })).data;
    assert.equal(unverifiedAutoAdminTeams.some((item) => item.id === team.id), false);
    await verifyRegisteredEmail(autoAdmin);
    autoAdminMembers = (await request<MemberResponse[]>("GET", `/api/v1/teams/${team.id}/members`, {
      token: owner.token
    })).data;
    assert.ok(
      autoAdminMembers.some((member) => member.user?.id === autoAdmin.user.id && member.role === "ADMIN")
    );

    const registeredTeamMember = (await request<MemberResponse>("POST", `/api/v1/teams/${team.id}/members`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        email: invitedTeamMember.email,
        role: "MEMBER"
      }
    })).data;
    assert.equal(registeredTeamMember.status, "ACTIVE");

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

    const pendingTeamEmail = `pending-team-member@${emailDomain}`;
    const pendingTeamMemberForSignup = (await request<MemberResponse>("POST", `/api/v1/teams/${team.id}/members`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        email: pendingTeamEmail,
        role: "MEMBER"
      }
    })).data;
    assert.equal(pendingTeamMemberForSignup.status, "PENDING");
    const pendingTeamMemberListItem = (await request<MemberResponse[]>("GET", `/api/v1/teams/${team.id}/members`, {
      token: owner.token
    })).data.find((member) => member.id === pendingTeamMemberForSignup.id);
    assert.ok(pendingTeamMemberListItem?.inviteAcceptPath?.includes("token="));

    const claimedTeamOnlyUser = (await request<AuthResponse>("POST", "/api/v1/auth/register", {
      expectedStatus: 201,
      body: {
        email: pendingTeamEmail,
        name: "Pending Team Member",
        password: "Password123!"
      }
    })).data;
    let claimedTeamMembers = (await request<MemberResponse[]>("GET", `/api/v1/teams/${team.id}/members`, {
      token: owner.token
    })).data;
    assert.equal(
      claimedTeamMembers.some(
        (member) => member.user?.id === claimedTeamOnlyUser.user.id && member.status === "ACTIVE"
      ),
      false
    );
    const unverifiedTeamLogin = (await request<AuthResponse>("POST", "/api/v1/auth/login", {
      body: {
        email: pendingTeamEmail,
        password: "Password123!"
      }
    })).data;
    claimedTeamMembers = (await request<MemberResponse[]>("GET", `/api/v1/teams/${team.id}/members`, {
      token: owner.token
    })).data;
    assert.equal(
      claimedTeamMembers.some(
        (member) => member.user?.id === claimedTeamOnlyUser.user.id && member.status === "ACTIVE"
      ),
      false
    );
    const unverifiedTeamMemberships = (await request<TeamResponse[]>("GET", "/api/v1/teams", {
      token: unverifiedTeamLogin.accessToken
    })).data;
    assert.equal(unverifiedTeamMemberships.some((item) => item.id === team.id), false);
    await verifyRegisteredEmail(claimedTeamOnlyUser);
    claimedTeamMembers = (await request<MemberResponse[]>("GET", `/api/v1/teams/${team.id}/members`, {
      token: owner.token
    })).data;
    assert.ok(
      claimedTeamMembers.some(
        (member) => member.user?.id === claimedTeamOnlyUser.user.id && member.status === "ACTIVE"
      )
    );

    const pendingRemovalTeam = (await request<TeamResponse>("POST", "/api/v1/teams", {
      token: owner.token,
      expectedStatus: 201,
      body: {
        name: `Pending Removal Team ${runId}`,
        adminEmail: owner.email
      }
    })).data;
    const removedPendingEmail = `removed-pending@${emailDomain}`;
    const removedPendingMember = (await request<MemberResponse>("POST", `/api/v1/teams/${pendingRemovalTeam.id}/members`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        email: removedPendingEmail,
        role: "MEMBER"
      }
    })).data;
    await request<{ ok: boolean }>("DELETE", `/api/v1/teams/${pendingRemovalTeam.id}/members/${removedPendingMember.id}`, {
      token: owner.token
    });
    const revokedRegistrationLink = await prisma.invitation.findFirst({
      where: {
        email: removedPendingEmail,
        teamId: pendingRemovalTeam.id,
        status: "REVOKED"
      }
    });
    assert.ok(revokedRegistrationLink);
    const removedPendingUser = (await request<AuthResponse>("POST", "/api/v1/auth/register", {
      expectedStatus: 201,
      body: {
        email: removedPendingEmail,
        name: "Removed Pending Member",
        password: "Password123!"
      }
    })).data;
    await verifyRegisteredEmail(removedPendingUser);
    const removedPendingTeams = (await request<TeamResponse[]>("GET", "/api/v1/teams", {
      token: removedPendingUser.accessToken
    })).data;
    assert.equal(removedPendingTeams.some((item) => item.id === pendingRemovalTeam.id), false);
    await request<{ ok: boolean }>("DELETE", `/api/v1/teams/${pendingRemovalTeam.id}`, {
      token: owner.token
    });

    await request<{ ok: boolean }>("DELETE", `/api/v1/teams/${team.id}`, {
      token: owner.token,
      expectedStatus: 422
    });

    const pendingProjectEmail = `pending-project-member@${emailDomain}`;
    const pendingProjectTeamMember = (await request<MemberResponse>("POST", `/api/v1/teams/${team.id}/members`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        email: pendingProjectEmail,
        role: "MEMBER"
      }
    })).data;
    const pendingProjectMemberForSignup = (await request<MemberResponse>("POST", `/api/v1/projects/${project.id}/members`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        teamMemberId: pendingProjectTeamMember.id,
        role: "EDITOR"
      }
    })).data;
    assert.equal(pendingProjectMemberForSignup.status, "PENDING");
    assert.equal(pendingProjectMemberForSignup.role, "EDITOR");
    const pendingProjectMemberListItem = (await request<MemberResponse[]>(
      "GET",
      `/api/v1/projects/${project.id}/members`,
      {
        token: owner.token
      }
    )).data.find((member) => member.id === pendingProjectMemberForSignup.id);
    assert.ok(pendingProjectMemberListItem?.inviteAcceptPath?.includes("token="));
    assert.equal(pendingProjectTeamMember?.status, "PENDING");
    assert.equal(pendingProjectTeamMember?.role, "MEMBER");

    const claimedProjectOnlyUser = (await request<AuthResponse>("POST", "/api/v1/auth/register", {
      expectedStatus: 201,
      body: {
        email: pendingProjectEmail,
        name: "Pending Project Member",
        password: "Password123!"
      }
    })).data;

    let claimedProjectMembers = (await request<MemberResponse[]>(
      "GET",
      `/api/v1/projects/${project.id}/members`,
      {
        token: owner.token
      }
    )).data;
    assert.equal(
      claimedProjectMembers.some(
        (member) => member.user?.id === claimedProjectOnlyUser.user.id && member.status === "ACTIVE"
      ),
      false
    );
    const unverifiedProjectLogin = (await request<AuthResponse>("POST", "/api/v1/auth/login", {
      body: {
        email: pendingProjectEmail,
        password: "Password123!"
      }
    })).data;
    claimedProjectMembers = (await request<MemberResponse[]>(
      "GET",
      `/api/v1/projects/${project.id}/members`,
      {
        token: owner.token
      }
    )).data;
    assert.equal(
      claimedProjectMembers.some(
        (member) => member.user?.id === claimedProjectOnlyUser.user.id && member.status === "ACTIVE"
      ),
      false
    );
    await request<ProjectResponse[]>("GET", `/api/v1/teams/${team.id}/projects`, {
      token: unverifiedProjectLogin.accessToken,
      expectedStatus: 403
    });
    await verifyRegisteredEmail(claimedProjectOnlyUser);

    claimedProjectMembers = (await request<MemberResponse[]>(
      "GET",
      `/api/v1/projects/${project.id}/members`,
      {
        token: owner.token
      }
    )).data;
    assert.ok(
      claimedProjectMembers.some(
        (member) => member.user?.id === claimedProjectOnlyUser.user.id && member.status === "ACTIVE"
      )
    );

    const ownerTeamMemberBeforeProjectAdd = (await request<MemberResponse[]>("GET", `/api/v1/teams/${team.id}/members`, {
      token: owner.token
    })).data.find((member) => member.user?.id === owner.id);
    assert.ok(ownerTeamMemberBeforeProjectAdd);
    await request<MemberResponse>("POST", `/api/v1/projects/${project.id}/members`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        teamMemberId: ownerTeamMemberBeforeProjectAdd.id,
        role: "EDITOR"
      }
    });
    const ownerMemberAfterProjectAdd = (await request<MemberResponse[]>("GET", `/api/v1/teams/${team.id}/members`, {
      token: owner.token
    })).data.find((member) => member.user?.id === owner.id);
    assert.equal(ownerMemberAfterProjectAdd?.role, "ADMIN");

    const editorProjectMember = (await request<MemberResponse>("POST", `/api/v1/projects/${project.id}/members`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        teamMemberId: editorTeamMember.id,
        role: "EDITOR"
      }
    })).data;
    await request<MemberResponse>("POST", `/api/v1/projects/${project.id}/members`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        teamMemberId: viewerTeamMember.id,
        role: "VIEWER"
      }
    });

    const pendingAssigneeEmail = `pending-assignee@${emailDomain}`;
    const pendingTeamMember = (await request<MemberResponse>("POST", `/api/v1/teams/${team.id}/members`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        email: pendingAssigneeEmail,
        role: "MEMBER"
      }
    })).data;
    assert.equal(pendingTeamMember.status, "PENDING");
    const pendingProjectMember = (await request<MemberResponse>("POST", `/api/v1/projects/${project.id}/members`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        teamMemberId: pendingTeamMember.id,
        role: "EDITOR"
      }
    })).data;
    assert.equal(pendingProjectMember.status, "PENDING");
    const pendingAssignedTask = (await request<TaskResponse>("POST", `/api/v1/projects/${project.id}/tasks`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        title: "Pending member can be assigned before signup",
        projectMemberIds: [pendingProjectMember.id]
      }
    })).data;
    assert.equal(pendingAssignedTask.assignees?.[0]?.status, "PENDING");

    const claimedPendingUser = (await request<AuthResponse>("POST", "/api/v1/auth/register", {
      expectedStatus: 201,
      body: {
        email: pendingAssigneeEmail,
        name: "Pending Assignee",
        password: "Password123!"
      }
    })).data;
    let claimedTasks = (await request<MyTaskResponse[]>("GET", "/api/v1/users/me/tasks", {
      token: claimedPendingUser.accessToken
    })).data;
    assert.equal(claimedTasks.some((item) => item.id === pendingAssignedTask.id), false);
    const unverifiedAssigneeLogin = (await request<AuthResponse>("POST", "/api/v1/auth/login", {
      body: {
        email: pendingAssigneeEmail,
        password: "Password123!"
      }
    })).data;
    claimedTasks = (await request<MyTaskResponse[]>("GET", "/api/v1/users/me/tasks", {
      token: unverifiedAssigneeLogin.accessToken
    })).data;
    assert.equal(claimedTasks.some((item) => item.id === pendingAssignedTask.id), false);
    await verifyRegisteredEmail(claimedPendingUser);
    claimedTasks = (await request<MyTaskResponse[]>("GET", "/api/v1/users/me/tasks", {
      token: claimedPendingUser.accessToken
    })).data;
    assert.ok(claimedTasks.some((item) => item.id === pendingAssignedTask.id));
    const claimedNotifications = (await request<NotificationResponse[]>("GET", "/api/v1/users/me/notifications", {
      token: claimedPendingUser.accessToken
    })).data;
    assert.equal(claimedNotifications.some((notification) => notification.type === "TASK_ASSIGNED"), false);

    const lists = (await request<TaskListResponse[]>("GET", `/api/v1/projects/${project.id}/lists`, {
      token: owner.token
    })).data;
    assert.equal(lists.length, 1);
    const initialDefaultList = lists[0];
    assert.equal(initialDefaultList.name, "默认清单");
    assert.equal(initialDefaultList.isDefault, true);

    const defaultedTask = (await request<TaskResponse>("POST", `/api/v1/projects/${project.id}/tasks`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        title: "Task creates default list"
      }
    })).data;
    assert.equal(defaultedTask.status, "TODO");
    assert.equal(defaultedTask.taskListId, initialDefaultList.id);
    const listsAfterDefaultTask = (await request<TaskListResponse[]>("GET", `/api/v1/projects/${project.id}/lists`, {
      token: owner.token
    })).data;
    assert.equal(listsAfterDefaultTask.length, 1);
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
    let projectTrash = (await request<ProjectTrashResponse>("GET", `/api/v1/projects/${project.id}/trash`, {
      token: owner.token
    })).data;
    assert.ok(
      projectTrash.taskLists.some(
        (list) => list.id === anotherList.id && list.taskCount === 1 && list.deletedBy?.id === owner.id
      )
    );
    assert.ok(!projectTrash.tasks.some((trashTask) => trashTask.id === taskDeletedWithList.id));

    await request<{ ok: boolean }>(
      "PATCH",
      `/api/v1/projects/${project.id}/trash/lists/${anotherList.id}/restore`,
      {
        token: owner.token
      }
    );
    const restoredListTask = (await request<TaskResponse>("GET", `/api/v1/tasks/${taskDeletedWithList.id}`, {
      token: owner.token
    })).data;
    assert.equal(restoredListTask.id, taskDeletedWithList.id);

    await request<{ ok: boolean }>("DELETE", `/api/v1/projects/${project.id}/lists/${anotherList.id}`, {
      token: owner.token
    });
    await request<TaskListResponse>("POST", `/api/v1/projects/${project.id}/lists`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        name: "测试清单"
      }
    });
    await request<{ ok: boolean }>(
      "PATCH",
      `/api/v1/projects/${project.id}/trash/lists/${anotherList.id}/restore`,
      {
        token: owner.token,
        expectedStatus: 422
      }
    );
    await request<{ ok: boolean }>("DELETE", `/api/v1/projects/${project.id}/trash/lists/${anotherList.id}`, {
      token: owner.token
    });
    projectTrash = (await request<ProjectTrashResponse>("GET", `/api/v1/projects/${project.id}/trash`, {
      token: owner.token
    })).data;
    assert.ok(!projectTrash.taskLists.some((list) => list.id === anotherList.id));

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
        projectMemberIds: [editorProjectMember.id]
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
    const taskAssignedNotification = editorNotifications.find(
      (notification) => notification.type === "TASK_ASSIGNED" && notification.content === task.title
    );
    assert.ok(taskAssignedNotification);
    const feishuDelivery = await prisma.notificationDelivery.findFirst({
      where: {
        notificationId: taskAssignedNotification.id,
        channel: "FEISHU"
      }
    });
    assert.equal(feishuDelivery?.status, "PENDING");

    const feishuDeliveries = (await request<FeishuDeliveryResponse[]>(
      "GET",
      `/api/v1/projects/${project.id}/feishu-deliveries`,
      {
        token: owner.token
      }
    )).data;
    assert.ok(feishuDeliveries.some((delivery) => delivery.id === feishuDelivery?.id));
    assert.ok(feishuDeliveries.some((delivery) => delivery.recipient.id === editor.id && delivery.recipient.feishuBound));
    assert.ok(feishuDeliveries.some((delivery) => delivery.id === feishuDelivery?.id && delivery.canRetry));

    const oldFeishuNotification = await prisma.notification.create({
      data: {
        type: "TASK_ASSIGNED",
        title: "Old Feishu notification",
        content: "Old Feishu notification content",
        recipientId: editor.id,
        actorId: owner.id,
        teamId: team.id,
        projectId: project.id,
        taskId: task.id,
        dedupeKey: `old-feishu-cleanup-${runId}`,
        createdAt: new Date("2020-01-04T08:00:00.000Z"),
        deliveries: {
          create: [
            {
              channel: "FEISHU",
              status: "SENT",
              sentAt: new Date("2020-01-04T08:05:00.000Z"),
              createdAt: new Date("2020-01-04T08:00:00.000Z")
            },
            {
              channel: "FEISHU",
              status: "PENDING",
              createdAt: new Date("2020-01-04T09:00:00.000Z")
            }
          ]
        }
      },
      include: {
        deliveries: true
      }
    });
    const clearFeishuDeliveries = (await request<ClearFeishuDeliveriesResponse>(
      "POST",
      `/api/v1/projects/${project.id}/feishu-deliveries/clear`,
      {
        token: owner.token,
        body: {
          startDate: "2020-01-04",
          endDate: "2020-01-04",
          status: "ALL"
        }
      }
    )).data;
    assert.equal(clearFeishuDeliveries.deletedCount, 1);
    const oldSentDelivery = oldFeishuNotification.deliveries.find((delivery) => delivery.status === "SENT");
    const oldPendingDelivery = oldFeishuNotification.deliveries.find((delivery) => delivery.status === "PENDING");
    assert.equal(await prisma.notificationDelivery.count({ where: { id: oldSentDelivery!.id } }), 0);
    assert.equal(await prisma.notificationDelivery.count({ where: { id: oldPendingDelivery!.id } }), 1);

    await request<ClearFeishuDeliveriesResponse>(
      "POST",
      `/api/v1/projects/${project.id}/feishu-deliveries/clear`,
      {
        token: owner.token,
        body: {
          startDate: "2020-01-04",
          endDate: "2020-01-04",
          status: "PENDING"
        },
        expectedStatus: 400
      }
    );

    await request<FeishuDeliveryResponse[]>(
      "GET",
      `/api/v1/projects/${project.id}/feishu-deliveries`,
      {
        token: editor.token,
        expectedStatus: 403
      }
    );
    await request<ClearFeishuDeliveriesResponse>(
      "POST",
      `/api/v1/projects/${project.id}/feishu-deliveries/clear`,
      {
        token: editor.token,
        body: {
          startDate: "2020-01-04",
          endDate: "2020-01-04",
          status: "ALL"
        },
        expectedStatus: 403
      }
    );
    await request<FeishuDeliveryResponse>(
      "POST",
      `/api/v1/projects/${project.id}/feishu-deliveries/${feishuDelivery!.id}/retry`,
      {
        token: editor.token,
        expectedStatus: 403
      }
    );

    if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET) {
      await request<FeishuDeliveryResponse>(
        "POST",
        `/api/v1/projects/${project.id}/feishu-deliveries/${feishuDelivery!.id}/retry`,
        {
          token: owner.token,
          expectedStatus: 422
        }
      );
    }

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
        projectMemberIds: [editorProjectMember.id]
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

    const projectTaskListView = (await request<TaskListResponse[]>("GET", `/api/v1/projects/${project.id}/tasks`, {
      token: viewer.token
    })).data;
    const listViewTasks = projectTaskListView.flatMap((list) => list.tasks);
    assert.ok(listViewTasks.some((item) => item.id === task.id));
    assert.ok(listViewTasks.some((item) => item.id === subTask.id && item.parentId === task.id));
    assert.ok(
      listViewTasks.some((item) => item.id === secondLevelSubTask.id && item.parentId === subTask.id)
    );

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
        projectMemberIds: [editorProjectMember.id]
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
    const trashAfterTaskDelete = (await request<ProjectTrashResponse>("GET", `/api/v1/projects/${project.id}/trash`, {
      token: owner.token
    })).data;
    assert.ok(
      trashAfterTaskDelete.tasks.some(
        (trashTask) => trashTask.id === dueSoonTask.id && trashTask.deletedBy?.id === owner.id
      )
    );
    await request<{ ok: boolean }>("PATCH", `/api/v1/tasks/${dueSoonTask.id}/restore`, {
      token: owner.token
    });
    const restoredDueSoonTask = (await request<TaskResponse>("GET", `/api/v1/tasks/${dueSoonTask.id}`, {
      token: owner.token
    })).data;
    assert.equal(restoredDueSoonTask.id, dueSoonTask.id);
    await request<{ ok: boolean }>("DELETE", `/api/v1/tasks/${dueSoonTask.id}`, {
      token: owner.token
    });
    await request<{ ok: boolean }>("DELETE", `/api/v1/tasks/${dueSoonTask.id}/purge`, {
      token: owner.token
    });
    const trashAfterTaskPurge = (await request<ProjectTrashResponse>("GET", `/api/v1/projects/${project.id}/trash`, {
      token: owner.token
    })).data;
    assert.ok(!trashAfterTaskPurge.tasks.some((trashTask) => trashTask.id === dueSoonTask.id));

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

    const mentionComment = (await request<CommentResponse>("POST", `/api/v1/tasks/${task.id}/comments`, {
      token: editor.token,
      expectedStatus: 201,
      body: {
        content: `@${viewer.name} please check this mention`,
        mentionIds: [viewer.id, editor.id]
      }
    })).data;
    assert.deepEqual(
      mentionComment.mentions.map((mention) => mention.id).sort(),
      [editor.id, viewer.id].sort()
    );
    const taskAfterMentionComment = (await request<TaskDetailResponse>("GET", `/api/v1/tasks/${task.id}`, {
      token: owner.token
    })).data;
    assert.ok(
      taskAfterMentionComment.comments.some(
        (comment) =>
          comment.id === mentionComment.id &&
          comment.mentions.some((mention) => mention.id === viewer.id)
      )
    );
    const typedMentionComment = (await request<CommentResponse>("POST", `/api/v1/tasks/${task.id}/comments`, {
      token: editor.token,
      expectedStatus: 201,
      body: {
        content: `@${viewer.name} typed mention without explicit ids`
      }
    })).data;
    assert.ok(typedMentionComment.mentions.some((mention) => mention.id === viewer.id));
    await request<CommentResponse>("POST", `/api/v1/tasks/${task.id}/comments`, {
      token: editor.token,
      expectedStatus: 422,
      body: {
        content: `@${systemAdminOnly.name} should fail`,
        mentionIds: [systemAdminOnly.id]
      }
    });
    const viewerNotificationsAfterMention = (await request<NotificationResponse[]>(
      "GET",
      "/api/v1/users/me/notifications",
      {
        token: viewer.token
      }
    )).data;
    assert.ok(
      viewerNotificationsAfterMention.some(
        (notification) =>
          notification.type === "COMMENT_MENTION" &&
          notification.content.includes("please check this mention")
      )
    );
    assert.ok(
      !viewerNotificationsAfterMention.some(
        (notification) =>
          notification.type === "TASK_COMMENTED" &&
          notification.content.includes("please check this mention")
      )
    );
    const editorNotificationsAfterSelfMention = (await request<NotificationResponse[]>(
      "GET",
      "/api/v1/users/me/notifications",
      {
        token: editor.token
      }
    )).data;
    assert.ok(
      !editorNotificationsAfterSelfMention.some(
        (notification) =>
          notification.type === "COMMENT_MENTION" &&
          notification.content.includes("please check this mention")
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
    assert.ok(teamActivity.some((log) => log.action === "project.deleted"));
    assert.ok(teamActivity.some((log) => log.action === "project.restored"));
    assert.ok(teamActivity.some((log) => log.action === "project.purged"));
    assert.ok(!teamActivity.some((log) => log.action.startsWith("task.")));
    assert.ok(!teamActivity.some((log) => log.action.startsWith("task_list.")));
    assert.ok(!teamActivity.some((log) => log.action.startsWith("comment.")));
    assert.ok(!teamActivity.some((log) => log.action.startsWith("project_invitation.")));

    await request<ActivityLogResponse[]>("GET", `/api/v1/teams/${team.id}/activity`, {
      token: editor.token,
      expectedStatus: 403
    });

    const oldTeamLog = await prisma.activityLog.create({
      data: {
        actorId: owner.id,
        teamId: team.id,
        action: "project.created",
        targetType: "project",
        targetId: "old-team-log",
        metadata: {
          name: "Old Team Log"
        },
        createdAt: new Date("2020-01-02T08:00:00.000Z")
      }
    });
    const clearTeamActivity = (await request<ClearActivityLogsResponse>(
      "POST",
      `/api/v1/teams/${team.id}/activity/clear`,
      {
        token: owner.token,
        body: {
          startDate: "2020-01-02",
          endDate: "2020-01-02"
        }
      }
    )).data;
    assert.equal(clearTeamActivity.deletedCount, 1);
    assert.equal(await prisma.activityLog.count({ where: { id: oldTeamLog.id } }), 0);

    const teamActivityAfterClear = (await request<ActivityLogResponse[]>(
      "GET",
      `/api/v1/teams/${team.id}/activity`,
      {
        token: owner.token
      }
    )).data;
    assert.ok(teamActivityAfterClear.some((log) => log.action === "activity_log.cleared"));

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
    assert.ok(projectActivity.some((log) => log.action === "task.restored" && log.taskId === dueSoonTask.id));
    assert.ok(projectActivity.some((log) => log.action === "task.purged" && log.taskId === dueSoonTask.id));
    assert.ok(projectActivity.some((log) => log.action === "task_list.restored" && log.targetId === anotherList.id));
    assert.ok(projectActivity.some((log) => log.action === "task_list.purged" && log.targetId === anotherList.id));
    assert.ok(projectActivity.some((log) => log.action === "comment.created" && log.taskId === task.id));
    assert.ok(projectActivity.some((log) => log.action === "feishu_delivery.cleared"));

    await request<ActivityLogResponse[]>("GET", `/api/v1/projects/${project.id}/activity`, {
      token: directAddedMember.token
    });
    await request<ActivityLogResponse[]>("GET", `/api/v1/projects/${project.id}/activity`, {
      token: editor.token,
      expectedStatus: 403
    });

    const oldProjectLog = await prisma.activityLog.create({
      data: {
        actorId: owner.id,
        teamId: team.id,
        projectId: project.id,
        taskId: task.id,
        action: "task.updated",
        targetType: "task",
        targetId: task.id,
        metadata: {
          title: "Old Project Log"
        },
        createdAt: new Date("2020-01-03T08:00:00.000Z")
      }
    });
    const clearProjectActivity = (await request<ClearActivityLogsResponse>(
      "POST",
      `/api/v1/projects/${project.id}/activity/clear`,
      {
        token: owner.token,
        body: {
          startDate: "2020-01-03",
          endDate: "2020-01-03"
        }
      }
    )).data;
    assert.equal(clearProjectActivity.deletedCount, 1);
    assert.equal(await prisma.activityLog.count({ where: { id: oldProjectLog.id } }), 0);

    const projectActivityAfterClear = (await request<ActivityLogResponse[]>(
      "GET",
      `/api/v1/projects/${project.id}/activity`,
      {
        token: owner.token
      }
    )).data;
    assert.ok(projectActivityAfterClear.some((log) => log.action === "activity_log.cleared"));

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

    const unarchivedProject = (await request<ProjectResponse>("PATCH", `/api/v1/projects/${project.id}/unarchive`, {
      token: owner.token
    })).data;
    assert.equal(unarchivedProject.status, "ACTIVE");

    await request<TaskResponse>("POST", `/api/v1/projects/${project.id}/tasks`, {
      token: owner.token,
      expectedStatus: 201,
      body: {
        taskListId: task.taskListId,
        title: "Unarchived projects accept writes"
      }
    });

    const activityAfterUnarchive = (await request<ActivityLogResponse[]>(
      "GET",
      `/api/v1/projects/${project.id}/activity`,
      {
        token: owner.token
      }
    )).data;
    assert.ok(activityAfterUnarchive.some((log) => log.action === "project.archived"));
    assert.ok(activityAfterUnarchive.some((log) => log.action === "project.unarchived"));

    const teamActivityAfterProjectLifecycle = (await request<ActivityLogResponse[]>(
      "GET",
      `/api/v1/teams/${team.id}/activity`,
      {
        token: owner.token
      }
    )).data;
    assert.ok(teamActivityAfterProjectLifecycle.some((log) => log.action === "project.archived"));
    assert.ok(teamActivityAfterProjectLifecycle.some((log) => log.action === "project.unarchived"));
  });
});
