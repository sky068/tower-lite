import {
  expect,
  request,
  test,
  type APIRequestContext,
  type Browser,
  type Dialog,
  type Locator,
  type Page
} from "@playwright/test";
import { AccountTokenType, PrismaClient } from "@prisma/client";
import { config } from "dotenv";

config();

const prisma = new PrismaClient();

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

type EmailVerificationResponse = {
  ok: boolean;
  type: "EMAIL_VERIFY" | "EMAIL_CHANGE";
  email: string;
};

type TeamResponse = {
  id: string;
  name: string;
};

type ProjectResponse = {
  id: string;
  name: string;
  status: "ACTIVE" | "ARCHIVED";
};

type TaskResponse = {
  id: string;
  title: string;
};

type TaskDetailResponse = TaskResponse & {
  subTasks: TaskResponse[];
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
  password: string;
  token: string;
};

const defaultPassword = "Password123!";
const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const emailDomain = `${runId}.e2e.test`;
const apiPort = Number(process.env.PLAYWRIGHT_API_PORT ?? 4000);

let api: APIRequestContext;
let systemAdmin: UserFixture;
let owner: UserFixture;
let editor: UserFixture;
let viewer: UserFixture;
let teamId = "";
let projectId = "";
const cleanupProjectIds = new Set<string>();

