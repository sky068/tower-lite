import { expect, request, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";

type ApiEnvelope<T> = {
  data: T;
  requestId: string;
};

type AuthResponse = {
  accessToken: string;
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
};

type TaskResponse = {
  id: string;
  title: string;
};

type TaskListResponse = {
  id: string;
  name: string;
  type: "TODO" | "IN_PROGRESS" | "DONE" | "CUSTOM";
  tasks: TaskResponse[];
};

type UserFixture = {
  id: string;
  email: string;
  name: string;
  token: string;
};

const password = "Password123!";
const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const emailDomain = `${runId}.e2e.test`;

let api: APIRequestContext;
let owner: UserFixture;
let editor: UserFixture;
let viewer: UserFixture;
let teamId = "";
let projectId = "";

function apiPath(path: string) {
  return path.replace(/^\/+/, "");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function apiRequest<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  input: {
    token?: string;
    data?: unknown;
    expectedStatus?: number;
  } = {}
) {
  const response = await api.fetch(apiPath(path), {
    method,
    headers: input.token ? { authorization: `Bearer ${input.token}` } : undefined,
    data: input.data
  });

  expect(response.status()).toBe(input.expectedStatus ?? 200);

  return (await response.json()) as ApiEnvelope<T>;
}

async function registerUser(name: string): Promise<UserFixture> {
  const email = `${name.toLowerCase().replace(/\s+/g, ".")}@${emailDomain}`;
  const response = await apiRequest<AuthResponse>("POST", "/auth/register", {
    expectedStatus: 201,
    data: {
      email,
      name,
      password
    }
  });

  return {
    id: response.data.user.id,
    email,
    name,
    token: response.data.accessToken
  };
}

async function login(page: Page, user: UserFixture) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(user.email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
}

function boardColumn(page: Page, name: string) {
  return page.locator(".board-column").filter({
    has: page.getByRole("heading", { name })
  });
}

async function findTaskIdByTitle(title: string) {
  const lists = (await apiRequest<TaskListResponse[]>("GET", `/projects/${projectId}/lists`, {
    token: owner.token
  })).data;
  const task = lists.flatMap((list) => list.tasks).find((item) => item.title === title);
  expect(task, `task ${title} should exist`).toBeTruthy();
  return task!.id;
}

async function logout(page: Page) {
  await page.getByRole("button", { name: "退出" }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("tower.accessToken")))
    .toBeNull();
}

test.beforeAll(async () => {
  api = await request.newContext({
    baseURL: "http://127.0.0.1:4000/api/v1/",
    extraHTTPHeaders: {
      "content-type": "application/json"
    }
  });

  owner = await registerUser("E2E Owner");
  editor = await registerUser("E2E Editor");
  viewer = await registerUser("E2E Viewer");

  const team = await apiRequest<TeamResponse>("POST", "/teams", {
    token: owner.token,
    expectedStatus: 201,
    data: {
      name: `E2E Team ${runId}`
    }
  });
  teamId = team.data.id;

  await apiRequest("POST", `/teams/${teamId}/members`, {
    token: owner.token,
    expectedStatus: 201,
    data: {
      email: editor.email,
      role: "MEMBER"
    }
  });
  await apiRequest("POST", `/teams/${teamId}/members`, {
    token: owner.token,
    expectedStatus: 201,
    data: {
      email: viewer.email,
      role: "MEMBER"
    }
  });

  const project = await apiRequest<ProjectResponse>("POST", `/teams/${teamId}/projects`, {
    token: owner.token,
    expectedStatus: 201,
    data: {
      name: `E2E Project ${runId}`
    }
  });
  projectId = project.data.id;

  await apiRequest("POST", `/projects/${projectId}/members`, {
    token: owner.token,
    expectedStatus: 201,
    data: {
      userId: editor.id,
      role: "EDITOR"
    }
  });
  await apiRequest("POST", `/projects/${projectId}/members`, {
    token: owner.token,
    expectedStatus: 201,
    data: {
      userId: viewer.id,
      role: "VIEWER"
    }
  });
});

test.afterAll(async () => {
  if (projectId) {
    await api.fetch(apiPath(`/projects/${projectId}`), {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${owner.token}`
      }
    });
  }

  if (teamId) {
    await api.fetch(apiPath(`/teams/${teamId}`), {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${owner.token}`
      }
    });
  }

  await api.dispose();
});

