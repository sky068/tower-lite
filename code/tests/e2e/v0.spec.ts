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
  isDefault: boolean;
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
const apiPort = Number(process.env.PLAYWRIGHT_API_PORT ?? 4000);

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
  await page.getByRole("button", { name: "用户菜单" }).click();
  await page.getByRole("button", { name: "退出" }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("tower.accessToken")))
    .toBeNull();
}

test.beforeAll(async () => {
  api = await request.newContext({
    baseURL: `http://127.0.0.1:${apiPort}/api/v1/`,
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
  const secondLevelSubTaskTitle = `E2E Nested Subtask ${runId}`;
  const customListName = `E2E Custom List ${runId}`;
  const deleteListName = `E2E Delete List ${runId}`;
  const deletedWithListTaskTitle = `E2E Deleted With List ${runId}`;

  await login(page, owner);
  await expect(page.getByText(`E2E Project ${runId}`)).toBeVisible();
  await page.goto(`/projects/${projectId}/board`);
  await expect(page.getByRole("heading", { name: `E2E Project ${runId}` })).toBeVisible();
  const projectMenu = page.getByRole("navigation", { name: "项目菜单" });
  await expect(projectMenu.getByRole("link", { name: "看板" })).toHaveAttribute("aria-current", "page");
  await expect(projectMenu.getByRole("link", { name: "列表" })).toHaveAttribute(
    "href",
    `/projects/${projectId}/list`
  );
  await expect(projectMenu.getByRole("link", { name: "设置" })).toHaveAttribute(
    "href",
    `/projects/${projectId}/settings`
  );
  await expect(projectMenu.getByRole("button", { name: "回收站" })).toBeDisabled();
  await projectMenu.getByRole("link", { name: "设置" }).click();
  await expect(page.getByRole("heading", { name: "项目设置" })).toBeVisible();
  await page.getByRole("button", { name: `← 返回 E2E Project ${runId}` }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/board$`));
  await expect(page.getByRole("heading", { name: `E2E Project ${runId}` })).toBeVisible();
  await expect(page.getByRole("heading", { name: "暂无清单" })).toBeVisible();

  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  const modal = page.getByLabel("新建任务", { exact: true });
  await expect(modal).toBeVisible();
  await modal.getByLabel("标题").fill(taskTitle);
  await modal.getByLabel("描述").fill("Created by Playwright through the real frontend.");
  await modal.getByLabel("优先级").selectOption("HIGH");
  await modal.getByLabel("E2E Editor").check();
  await modal.getByLabel("E2E Owner").uncheck();
  await modal.getByRole("button", { name: "创建" }).click();

  await expect(modal).toBeHidden();
  await expect(page.getByRole("heading", { name: "默认清单" })).toBeVisible();
  const defaultColumn = boardColumn(page, "默认清单");
  await expect(defaultColumn.getByRole("button", { name: "在默认清单新建任务" })).toBeVisible();
  await expect(defaultColumn.getByRole("button", { name: "默认清单清单菜单" })).toHaveCount(0);
  await expect(defaultColumn.getByRole("button", { name: "保存" })).toHaveCount(0);
  await expect(defaultColumn.getByRole("button", { name: "删除" })).toHaveCount(0);
  const taskCard = page.getByRole("button", { name: new RegExp(taskTitle) });
  await expect(taskCard).toBeVisible();

  const taskId = await findTaskIdByTitle(taskTitle);

  await taskCard.click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}$`));
  const detail = page.getByLabel("任务详情");
  await expect(detail).toBeVisible();
  await expect(detail.getByRole("heading", { name: taskTitle })).toBeVisible();
  await detail.getByLabel("描述").fill("Updated by Playwright in task detail.");
  await detail.getByLabel("优先级").selectOption("URGENT");
  await detail.getByRole("button", { name: "保存" }).click();
  await expect(detail.getByText("已保存")).toBeVisible();
  await expect(detail.getByLabel("优先级")).toHaveValue("URGENT");
  await detail.getByRole("button", { name: "关闭" }).click();
  await expect(detail).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/board$`));
  await expect(page.getByRole("button", { name: new RegExp("紧急") }).first()).toBeVisible();

  await taskCard.click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}$`));
  await expect(detail).toBeVisible();
  await detail.getByRole("button", { name: "创建子任务" }).click();
  await detail.getByPlaceholder("新增子任务").fill(subTaskTitle);
  await detail.getByRole("button", { name: "选择负责人" }).click();
  await detail.locator(".assignee-dropdown-menu").getByLabel("E2E Editor").check();
  await detail.getByRole("button", { name: "添加" }).click();
  await expect(detail.getByText(subTaskTitle)).toBeVisible();

  await detail.getByRole("button", { name: new RegExp(subTaskTitle) }).click();
  await expect(detail.getByRole("heading", { name: subTaskTitle })).toBeVisible();
  await detail.getByRole("button", { name: "创建子任务" }).click();
  await detail.getByPlaceholder("新增子任务").fill(secondLevelSubTaskTitle);
  await detail.getByRole("button", { name: "选择负责人" }).click();
  await detail.locator(".assignee-dropdown-menu").getByLabel("E2E Editor").check();
  await detail.getByRole("button", { name: "添加" }).click();
  await expect(detail.getByText(secondLevelSubTaskTitle)).toBeVisible();
  await detail.getByRole("button", { name: new RegExp(secondLevelSubTaskTitle) }).click();
  await expect(detail.getByRole("heading", { name: secondLevelSubTaskTitle })).toBeVisible();
  await expect(detail.getByRole("button", { name: "已达到最大拆分层级" })).toBeDisabled();

  await detail.getByPlaceholder("写一条评论").fill("Owner comment from E2E");
  await detail.getByRole("button", { name: "发送" }).click();
  await expect(detail.getByText("Owner comment from E2E")).toBeVisible();
  await detail.getByRole("button", { name: "关闭" }).click();
  await expect(detail).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/board$`));
  await page.getByPlaceholder("搜索任务、负责人或标签").fill(secondLevelSubTaskTitle);
  await expect(page.getByRole("button", { name: new RegExp(taskTitle) })).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(secondLevelSubTaskTitle) })).toHaveCount(0);
  await page.getByPlaceholder("搜索任务、负责人或标签").clear();

  await projectMenu.getByRole("link", { name: "列表" }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/list$`));
  await expect(page.getByRole("navigation", { name: "项目菜单" }).getByRole("link", { name: "列表" })).toHaveAttribute(
    "aria-current",
    "page"
  );
  const taskListHead = page.locator(".project-task-list-head");
  await expect(taskListHead.getByText("任务标题", { exact: true })).toBeVisible();
  await expect(taskListHead.getByText("优先级", { exact: true })).toBeVisible();
  await expect(taskListHead.getByText("截止时间", { exact: true })).toBeVisible();
  await expect(taskListHead.getByText("负责人", { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("搜索任务、负责人或标签")).toBeVisible();
  await expect(page.locator(".board-filters select").first()).toHaveValue("ALL");
  await page.getByRole("navigation", { name: "项目菜单" }).getByRole("link", { name: "设置" }).click();
  await expect(page.getByRole("heading", { name: "项目设置" })).toBeVisible();
  await page.getByRole("button", { name: `← 返回 E2E Project ${runId}` }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/list$`));
  const defaultListGroup = page.locator(".project-task-list-group").filter({ hasText: "默认清单" });
  const defaultListTaskTitles = defaultListGroup.locator(".project-task-title-button");
  await expect(defaultListTaskTitles.filter({ hasText: taskTitle })).toBeVisible();
  await expect(defaultListTaskTitles.filter({ hasText: subTaskTitle })).toBeVisible();
  await expect(defaultListTaskTitles.filter({ hasText: secondLevelSubTaskTitle })).toBeVisible();
  await defaultListGroup.getByRole("button", { name: /默认清单/ }).first().click();
  await expect(defaultListTaskTitles.filter({ hasText: taskTitle })).toHaveCount(0);
  await defaultListGroup.getByRole("button", { name: /默认清单/ }).first().click();
  await defaultListTaskTitles.filter({ hasText: taskTitle }).click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}$`));
  await expect(detail).toBeVisible();
  await detail.getByRole("button", { name: "关闭" }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/list$`));
  await page.getByRole("navigation", { name: "项目菜单" }).getByRole("link", { name: "看板" }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/board$`));

  await apiRequest<TaskListResponse>("POST", `/projects/${projectId}/lists`, {
    token: owner.token,
    expectedStatus: 201,
    data: {
      name: customListName
    }
  });
  await page.reload();
  const customColumn = boardColumn(page, customListName);
  await expect(customColumn).toBeVisible();
  await expect(customColumn.getByRole("button", { name: `在${customListName}新建任务` })).toBeVisible();
  await expect(customColumn.getByRole("button", { name: "保存" })).toHaveCount(0);
  await expect(customColumn.getByRole("button", { name: "删除清单" })).toHaveCount(0);
  await customColumn.getByRole("button", { name: `${customListName}清单菜单` }).click();
  await expect(customColumn.getByRole("button", { name: "编辑清单" })).toBeVisible();
  await expect(customColumn.getByRole("button", { name: "删除清单" })).toBeVisible();
  await customColumn.getByRole("button", { name: "编辑清单" }).click();
  await expect(page.locator(".column-title-form input")).toHaveValue(customListName);
  await expect(page.getByRole("button", { name: "保存" })).toBeVisible();
  await expect(page.getByTitle("拖拽排序")).toBeVisible();
  await page.getByRole("button", { name: "取消" }).click();
  await expect(customColumn.getByRole("button", { name: "保存" })).toHaveCount(0);
  await page.getByRole("button", { name: new RegExp(taskTitle) }).dragTo(customColumn);
  await expect(customColumn.getByRole("button", { name: new RegExp(taskTitle) })).toBeVisible();

  const deleteList = (await apiRequest<TaskListResponse>("POST", `/projects/${projectId}/lists`, {
    token: owner.token,
    expectedStatus: 201,
    data: {
      name: deleteListName
    }
  })).data;
  await apiRequest<TaskResponse>("POST", `/projects/${projectId}/tasks`, {
    token: owner.token,
    expectedStatus: 201,
    data: {
      taskListId: deleteList.id,
      title: deletedWithListTaskTitle
    }
  });
  await page.reload();
  const deleteColumn = boardColumn(page, deleteListName);
  await expect(deleteColumn.getByRole("button", { name: new RegExp(deletedWithListTaskTitle) })).toBeVisible();
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("确认删除清单并删除这些任务");
    await dialog.accept();
  });
  await deleteColumn.getByRole("button", { name: `${deleteListName}清单菜单` }).click();
  await deleteColumn.getByRole("button", { name: "删除清单" }).click();
  await expect(page.getByRole("heading", { name: deleteListName })).toHaveCount(0);
  await expect(page.getByRole("button", { name: new RegExp(deletedWithListTaskTitle) })).toHaveCount(0);

  await customColumn.getByRole("button", { name: new RegExp(taskTitle) }).click();
  await expect(detail).toBeVisible();
  await detail.getByLabel("状态").selectOption("DONE");
  await detail.getByRole("button", { name: "保存" }).click();
  await expect(detail.getByText("已保存")).toBeVisible();
  await detail.getByRole("button", { name: "关闭" }).click();
  await expect(detail).toBeHidden();
  await expect(
    customColumn.getByRole("button", { name: new RegExp(`${escapeRegExp(owner.name)}.*今天完成`) })
  ).toBeVisible();

  const editorContext = await browser.newContext();
  const editorPage = await editorContext.newPage();

  await login(editorPage, editor);
  const myTasksPanel = editorPage.locator("section.panel").filter({
    has: editorPage.getByRole("heading", { name: "我的任务" })
  }).first();
  const assignedFirstLevelLinks = myTasksPanel.getByRole("link", {
    name: new RegExp(`^${escapeRegExp(subTaskTitle)}\\b`)
  });
  await expect(assignedFirstLevelLinks).toHaveCount(1);
  await expect(assignedFirstLevelLinks.first()).toBeVisible();
  await expect(
    myTasksPanel.getByRole("link", { name: new RegExp(`^${escapeRegExp(secondLevelSubTaskTitle)}\\b`) })
  ).toHaveCount(1);
  await myTasksPanel.getByRole("tab", { name: "已完成" }).click();
  await expect(
    myTasksPanel.getByRole("link", { name: new RegExp(`^${escapeRegExp(taskTitle)}\\b`) }).first()
  ).toBeVisible();
  await expect(
    myTasksPanel.getByRole("link", { name: new RegExp(`^${escapeRegExp(subTaskTitle)}\\b`) }).first()
  ).toBeVisible();
  await myTasksPanel.getByRole("tab", { name: "全部" }).click();
  const myTaskLink = myTasksPanel
    .getByRole("link", { name: new RegExp(`^${escapeRegExp(taskTitle)}\\b`) })
    .first();
  await expect(myTaskLink).toBeVisible();
  await myTaskLink.click();
  await expect(editorPage).toHaveURL(new RegExp(`/tasks/${taskId}$`));
  await expect(editorPage.getByLabel("任务详情")).toBeVisible();
  await editorPage.getByRole("button", { name: "关闭" }).click();
  await expect(editorPage).toHaveURL(/\/dashboard$/);
  await expect(editorPage.getByRole("heading", { name: "工作台" })).toBeVisible();
  await editorPage.getByRole("button", { name: "通知" }).click();
  await editorPage.getByRole("button", { name: "查看全部" }).click();
  const allNotifications = editorPage.getByRole("region", { name: "全部通知" });
  await expect(allNotifications).toBeVisible();
  await expect(
    allNotifications.getByRole("link", { name: new RegExp(`你被分配了一个任务 ${escapeRegExp(taskTitle)}`) })
  ).toBeVisible();
  await expect(
    allNotifications.getByRole("link", { name: new RegExp(`你被分配了一个任务 ${escapeRegExp(subTaskTitle)}`) })
  ).toBeVisible();
  const assignedTaskNotification = allNotifications
    .locator(".notification-center-row")
    .filter({ hasText: "你被分配了一个任务" })
    .filter({ hasText: taskTitle })
    .first();
  await assignedTaskNotification.getByRole("button", { name: "已读" }).click();
  await expect(assignedTaskNotification).not.toHaveClass(/unread/);

  await apiRequest("POST", `/tasks/${taskId}/comments`, {
    token: owner.token,
    expectedStatus: 201,
    data: {
      content: "Realtime comment notification from owner"
    }
  });
  await expect(allNotifications.getByText("Realtime comment notification from owner")).toBeVisible();
  await allNotifications.getByRole("button", { name: "关闭全部通知" }).click();
  await expect(allNotifications).toBeHidden();

  await editorPage.goto(`/tasks/${taskId}`);
  await expect(editorPage.getByRole("link", { name: "返回工作台" })).toBeVisible();
  await editorPage.getByRole("button", { name: "关闭" }).click();
  await expect(editorPage).toHaveURL(/\/dashboard$/);

  await editorPage.goto(`/projects/${projectId}/board`);
  await expect(editorPage.getByRole("button", { name: "新建任务", exact: true })).toBeVisible();
  await expect(editorPage.getByRole("button", { name: "添加清单" })).toHaveCount(0);
  const editorCustomColumn = boardColumn(editorPage, customListName);
  await expect(editorCustomColumn).toBeVisible();
  await expect(editorCustomColumn.getByRole("button", { name: `在${customListName}新建任务` })).toBeVisible();
  await expect(editorCustomColumn.getByRole("button", { name: `${customListName}清单菜单` })).toHaveCount(0);
  await expect(editorCustomColumn.getByRole("button", { name: "保存" })).toHaveCount(0);
  await expect(editorCustomColumn.getByRole("button", { name: "删除" })).toHaveCount(0);
  await editorContext.close();

  await page.getByRole("button", { name: "用户菜单" }).click();
  await expect(page.getByText(owner.email)).toBeVisible();
  await page.getByRole("button", { name: "设置" }).click();
  const accountSettings = page.getByRole("region", { name: "账号设置" });
  await expect(accountSettings).toBeVisible();
  await accountSettings.getByLabel("名字").fill("E2E Captain");
  await accountSettings.getByLabel("上传头像").setInputFiles({
    name: "avatar.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
      "base64"
    )
  });
  const profileResponsePromise = page.waitForResponse((response) =>
    response.url().includes("/api/v1/users/me/profile")
  );
  await accountSettings.getByRole("button", { name: "保存资料" }).click();
  const profileResponse = await profileResponsePromise;
  expect(profileResponse.status(), await profileResponse.text()).toBe(200);
  await expect(accountSettings.getByText("资料已保存。")).toBeVisible();
  await accountSettings.getByLabel("当前密码").fill(password);
  await accountSettings.getByLabel("新密码", { exact: true }).fill("Password456!");
  await accountSettings.getByLabel("确认新密码").fill("Password456!");
  await accountSettings.getByRole("button", { name: "更新密码" }).click();
  await expect(accountSettings.getByText("密码已更新。")).toBeVisible();
  await accountSettings.getByRole("button", { name: "关闭账号设置" }).click();
  await expect(accountSettings).toBeHidden();

  await apiRequest<ProjectResponse>("PATCH", `/projects/${projectId}/archive`, {
    token: owner.token
  });

  await logout(page);
  await login(page, viewer);
  await page.goto(`/projects/${projectId}/board`);
  await expect(page.getByText("这个项目已归档，当前看板为只读状态。")).toBeVisible();
  await expect(page.getByRole("button", { name: "新建任务", exact: true })).toHaveCount(0);
});
