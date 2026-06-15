import axios from "axios";
import type { AxiosError, InternalAxiosRequestConfig } from "axios";
import { useAuthStore } from "../stores/authStore";
import type {
  ApiResponse,
  ActivityLog,
  AuthResponse,
  CurrentUser,
  Comment,
  EmailChangeResponse,
  EmailOutboxItem,
  EmailVerificationResponse,
  FeishuDelivery,
  Invitation,
  Member,
  MyTask,
  Notification,
  PasswordResetRequestResponse,
  Project,
  ProjectTrash,
  Tag,
  Task,
  TaskDetail,
  TaskList,
  Team,
  TeamProjectTrash,
  User
} from "../types/api";

export const api = axios.create({
  baseURL: "/api/v1"
});

type RetryableRequestConfig = InternalAxiosRequestConfig & {
  _retry?: boolean;
};

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetryableRequestConfig | undefined;
    const refreshToken = useAuthStore.getState().refreshToken;

    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      refreshToken &&
      originalRequest.url !== "/auth/refresh" &&
      originalRequest.url !== "/auth/login"
    ) {
      originalRequest._retry = true;

      try {
        const response = await api.post<ApiResponse<AuthResponse>>("/auth/refresh", {
          refreshToken
        });
        useAuthStore.getState().setSession(response.data.data);
        originalRequest.headers.Authorization = `Bearer ${response.data.data.accessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        useAuthStore.getState().clearSession();
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export function getApiErrorMessage(error: unknown, fallback = "操作失败，请稍后再试") {
  if (axios.isAxiosError(error)) {
    if (!error.response) {
      return "API 服务不可用，请确认后端服务已经启动。";
    }

    const data = error.response.data as
      | {
          error?: {
            code?: string;
            message?: string;
            details?: {
              fieldErrors?: Record<string, string[] | undefined>;
              formErrors?: string[];
            };
          };
        }
      | undefined;
    const message = data?.error?.message;
    const validationFields = data?.error?.details?.fieldErrors;

    if (data?.error?.code === "VALIDATION_ERROR") {
      if (validationFields?.email?.length) {
        return "请输入有效的成员邮箱。";
      }

      if (validationFields?.role?.length || validationFields?.teamRole?.length || validationFields?.projectRole?.length) {
        return "请选择有效的成员角色。";
      }

      if (validationFields?.avatarUrl?.length) {
        return "头像格式不支持或图片过大，请上传 200KB 以内的 PNG、JPG、WebP 或 GIF 图片。";
      }

      return "提交内容格式不正确，请检查后再试。";
    }

    const messageMap: Record<string, string> = {
      "Invalid email or password": "邮箱或密码不正确。",
      "Email is already registered": "这个邮箱已经注册过了。",
      "Please verify or cancel the pending email change before changing email again":
        "请先验证或取消当前待验证邮箱，再修改为其他邮箱。",
      "账号相关请求过于频繁，请稍后再试。": "账号相关请求过于频繁，请稍后再试。",
      "登录尝试过于频繁，请稍后再试。": "登录尝试过于频繁，请稍后再试。",
      "Email delivery is not configured": "邮件服务尚未配置，无法重试发送。",
      "Email outbox item not found": "邮件投递记录不存在。",
      "Email outbox item has already been sent": "这封邮件已经发送成功，不需要重试。",
      "Missing access token": "登录已失效，请重新登录。",
      "Invalid or expired access token": "登录已过期，请重新登录。",
      "Invalid refresh token": "登录已过期，请重新登录。",
      "User with this email does not exist": "没有找到这个邮箱对应的用户。",
      "User not found": "用户不存在或已被删除。",
      "Team member not found": "团队成员不存在。",
      "Project not found": "项目不存在或已被删除。",
      "Project member not found": "项目成员不存在。",
      "Team name already exists": "已经存在同名团队，请换一个名称。",
      "Project name already exists in this team": "当前团队中已经存在同名项目，请换一个名称。",
      "Team owner permission is required": "只有系统管理员可以执行这个操作。",
      "System admin permission is required": "只有系统管理员可以执行这个操作。",
      "System admin email must be verified": "系统管理员邮箱验证后才能执行这个操作。",
      "Team admin permission is required": "需要团队管理员权限。",
      "You are not a member of this team": "你不是这个团队的成员。",
      "You do not have access to this project": "你没有访问这个项目的权限。",
      "Project edit permission is required": "需要项目编辑权限。",
      "Project admin permission is required": "需要项目管理员权限。",
      "Archived project cannot be modified": "项目已归档，不能继续修改。",
      "Task not found": "任务不存在或已被删除。",
      "Comment not found": "评论不存在或已被删除。",
      "Comment delete permission is required": "只能删除自己的评论，或由项目管理员删除。",
      "Mentioned user must be a project member": "只能 @ 当前项目成员。",
      "Task start date cannot be after due date": "任务开始日期不能晚于截止日期。",
      "V0 only supports one level of subtasks": "V0 只支持一层子任务，子任务下不能继续创建子任务。",
      "V0.1 only supports two levels of subtasks": "V0.1 最多支持两级子任务，不能继续拆分。",
      "Default task list cannot be edited": "默认清单不能编辑。",
      "Default task list cannot be deleted": "默认清单不能删除。",
      "Task list name already exists in this project": "当前项目中已经有同名清单。",
      "Task list does not belong to this project": "清单不属于当前项目。",
      "Task list not found in trash": "回收站中没有找到这个清单。",
      "Task not found in trash": "回收站中没有找到这个任务。",
      "Project not found in trash": "项目回收站中没有找到这个项目。",
      "Task list must be restored first": "任务所在清单已删除，请先恢复清单。",
      "Parent task must be restored first": "父任务已删除，请先恢复父任务。",
      "Target task list must be different": "目标清单必须和当前清单不同。",
      "All task lists must belong to this project": "所有清单都必须属于当前项目。",
      "Assignees must be project members": "负责人必须是项目成员。",
      "Project member must belong to the team": "项目成员必须先加入团队。",
      "项目管理员必须是已注册并认领的团队成员。": "项目管理员必须是已注册并认领的团队成员。",
      "All tags must belong to this project": "所有标签都必须属于当前项目。",
      "Tag must belong to this project": "标签不属于当前项目。",
      "Tag name already exists in this project": "当前项目中已经有同名标签。",
      "Parent task must belong to this project": "父任务必须属于当前项目。",
      "Task with subtasks cannot be deleted": "有子任务的任务不能直接删除，请先处理子任务。",
      "Invitation not found": "注册链接不存在或已失效。",
      "Only pending invitations can be revoked": "该注册链接已被处理，不能再停用。",
      "Invitation is no longer pending": "该注册链接已被处理，请刷新后查看最新状态。",
      "Invitation has been revoked": "该注册链接已停用，请联系管理员重新生成。",
      "Invitation has expired": "注册链接已过期，请联系管理员重新生成。",
      "Invitation email does not match current user": "当前登录邮箱和注册链接邮箱不一致，请切换账号后再继续。",
      "Email must be verified before accepting invitation": "请先完成邮箱验证，再接受注册链接。",
      "Feishu login is not configured": "飞书登录尚未配置，请先配置飞书应用信息。",
      "Invalid Feishu login state": "飞书登录状态已失效，请重新发起登录。",
      "Feishu account is already bound to another user": "这个飞书账号已绑定到其他用户。",
      "Feishu notification is not configured": "飞书通知尚未配置，请先配置飞书应用信息。",
      "Feishu delivery not found": "飞书投递记录不存在或已被删除。",
      "Feishu delivery has already been sent": "这条飞书通知已经发送成功，不需要重试。",
      "Account token is invalid or expired": "链接无效或已过期，请重新获取。"
    };

    if (message === "Current password is incorrect") {
      return "当前密码不正确。";
    }

    if (message === "Current password is required") {
      return "请输入当前密码。";
    }

    if (message === "Password login is not enabled for this account") {
      return "当前账号未启用密码登录。";
    }

    if (message === "Please set a login password before unbinding Feishu") {
      return "解除绑定飞书前请先设置登录密码。";
    }

    if (message === "Team must keep at least one owner") {
      return "团队至少需要保留一名管理员。";
    }

    if (message === "团队至少需要保留一名已加入的管理员。") {
      return "团队至少需要保留一名已加入的管理员，请先添加或等待管理员完成注册加入后再操作。";
    }

    if (message === "Project must keep at least one admin") {
      return "项目必须至少保留一名管理员，请先将其他项目成员设为 ADMIN 后再移除当前成员。";
    }

    if (message === "Team with projects cannot be deleted") {
      return "当前团队下还有项目，不能删除团队。请先删除团队下的所有项目后再删除团队。";
    }

    return message ? messageMap[message] ?? message : fallback;
  }

  return fallback;
}

export function getApiErrorMeta(error: unknown) {
  if (!axios.isAxiosError(error) || !error.response) {
    return null;
  }

  const data = error.response.data as
    | { error?: { code?: string }; requestId?: string }
    | undefined;
  const parts = [
    data?.error?.code ? `code: ${data.error.code}` : null,
    data?.requestId ? `requestId: ${data.requestId}` : null
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" / ") : null;
}

export function getApiErrorStatus(error: unknown) {
  return axios.isAxiosError(error) ? error.response?.status ?? null : null;
}

export function getApiErrorCode(error: unknown) {
  if (!axios.isAxiosError(error) || !error.response) {
    return null;
  }

  const data = error.response.data as { error?: { code?: string } } | undefined;
  return data?.error?.code ?? null;
}

async function unwrap<T>(promise: Promise<{ data: ApiResponse<T> }>) {
  const response = await promise;
  return response.data.data;
}

export const authApi = {
  register(input: { email: string; password: string; name: string }) {
    return unwrap<AuthResponse>(api.post("/auth/register", input));
  },
  login(input: { email: string; password: string }) {
    return unwrap<AuthResponse>(api.post("/auth/login", input));
  },
  feishuAuthorizeUrl(input: { redirectTo: string }) {
    return unwrap<{ configured: boolean; authorizeUrl: string | null }>(
      api.get("/auth/feishu/authorize-url", {
        params: input
      })
    );
  },
  feishuCallback(input: { code: string; state: string }) {
    return unwrap<AuthResponse & { redirectTo: string }>(api.post("/auth/feishu/callback", input));
  },
  sendEmailVerification() {
    return unwrap<EmailVerificationResponse>(api.post("/auth/email-verification/send"));
  },
  confirmEmailVerification(input: { token: string }) {
    return unwrap<EmailVerificationResponse>(api.post("/auth/email-verification/confirm", input));
  },
  requestPasswordReset(input: { email: string }) {
    return unwrap<PasswordResetRequestResponse>(api.post("/auth/password-reset/request", input));
  },
  confirmPasswordReset(input: { token: string; newPassword: string }) {
    return unwrap<{ ok: boolean }>(api.post("/auth/password-reset/confirm", input));
  },
  logout(input: { refreshToken: string }) {
    return unwrap<{ ok: boolean }>(api.post("/auth/logout", input));
  },
  me() {
    return unwrap<CurrentUser>(api.get("/users/me"));
  }
};

export const userApi = {
  updateProfile(input: { name: string; avatarUrl?: string | null }) {
    return unwrap<CurrentUser>(api.patch("/users/me/profile", input));
  },
  updateEmail(input: { email: string }) {
    return unwrap<EmailChangeResponse>(api.patch("/users/me/email", input));
  },
  resendEmailChange() {
    return unwrap<EmailChangeResponse>(api.post("/users/me/email-change/resend"));
  },
  cancelEmailChange() {
    return unwrap<{ ok: boolean; user: CurrentUser }>(api.delete("/users/me/email-change"));
  },
  updatePassword(input: { currentPassword?: string; newPassword: string }) {
    return unwrap<{ ok: boolean }>(api.patch("/users/me/password", input));
  },
  bindFeishu(input: { openId: string; unionId?: string | null }) {
    return unwrap<CurrentUser>(api.patch("/users/me/feishu-binding", input));
  },
  unbindFeishu() {
    return unwrap<CurrentUser>(api.delete("/users/me/feishu-binding"));
  },
  myTasks() {
    return unwrap<MyTask[]>(api.get("/users/me/tasks"));
  },
  notifications() {
    return unwrap<Notification[]>(api.get("/users/me/notifications"));
  },
  markNotificationRead(id: string) {
    return unwrap<{ id: string; isRead: boolean; readAt: string | null }>(
      api.patch(`/users/me/notifications/${id}/read`)
    );
  },
  markAllNotificationsRead() {
    return unwrap<{ ok: boolean }>(api.patch("/users/me/notifications/read-all"));
  }
};

export const systemApi = {
  emailOutbox(input: { status?: "ALL" | "PENDING" | "SENT" | "FAILED"; limit?: number }) {
    return unwrap<EmailOutboxItem[]>(
      api.get("/system/email-outbox", {
        params: input
      })
    );
  },
  retryEmailOutboxItem(emailOutboxId: string) {
    return unwrap<EmailOutboxItem>(api.post(`/system/email-outbox/${emailOutboxId}/retry`));
  }
};

export const teamApi = {
  list() {
    return unwrap<Team[]>(api.get("/teams"));
  },
  create(input: { name: string; adminEmail: string }) {
    return unwrap<Team>(api.post("/teams", input));
  },
  update(teamId: string, input: { name: string }) {
    return unwrap<Team>(api.patch(`/teams/${teamId}`, input));
  },
  remove(teamId: string) {
    return unwrap<{ ok: boolean }>(api.delete(`/teams/${teamId}`));
  },
  members(teamId: string) {
    return unwrap<Member[]>(api.get(`/teams/${teamId}/members`));
  },
  addMember(teamId: string, input: { email: string; role: "ADMIN" | "MEMBER" }) {
    return unwrap<Member>(api.post(`/teams/${teamId}/members`, input));
  },
  updateMemberRole(teamId: string, memberId: string, role: "ADMIN" | "MEMBER") {
    return unwrap<Member>(api.patch(`/teams/${teamId}/members/${memberId}/role`, { role }));
  },
  removeMember(teamId: string, memberId: string) {
    return unwrap<{ ok: boolean }>(api.delete(`/teams/${teamId}/members/${memberId}`));
  },
  invitations(teamId: string) {
    return unwrap<Invitation[]>(api.get(`/teams/${teamId}/invitations`));
  },
  createInvitation(teamId: string, input: { email: string; role: "ADMIN" | "MEMBER" }) {
    return unwrap<Invitation>(api.post(`/teams/${teamId}/invitations`, input));
  }
};

export const projectApi = {
  list(teamId: string) {
    return unwrap<Project[]>(api.get(`/teams/${teamId}/projects`));
  },
  trash(teamId: string) {
    return unwrap<TeamProjectTrash>(api.get(`/teams/${teamId}/project-trash`));
  },
  restoreFromTrash(teamId: string, projectId: string) {
    return unwrap<Project>(api.patch(`/teams/${teamId}/project-trash/${projectId}/restore`));
  },
  purgeFromTrash(teamId: string, projectId: string) {
    return unwrap<{ ok: boolean }>(api.delete(`/teams/${teamId}/project-trash/${projectId}`));
  },
  get(projectId: string) {
    return unwrap<Project>(api.get(`/projects/${projectId}`));
  },
  create(teamId: string, input: { name: string; description?: string; projectAdminTeamMemberId?: string }) {
    return unwrap<Project>(api.post(`/teams/${teamId}/projects`, input));
  },
  update(projectId: string, input: Partial<Pick<Project, "name" | "description" | "color" | "icon">>) {
    return unwrap<Project>(api.patch(`/projects/${projectId}`, input));
  },
  archive(projectId: string) {
    return unwrap<Project>(api.patch(`/projects/${projectId}/archive`));
  },
  unarchive(projectId: string) {
    return unwrap<Project>(api.patch(`/projects/${projectId}/unarchive`));
  },
  remove(projectId: string) {
    return unwrap<{ ok: boolean }>(api.delete(`/projects/${projectId}`));
  },
  members(projectId: string) {
    return unwrap<Member[]>(api.get(`/projects/${projectId}/members`));
  },
  addMember(projectId: string, input: { teamMemberId: string; role: "ADMIN" | "EDITOR" | "VIEWER" }) {
    return unwrap<Member>(api.post(`/projects/${projectId}/members`, input));
  },
  updateMemberRole(projectId: string, memberId: string, role: "ADMIN" | "EDITOR" | "VIEWER") {
    return unwrap<Member>(api.patch(`/projects/${projectId}/members/${memberId}/role`, { role }));
  },
  removeMember(projectId: string, memberId: string) {
    return unwrap<{ ok: boolean }>(api.delete(`/projects/${projectId}/members/${memberId}`));
  },
  invitations(projectId: string) {
    return unwrap<Invitation[]>(api.get(`/projects/${projectId}/invitations`));
  },
  createInvitation(projectId: string, input: {
    email: string;
    teamRole?: "ADMIN" | "MEMBER";
    projectRole: "ADMIN" | "EDITOR" | "VIEWER";
  }) {
    return unwrap<Invitation>(api.post(`/projects/${projectId}/invitations`, input));
  },
  feishuDeliveries(projectId: string) {
    return unwrap<FeishuDelivery[]>(api.get(`/projects/${projectId}/feishu-deliveries`));
  },
  clearFeishuDeliveries(
    projectId: string,
    input: { startDate: string; endDate: string; status: "ALL" | "SENT" | "FAILED" | "SKIPPED" }
  ) {
    return unwrap<{ deletedCount: number }>(api.post(`/projects/${projectId}/feishu-deliveries/clear`, input));
  },
  retryFeishuDelivery(projectId: string, deliveryId: string) {
    return unwrap<FeishuDelivery>(api.post(`/projects/${projectId}/feishu-deliveries/${deliveryId}/retry`));
  }
};

export const invitationApi = {
  revoke(invitationId: string) {
    return unwrap<Invitation>(api.patch(`/invitations/${invitationId}/revoke`));
  },
  accept(token: string) {
    return unwrap<{ ok: boolean; teamId: string; projectId: string | null }>(
      api.post("/invitations/accept", { token })
    );
  }
};

export const activityApi = {
  team(teamId: string) {
    return unwrap<ActivityLog[]>(api.get(`/teams/${teamId}/activity`));
  },
  project(projectId: string) {
    return unwrap<ActivityLog[]>(api.get(`/projects/${projectId}/activity`));
  },
  clearTeam(teamId: string, input: { startDate: string; endDate: string }) {
    return unwrap<{ deletedCount: number }>(api.post(`/teams/${teamId}/activity/clear`, input));
  },
  clearProject(projectId: string, input: { startDate: string; endDate: string }) {
    return unwrap<{ deletedCount: number }>(api.post(`/projects/${projectId}/activity/clear`, input));
  }
};

export const boardApi = {
  lists(projectId: string) {
    return unwrap<TaskList[]>(api.get(`/projects/${projectId}/lists`));
  },
  taskListView(projectId: string) {
    return unwrap<TaskList[]>(api.get(`/projects/${projectId}/tasks`));
  },
  createList(projectId: string, input: { name: string }) {
    return unwrap<TaskList>(api.post(`/projects/${projectId}/lists`, input));
  },
  updateList(projectId: string, listId: string, input: { name: string }) {
    return unwrap<TaskList>(api.patch(`/projects/${projectId}/lists/${listId}`, input));
  },
  deleteList(projectId: string, listId: string) {
    return unwrap<{ ok: boolean }>(api.delete(`/projects/${projectId}/lists/${listId}`, { data: {} }));
  },
  trash(projectId: string) {
    return unwrap<ProjectTrash>(api.get(`/projects/${projectId}/trash`));
  },
  restoreList(projectId: string, listId: string) {
    return unwrap<{ ok: boolean }>(api.patch(`/projects/${projectId}/trash/lists/${listId}/restore`));
  },
  purgeList(projectId: string, listId: string) {
    return unwrap<{ ok: boolean }>(api.delete(`/projects/${projectId}/trash/lists/${listId}`));
  },
  reorderLists(projectId: string, items: Array<{ id: string; sortKey: string }>) {
    return unwrap<{ ok: boolean }>(api.patch(`/projects/${projectId}/lists/reorder`, { items }));
  },
  createTask(projectId: string, input: {
    taskListId?: string;
    title: string;
    parentId?: string;
    description?: string;
    projectMemberIds?: string[];
    status?: Task["status"];
    priority?: Task["priority"];
    startDate?: string | null;
    dueDate?: string | null;
  }) {
    return unwrap<Task>(api.post(`/projects/${projectId}/tasks`, input));
  },
  getTask(taskId: string) {
    return unwrap<TaskDetail>(api.get(`/tasks/${taskId}`));
  },
  updateTask(taskId: string, input: Partial<Pick<Task, "title" | "description" | "status" | "priority" | "startDate" | "dueDate">> & { projectMemberIds?: string[] }) {
    return unwrap<Task>(api.patch(`/tasks/${taskId}`, input));
  },
  moveTask(taskId: string, input: { targetTaskListId: string; sortKey: string }) {
    return unwrap<Task>(api.patch(`/tasks/${taskId}/move`, input));
  },
  deleteTask(taskId: string) {
    return unwrap<{ ok: boolean }>(api.delete(`/tasks/${taskId}`));
  },
  restoreTask(taskId: string) {
    return unwrap<{ ok: boolean }>(api.patch(`/tasks/${taskId}/restore`));
  },
  purgeTask(taskId: string) {
    return unwrap<{ ok: boolean }>(api.delete(`/tasks/${taskId}/purge`));
  },
  createComment(taskId: string, input: { content: string; mentionIds?: string[] }) {
    return unwrap<Comment>(api.post(`/tasks/${taskId}/comments`, input));
  },
  deleteComment(taskId: string, commentId: string) {
    return unwrap<{ ok: boolean }>(api.delete(`/tasks/${taskId}/comments/${commentId}`));
  },
  tags(projectId: string) {
    return unwrap<Tag[]>(api.get(`/projects/${projectId}/tags`));
  },
  createTag(projectId: string, input: { name: string; color: string }) {
    return unwrap<Tag>(api.post(`/projects/${projectId}/tags`, input));
  },
  updateTag(projectId: string, tagId: string, input: Partial<Pick<Tag, "name" | "color">>) {
    return unwrap<Tag>(api.patch(`/projects/${projectId}/tags/${tagId}`, input));
  },
  deleteTag(projectId: string, tagId: string) {
    return unwrap<{ ok: boolean }>(api.delete(`/projects/${projectId}/tags/${tagId}`));
  },
  addTag(taskId: string, tagId: string) {
    return unwrap<{ ok: boolean }>(api.post(`/tasks/${taskId}/tags/${tagId}`));
  },
  removeTag(taskId: string, tagId: string) {
    return unwrap<{ ok: boolean }>(api.delete(`/tasks/${taskId}/tags/${tagId}`));
  }
};