test("V0 browser workflow covers project board, task detail, subtasks, drag, permissions, and realtime notifications", async ({
  browser,
  page
}: {
  browser: Browser;
  page: Page;
}) => {
  const taskTitle = `E2E Task ${runId}`;
  const subTaskTitle = `E2E Subtask ${runId}`;

  await login(page, owner);
  await expect(page.getByText(`E2E Project ${runId}`)).toBeVisible();
  await page.goto(`/projects/${projectId}/board`);
  await expect(page.getByRole("heading", { name: "项目看板" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "待处理" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "进行中" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "已完成" })).toBeVisible();

  await page.getByRole("button", { name: "新建任务" }).click();
  const modal = page.getByLabel("新建任务");
  await expect(modal).toBeVisible();
  await modal.getByLabel("标题").fill(taskTitle);
  await modal.getByLabel("描述").fill("Created by Playwright through the real frontend.");
  await modal.getByLabel("优先级").selectOption("HIGH");
  await modal.getByLabel("E2E Editor").check();
  await modal.getByLabel("E2E Owner").uncheck();
  await modal.getByRole("button", { name: "创建" }).click();

  await expect(modal).toBeHidden();
  const taskCard = page.getByRole("button", { name: new RegExp(taskTitle) });
  await expect(taskCard).toBeVisible();

  const taskId = await findTaskIdByTitle(taskTitle);

  await taskCard.click();
  const detail = page.getByLabel("任务详情");
  await expect(detail).toBeVisible();
  await expect(detail.getByRole("heading", { name: taskTitle })).toBeVisible();
  await detail.getByRole("button", { name: "创建子任务" }).click();
  await detail.getByPlaceholder("新增子任务").fill(subTaskTitle);
  await detail.getByRole("button", { name: "选择负责人" }).click();
  await detail.locator(".assignee-dropdown-menu").getByLabel("E2E Editor").check();
  await detail.getByRole("button", { name: "添加" }).click();
  await expect(detail.getByText(subTaskTitle)).toBeVisible();

  await detail.getByPlaceholder("写一条评论").fill("Owner comment from E2E");
  await detail.getByRole("button", { name: "发送" }).click();
  await expect(detail.getByText("Owner comment from E2E")).toBeVisible();
  await detail.getByRole("button", { name: "关闭" }).click();
  await expect(detail).toBeHidden();

  const doneColumn = boardColumn(page, "已完成");
  await page.getByRole("button", { name: new RegExp(taskTitle) }).dragTo(doneColumn);
  await expect(doneColumn.getByRole("button", { name: new RegExp(taskTitle) })).toBeVisible();

  const editorContext = await browser.newContext();
  const editorPage = await editorContext.newPage();

  await login(editorPage, editor);
  const myTasksPanel = editorPage.locator("section").filter({
    has: editorPage.getByRole("heading", { name: "我的任务" })
  });
  await expect(
    myTasksPanel.getByRole("link", { name: new RegExp(`^${escapeRegExp(subTaskTitle)}\\b`) })
  ).toBeVisible();
  await myTasksPanel.locator("select").selectOption("ALL");
  const myTaskLink = myTasksPanel.getByRole("link", { name: new RegExp(`^${escapeRegExp(taskTitle)}\\b`) });
  await expect(myTaskLink).toBeVisible();
  await myTaskLink.click();
  await expect(editorPage.getByLabel("任务详情")).toBeVisible();
  await editorPage.getByRole("button", { name: "关闭" }).click();
  await expect(editorPage.getByRole("heading", { name: "工作台" })).toBeVisible();
  await expect(editorPage.getByRole("link", { name: new RegExp(`你被分配了一个任务 ${escapeRegExp(taskTitle)}`) })).toBeVisible();
  await expect(editorPage.getByRole("link", { name: new RegExp(`你被分配了一个任务 ${escapeRegExp(subTaskTitle)}`) })).toBeVisible();

  await apiRequest("POST", `/tasks/${taskId}/comments`, {
    token: owner.token,
    expectedStatus: 201,
    data: {
      content: "Realtime comment notification from owner"
    }
  });
  await expect(editorPage.getByText("Realtime comment notification from owner")).toBeVisible();

  await editorPage.goto(`/projects/${projectId}/board`);
  await expect(editorPage.getByRole("button", { name: "新建任务" })).toBeVisible();
  await expect(editorPage.getByRole("button", { name: "添加列表" })).toHaveCount(0);
  await editorContext.close();

  await logout(page);
  await login(page, viewer);
  await page.goto(`/projects/${projectId}/board`);
  await expect(page.getByText("你当前是只读成员，可以查看任务但不能修改看板。")).toBeVisible();
  await expect(page.getByRole("button", { name: "新建任务" })).toHaveCount(0);
});