function apiPath(path: string) {
  return path.replace(/^\/+/, "");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tokenFromPath(path: string | null | undefined) {
  expect(path).toBeTruthy();
  const url = new URL(path!, "http://tower.test");
  const token = url.searchParams.get("token");
  expect(token).toBeTruthy();
  return token!;
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

  return tokenFromPath(emailItem?.actionPath);
}

async function verifyEmail(email: string) {
  await apiRequest<EmailVerificationResponse>("POST", "/auth/email-verification/confirm", {
    data: {
      token: await latestEmailActionToken(email, AccountTokenType.EMAIL_VERIFY)
    }
  });
}

async function confirmEmailChange(email: string) {
  await apiRequest<EmailVerificationResponse>("POST", "/auth/email-verification/confirm", {
    data: {
      token: await latestEmailActionToken(email, AccountTokenType.EMAIL_CHANGE)
    }
  });
}

async function cleanupProject(projectIdToCleanup: string) {
  if (!owner?.token || !teamId) {
    return;
  }

  await api.fetch(apiPath(`/projects/${projectIdToCleanup}`), {
    method: "DELETE",
    headers: {
      authorization: `Bearer ${owner.token}`
    }
  });

  await api.fetch(apiPath(`/teams/${teamId}/project-trash/${projectIdToCleanup}`), {
    method: "DELETE",
    headers: {
      authorization: `Bearer ${owner.token}`
    }
  });
}

async function registerUser(name: string): Promise<UserFixture> {
  const email = `${name.toLowerCase().replace(/\s+/g, ".")}@${emailDomain}`;
  const response = await apiRequest<AuthResponse>("POST", "/auth/register", {
    expectedStatus: 201,
    data: {
      email,
      name,
      password: defaultPassword
    }
  });
  await verifyEmail(email);

  return {
    id: response.data.user.id,
    email,
    name,
    password: defaultPassword,
    token: response.data.accessToken
  };
}

async function login(page: Page, user: UserFixture) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(user.email);
  await page.getByLabel("密码").fill(user.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
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

async function findSubTaskIdByTitle(parentTaskId: string, title: string) {
  const taskDetail = (await apiRequest<TaskDetailResponse>("GET", `/tasks/${parentTaskId}`, {
    token: owner.token
  })).data;
  const subTask = taskDetail.subTasks.find((item) => item.title === title);
  expect(subTask, `subtask ${title} should exist`).toBeTruthy();
  return subTask!.id;
}

async function logout(page: Page) {
  await page.getByRole("button", { name: "用户菜单" }).click();
  await page.getByRole("button", { name: "退出" }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("tower.accessToken")))
    .toBeNull();
}

function customSelectRoot(trigger: Locator) {
  return trigger.locator(
    "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' custom-select ')][1]"
  );
}

async function selectCustomOption(trigger: Locator, optionName: string | RegExp) {
  await trigger.click();
  await customSelectRoot(trigger).getByRole("option", { name: optionName }).click();
}

async function setMemberSelection(picker: Locator, memberName: string, checked: boolean) {
  const row = picker.locator("label.checkbox-row").filter({ hasText: memberName });
  const checkbox = row.locator('input[type="checkbox"]');
  await expect(row).toBeVisible();

  if ((await checkbox.isChecked()) !== checked) {
    await row.click();
  }

  await expect(checkbox).toBeChecked({ checked });
}

async function openMemberDropdown(scope: Locator) {
  const dropdown = scope.locator(".member-checkbox-dropdown").first();
  await dropdown.locator(".assignee-dropdown-trigger").click();
  return dropdown.locator(".assignee-dropdown-menu");
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
  systemAdmin = await registerUser("E2E System Admin");
  await prisma.user.update({
    where: {
      id: systemAdmin.id
    },
    data: {
      systemRole: "ADMIN"
    }
  });

  const team = await apiRequest<TeamResponse>("POST", "/teams", {
    token: systemAdmin.token,
    expectedStatus: 201,
    data: {
      name: `E2E Team ${runId}`,
      adminEmail: owner.email
    }
  });
  teamId = team.data.id;

  const editorTeamMember = await apiRequest<{ id: string }>("POST", `/teams/${teamId}/members`, {
    token: owner.token,
    expectedStatus: 201,
    data: {
      email: editor.email,
      role: "MEMBER"
    }
  });
  const viewerTeamMember = await apiRequest<{ id: string }>("POST", `/teams/${teamId}/members`, {
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
  cleanupProjectIds.add(projectId);

  await apiRequest("POST", `/projects/${projectId}/members`, {
    token: owner.token,
    expectedStatus: 201,
    data: {
      teamMemberId: editorTeamMember.data.id,
      role: "EDITOR"
    }
  });
  await apiRequest("POST", `/projects/${projectId}/members`, {
    token: owner.token,
    expectedStatus: 201,
    data: {
      teamMemberId: viewerTeamMember.data.id,
      role: "VIEWER"
    }
  });
});

test.afterAll(async () => {
  for (const projectIdToCleanup of Array.from(cleanupProjectIds).reverse()) {
    await cleanupProject(projectIdToCleanup);
  }

  if (teamId) {
    const response = await api.fetch(apiPath(`/teams/${teamId}`), {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${systemAdmin.token}`
      }
    });
    expect(response.status()).toBe(200);
  }

  await api.dispose();
  await prisma.$disconnect();
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
  const taskStartDate = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const taskDueDate = new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10);

  await login(page, owner);
  const purgeProject = (await apiRequest<ProjectResponse>("POST", `/teams/${teamId}/projects`, {
    token: owner.token,
    expectedStatus: 201,
    data: {
      name: `E2E Purge Project ${runId}`
    }
  })).data;
  cleanupProjectIds.add(purgeProject.id);
  await apiRequest("DELETE", `/projects/${purgeProject.id}`, {
    token: owner.token
  });
  const restorableProject = (await apiRequest<ProjectResponse>("POST", `/teams/${teamId}/projects`, {
    token: owner.token,
    expectedStatus: 201,
    data: {
      name: `E2E Restorable Project ${runId}`
    }
  })).data;
  cleanupProjectIds.add(restorableProject.id);
  await apiRequest("DELETE", `/projects/${restorableProject.id}`, {
    token: owner.token
  });
  await page.goto(`/teams/${teamId}`);
  await expect(page.getByRole("heading", { name: `E2E Team ${runId}` })).toBeVisible();
  await expect(page.getByRole("button", { name: "项目回收站" })).toBeVisible();
  await page.getByRole("button", { name: "项目回收站" }).click();
  const teamProjectTrash = page.getByRole("region", { name: "团队项目回收站" });
  await expect(teamProjectTrash).toBeVisible();
  await expect(teamProjectTrash.getByText(restorableProject.name)).toBeVisible();
  await expect(teamProjectTrash.getByText(purgeProject.name)).toBeVisible();
  await expect(
    teamProjectTrash.locator(".trash-row").filter({ hasText: restorableProject.name }).getByText(/删除人：E2E Owner/)
  ).toBeVisible();
  let purgeProjectDialogStep = 0;
  const handlePurgeProjectDialog = async (dialog: Dialog) => {
    if (!dialog.message().includes(purgeProject.name) && !dialog.message().includes("不可恢复操作")) {
      return;
    }
    purgeProjectDialogStep += 1;
    if (purgeProjectDialogStep === 1) {
      expect(dialog.message()).toContain(`确认彻底删除项目「${purgeProject.name}」`);
    } else {
      expect(dialog.message()).toContain("不可恢复操作");
    }
    await dialog.accept();
  };
  page.on("dialog", handlePurgeProjectDialog);
  await teamProjectTrash
    .locator(".trash-row")
    .filter({ hasText: purgeProject.name })
    .getByRole("button", { name: "彻底删除" })
    .click();
  await expect(teamProjectTrash.getByText(purgeProject.name)).toHaveCount(0);
  expect(purgeProjectDialogStep).toBe(2);
  page.off("dialog", handlePurgeProjectDialog);
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain(`确认恢复项目「${restorableProject.name}」`);
    await dialog.accept();
  });
  await teamProjectTrash
    .locator(".trash-row")
    .filter({ hasText: restorableProject.name })
    .getByRole("button", { name: "恢复" })
    .click();
  await expect(teamProjectTrash.getByText(restorableProject.name)).toHaveCount(0);
  await teamProjectTrash.getByRole("button", { name: "关闭" }).click();
  await expect(page.getByRole("link", { name: new RegExp(restorableProject.name) })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(`E2E Project ${escapeRegExp(runId)}`) })).toBeVisible();
  await page.goto(`/projects/${projectId}/board`);
  await expect(page.getByRole("heading", { name: `E2E Project ${runId}` })).toBeVisible();
  const projectMenu = page.getByRole("navigation", { name: "项目菜单" });
  await expect(projectMenu.getByRole("link", { name: "看板" })).toHaveAttribute("aria-current", "page");
  await expect(projectMenu.getByRole("link", { name: "列表" })).toHaveAttribute(
    "href",
    `/projects/${projectId}/list`
  );
  await expect(projectMenu.getByRole("link", { name: "甘特图(任务)" })).toHaveAttribute(
    "href",
    `/projects/${projectId}/gantt`
  );
  await expect(projectMenu.getByRole("link", { name: "甘特图(人员)" })).toHaveAttribute(
    "href",
    `/projects/${projectId}/gantt/people`
  );
  await expect(projectMenu.getByRole("link", { name: "设置" })).toHaveAttribute(
    "href",
    `/projects/${projectId}/settings`
  );
  await expect(projectMenu.getByRole("link", { name: "回收站" })).toHaveAttribute(
    "href",
    `/projects/${projectId}/trash`
  );
  await page.goto("/projects/00000000-0000-0000-0000-000000000000/board");
  await expect(page.getByRole("heading", { name: "内容不存在" })).toBeVisible();
  await page.goto(`/projects/${projectId}/board`);
  await expect(page.getByRole("heading", { name: `E2E Project ${runId}` })).toBeVisible();
  await projectMenu.getByRole("link", { name: "设置" }).click();
  await expect(page.getByRole("heading", { name: "项目设置" })).toBeVisible();
  await page.getByRole("button", { name: `← 返回 E2E Project ${runId}` }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/board$`));
  await expect(page.getByRole("heading", { name: `E2E Project ${runId}` })).toBeVisible();
  await expect(page.getByRole("heading", { name: "默认清单" })).toBeVisible();
  const defaultColumn = boardColumn(page, "默认清单");
  await expect(defaultColumn.getByRole("button", { name: "在默认清单新建任务" })).toBeVisible();
  await expect(defaultColumn.getByRole("button", { name: "默认清单清单菜单" })).toHaveCount(0);

  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  const modal = page.getByLabel("新建任务", { exact: true });
  await expect(modal).toBeVisible();
  await modal.getByLabel("标题").fill(taskTitle);
  await modal.getByLabel("描述").fill("Created by Playwright through the real frontend.");
  await selectCustomOption(modal.getByLabel("优先级"), "高");
  await modal.getByLabel("开始日期").fill(taskStartDate);
  await modal.getByLabel("截止日期").fill(taskDueDate);
  const newTaskAssigneePicker = await openMemberDropdown(modal);
  await setMemberSelection(newTaskAssigneePicker, "E2E Editor", true);
  await setMemberSelection(newTaskAssigneePicker, "E2E Owner", false);
  await modal.getByRole("button", { name: "创建" }).click();

  await expect(modal).toBeHidden();
  await expect(page.getByRole("heading", { name: "默认清单" })).toBeVisible();
  await expect(defaultColumn.getByRole("button", { name: "保存" })).toHaveCount(0);
  await expect(defaultColumn.getByRole("button", { name: "删除" })).toHaveCount(0);
  const taskCard = page.getByRole("button", { name: new RegExp(taskTitle) });
  await expect(taskCard).toBeVisible();

  const taskId = await findTaskIdByTitle(taskTitle);

  await taskCard.click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}$`));
  const detail = page.getByRole("region", { name: "任务详情" });
  await expect(detail).toBeVisible();
  await expect(detail.getByRole("heading", { name: taskTitle })).toBeVisible();
  await detail.getByLabel("描述").fill("Updated by Playwright in task detail.");
  await selectCustomOption(detail.getByLabel("优先级"), "紧急");
  await detail.getByRole("button", { name: "保存" }).click();
  await expect(detail.getByText("已保存")).toBeVisible();
  await expect(detail.getByLabel("优先级")).toContainText("紧急");
  await detail.getByRole("button", { name: "关闭任务详情" }).click();
  await expect(detail).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/board$`));
  await expect(page.getByRole("button", { name: new RegExp("紧急") }).first()).toBeVisible();

  await taskCard.click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}$`));
  await expect(detail).toBeVisible();
  await detail.getByRole("button", { name: "创建子任务" }).click();
  await detail.getByPlaceholder("新增子任务").fill(subTaskTitle);
  await detail.getByRole("button", { name: "选择负责人" }).click();
  await setMemberSelection(detail.locator(".assignee-dropdown-menu"), "E2E Editor", true);
  await detail.getByRole("button", { name: "添加" }).click();
  await expect(detail.getByText(subTaskTitle)).toBeVisible();

  await detail.getByRole("button", { name: new RegExp(subTaskTitle) }).click();
  await expect(detail.getByRole("heading", { name: subTaskTitle })).toBeVisible();
  await detail.getByRole("button", { name: "创建子任务" }).click();
  await detail.getByPlaceholder("新增子任务").fill(secondLevelSubTaskTitle);
  await detail.getByRole("button", { name: "选择负责人" }).click();
  await setMemberSelection(detail.locator(".assignee-dropdown-menu"), "E2E Editor", true);
  await detail.getByRole("button", { name: "添加" }).click();
  await expect(detail.getByText(secondLevelSubTaskTitle)).toBeVisible();
  await detail.getByRole("button", { name: new RegExp(secondLevelSubTaskTitle) }).click();
  await expect(detail.getByRole("heading", { name: secondLevelSubTaskTitle })).toBeVisible();
  await expect(detail.getByRole("button", { name: "已达到最大拆分层级" })).toBeDisabled();

  await detail.getByPlaceholder("写一条评论，输入 @ 提及成员").fill("Owner comment from E2E @");
  await detail.locator(".comment-mention-menu").getByRole("button", { name: /E2E Editor/ }).click();
  await detail.getByRole("button", { name: "发送" }).click();
  await expect(
    detail
      .locator(".comment")
      .filter({ hasText: "Owner comment from E2E @E2E Editor" })
      .getByText("Owner comment from E2E @E2E Editor")
  ).toBeVisible();
  await detail.getByRole("button", { name: "关闭任务详情" }).click();
  await expect(detail).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/board$`));
  const subTaskId = await findSubTaskIdByTitle(taskId, subTaskTitle);
  await apiRequest<TaskResponse>("PATCH", `/tasks/${subTaskId}`, {
    token: owner.token,
    data: {
      startDate: taskStartDate,
      dueDate: taskDueDate
    }
  });
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
  await expect(page.locator(".board-filters .custom-select-trigger").first()).toContainText("全部负责人");
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
  await detail.getByRole("button", { name: "关闭任务详情" }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/list$`));
  await page.getByRole("navigation", { name: "项目菜单" }).getByRole("link", { name: "甘特图(任务)" }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/gantt$`));
  await expect(page.getByRole("navigation", { name: "项目菜单" }).getByRole("link", { name: "甘特图(任务)" })).toHaveAttribute(
    "aria-current",
    "page"
  );
  await expect(page.getByRole("region", { name: "甘特图(任务)" }).getByText(taskTitle).first()).toBeVisible();
  await expect(page.getByRole("region", { name: "甘特图(任务)" }).getByText(subTaskTitle).first()).toBeVisible();
  await expect(page.getByRole("region", { name: "甘特图(任务)" }).getByText("未排期").first()).toBeVisible();
  await expect(page.locator(".gantt-unscheduled").getByText(subTaskTitle)).toHaveCount(0);
  await expect(page.getByRole("button", { name: new RegExp(`${escapeRegExp(subTaskTitle)} 排期`) })).toHaveCount(1);
  await expect(page.getByRole("button", { name: new RegExp(taskTitle) }).first()).toBeVisible();
  await page.getByPlaceholder("搜索任务、负责人或标签").fill(taskTitle);
  await page.getByRole("button", { name: `折叠 ${taskTitle}` }).click();
  await expect(page.getByRole("region", { name: "甘特图(任务)" }).getByText(subTaskTitle)).toHaveCount(0);
  await page.getByPlaceholder("搜索任务、负责人或标签").clear();
  await expect(page.getByRole("region", { name: "甘特图(任务)" }).getByText(subTaskTitle).first()).toBeVisible();
  await page.getByRole("button", { name: `折叠 ${taskTitle}` }).click();
  await expect(page.getByRole("region", { name: "甘特图(任务)" }).getByText(subTaskTitle)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("region", { name: "甘特图(任务)" }).getByText(taskTitle).first()).toBeVisible();
  await expect(page.getByRole("region", { name: "甘特图(任务)" }).getByText(subTaskTitle)).toHaveCount(0);
  await page.getByRole("button", { name: `展开 ${taskTitle}` }).click();
  await expect(page.getByRole("region", { name: "甘特图(任务)" }).getByText(subTaskTitle).first()).toBeVisible();
  const ganttBar = page.getByRole("button", { name: new RegExp(`${escapeRegExp(taskTitle)} 排期`) });
  await expect(ganttBar).toHaveAttribute("data-reschedulable", "true");
  await expect(ganttBar.locator(".gantt-resize-handle.left")).toHaveCount(1);
  await expect(ganttBar.locator(".gantt-resize-handle.right")).toHaveCount(1);
  const ganttZoom = page.getByRole("region", { name: "甘特图缩放" });
  await expect(ganttZoom.getByRole("button", { name: "天" })).toHaveAttribute("aria-pressed", "true");
  await ganttZoom.getByRole("button", { name: "周" }).click();
  await expect(ganttZoom.getByRole("button", { name: "周" })).toHaveAttribute("aria-pressed", "true");
  await ganttZoom.getByRole("button", { name: "月" }).click();
  await expect(ganttZoom.getByRole("button", { name: "月" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("region", { name: "甘特图(任务)" }).getByText(taskTitle).first()).toBeVisible();
  await ganttZoom.getByRole("button", { name: "季度" }).click();
  await expect(ganttZoom.getByRole("button", { name: "季度" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("navigation", { name: "项目菜单" }).getByRole("link", { name: "甘特图(人员)" }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/gantt/people$`));
  await expect(page.getByRole("navigation", { name: "项目菜单" }).getByRole("link", { name: "甘特图(人员)" })).toHaveAttribute(
    "aria-current",
    "page"
  );
  const peopleGantt = page.getByRole("region", { name: "甘特图(人员)" });
  await expect(peopleGantt.getByText("人员 / 任务")).toBeVisible();
  await expect(peopleGantt.getByText("E2E Editor").first()).toBeVisible();
  await expect(peopleGantt.getByText(taskTitle).first()).toBeVisible();
  await expect(peopleGantt.getByText(subTaskTitle).first()).toBeVisible();
  await expect(peopleGantt.getByText("子任务").first()).toBeVisible();
  await expect(peopleGantt.getByRole("button", { name: new RegExp(`${escapeRegExp(taskTitle)} 排期`) })).toHaveCount(1);
  await expect(peopleGantt.getByRole("button", { name: new RegExp(`${escapeRegExp(subTaskTitle)} 排期`) })).toHaveCount(1);
  await expect(peopleGantt.locator(".people-gantt-summary-bar")).toHaveCount(1);
  await expect(peopleGantt.getByText("未排期任务")).toHaveCount(0);
  await peopleGantt.getByRole("button", { name: `折叠 ${taskTitle}` }).click();
  await expect(peopleGantt.getByText(subTaskTitle)).toHaveCount(0);
  await peopleGantt.getByRole("button", { name: `展开 ${taskTitle}` }).click();
  await expect(peopleGantt.getByText(subTaskTitle).first()).toBeVisible();
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
    expect(dialog.message()).toContain("确认将清单和这些任务移入回收站");
    await dialog.accept();
  });
  await deleteColumn.getByRole("button", { name: `${deleteListName}清单菜单` }).click();
  await deleteColumn.getByRole("button", { name: "删除清单" }).click();
  await expect(page.getByRole("heading", { name: deleteListName })).toHaveCount(0);
  await expect(page.getByRole("button", { name: new RegExp(deletedWithListTaskTitle) })).toHaveCount(0);
  await projectMenu.getByRole("link", { name: "回收站" }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/trash$`));
  await expect(page.getByRole("heading", { name: "已删除清单" })).toBeVisible();
  await expect(page.getByText(deleteListName)).toBeVisible();
  await expect(page.getByText(/删除人：E2E Owner/)).toBeVisible();
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain(`确认恢复清单“${deleteListName}”`);
    expect(dialog.message()).toContain("并恢复其中 1 个任务");
    await dialog.accept();
  });
  await page.getByRole("button", { name: "恢复" }).first().click();
  await expect(page.getByText(deleteListName)).toHaveCount(0);
  await page.getByRole("link", { name: "看板" }).click();
  await expect(boardColumn(page, deleteListName).getByRole("button", { name: new RegExp(deletedWithListTaskTitle) })).toBeVisible();

  await customColumn.getByRole("button", { name: new RegExp(taskTitle) }).click();
  await expect(detail).toBeVisible();
  await selectCustomOption(detail.getByLabel("状态"), "已完成");
  await detail.getByRole("button", { name: "保存" }).click();
  await expect(detail.getByText("已保存")).toBeVisible();
  await detail.getByRole("button", { name: "关闭任务详情" }).click();
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
  const myTaskProjectFilter = myTasksPanel.getByLabel("我的任务项目筛选");
  await expect(myTaskProjectFilter).toContainText("全部项目");
  await myTaskProjectFilter.click();
  await expect(customSelectRoot(myTaskProjectFilter).getByRole("option", { name: `E2E Project ${runId}` })).toHaveCount(1);
  await customSelectRoot(myTaskProjectFilter).getByRole("option", { name: `E2E Project ${runId}` }).click();
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
  const editorDetail = editorPage.getByRole("region", { name: "任务详情" });
  await expect(editorDetail).toBeVisible();
  await editorDetail.getByRole("button", { name: "关闭任务详情" }).click();
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
  await expect(
    allNotifications.getByRole("link", { name: new RegExp(`评论中提到了你 .*Owner comment from E2E`) })
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
  await editorPage.getByRole("region", { name: "任务详情" }).getByRole("button", { name: "关闭任务详情" }).click();
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
  const updatedOwnerEmail = `captain-${runId}@e2e.test`;
  await accountSettings.getByLabel("邮箱").fill(updatedOwnerEmail);
  await accountSettings.getByLabel("当前密码").fill(owner.password);
  await accountSettings.getByLabel("新密码", { exact: true }).fill("Password456!");
  await accountSettings.getByLabel("确认新密码").fill("Password456!");
  const profileResponsePromise = page.waitForResponse((response) =>
    response.url().includes("/api/v1/users/me/profile")
  );
  const emailResponsePromise = page.waitForResponse((response) =>
    response.url().includes("/api/v1/users/me/email")
  );
  const passwordResponsePromise = page.waitForResponse((response) =>
    response.url().includes("/api/v1/users/me/password")
  );
  await accountSettings.getByRole("button", { name: "保存设置" }).click();
  const profileResponse = await profileResponsePromise;
  expect(profileResponse.status(), await profileResponse.text()).toBe(200);
  const emailResponse = await emailResponsePromise;
  expect(emailResponse.status(), await emailResponse.text()).toBe(200);
  const passwordResponse = await passwordResponsePromise;
  expect(passwordResponse.status(), await passwordResponse.text()).toBe(200);
  await expect(accountSettings.getByText("设置已保存。")).toBeVisible();
  await confirmEmailChange(updatedOwnerEmail);
  owner.email = updatedOwnerEmail;
  owner.password = "Password456!";
  await expect(accountSettings.getByLabel("Open ID")).toHaveCount(0);
  await expect(accountSettings.getByLabel("Union ID")).toHaveCount(0);
  await accountSettings.getByRole("button", { name: "关闭账号设置" }).click();
  await expect(accountSettings).toBeHidden();

  await apiRequest<ProjectResponse>("PATCH", `/projects/${projectId}/archive`, {
    token: owner.token
  });
  await page.goto(`/tasks/${taskId}`);
  await expect(page.getByText("这个项目已归档，不能修改任务、子任务、标签或评论。")).toBeVisible();
  await expect(page.getByRole("button", { name: "创建子任务" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "删除任务" })).toBeDisabled();
  await page.getByRole("region", { name: "任务详情" }).getByRole("button", { name: "关闭任务详情" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await logout(page);
  await login(page, viewer);
  await page.goto(`/projects/${projectId}/board`);
  await expect(page.getByText("这个项目已归档，当前看板为只读状态。")).toBeVisible();
  await expect(page.getByRole("button", { name: "新建任务", exact: true })).toHaveCount(0);
  await logout(page);
  await login(page, owner);
  await page.goto(`/projects/${projectId}/settings`);
  await expect(page.getByRole("heading", { name: "项目设置" })).toBeVisible();
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("确认取消归档这个项目");
    await dialog.accept();
  });
  await page.getByRole("button", { name: "取消归档" }).click();
  await expect(page.getByRole("button", { name: "归档项目" })).toBeVisible();
  await page.goto(`/projects/${projectId}/board`);
  await expect(page.getByText("这个项目已归档，当前看板为只读状态。")).toHaveCount(0);
});
