import axios from "axios";
import type { AxiosError, InternalAxiosRequestConfig } from "axios";
import { useAuthStore } from "../stores/authStore";
import type {
  ApiResponse,
  ActivityLog,
  AuthResponse,
  Comment,
  Invitation,
  Member,
  MyTask,
  Notification,
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
        return "请输入有效的成员邮箱。若该成员还没有账号，请使用邀请成员流程。";
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
      "Team owner permission is required": "只有团队所有者可以执行这个操作。",
      "Team admin permission is required": "需要团队管理员权限。",
      "You are not a member of this team": "你不是这个团队的成员。",
      "You do not have access to this project": "你没有访问这个项目的权限。",
      "Project edit permission is required": "需要项目编辑权限。",
      "Project owner permission is required": "需要项目所有者权限。",
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
      "All tags must belong to this project": "所有标签都必须属于当前项目。",
      "Tag must belong to this project": "标签不属于当前项目。",
      "Tag name already exists in this project": "当前项目中已经有同名标签。",
      "Parent task must belong to this project": "父任务必须属于当前项目。",
      "Task with subtasks cannot be deleted": "有子任务的任务不能直接删除，请先处理子任务。",
      "Invitation not found": "邀请不存在或已失效。",
      "Only pending invitations can be revoked": "该邀请已被处理，不能再撤销。请刷新邀请记录查看最新状态。",
      "Invitation is no longer pending": "该邀请已被处理，请刷新后查看最新状态。",
      "Invitation has been revoked": "该邀请已被撤销，请联系管理员重新邀请。",
      "Invitation has expired": "邀请已过期，请联系管理员重新邀请。",
      "Invitation email does not match current user": "当前登录邮箱和邀请邮箱不一致，请切换账号后再接受邀请。"
    };

    if (message === "Current password is incorrect") {
      return "当前密码不正确。";
    }

    if (message === "Password login is not enabled for this account") {
      return "当前账号未启用密码登录。";
    }

    if (message === "Team must keep at least one owner") {
      return "团队必须至少保留一名所有者，请先将其他成员设为 OWNER 后再移除当前成员。";
    }

    if (message === "Project must keep at least one owner") {
      return "项目必须至少保留一名所有者，请先将其他项目成员设为 OWNER 后再移除当前成员。";
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
  logout(input: { refreshToken: string }) {
    return unwrap<{ ok: boolean }>(api.post("/auth/logout", input));
  },
  me() {
    return unwrap<User & { feishuBound: boolean }>(api.get("/users/me"));
  }
};

export const userApi = {
  updateProfile(input: { name: string; avatarUrl?: string | null }) {
    return unwrap<User>(api.patch("/users/me/profile", input));
  },
  updatePassword(input: { currentPassword: string; newPassword: string }) {
    return unwrap<{ ok: boolean }>(api.patch("/users/me/password", input));
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

export const teamApi = {
  list() {
    return unwrap<Team[]>(api.get("/teams"));
  },
  create(input: { name: string }) {
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
  addMember(teamId: string, input: { email: string; role: "OWNER" | "ADMIN" | "MEMBER" }) {
    return unwrap<Member>(api.post(`/teams/${teamId}/members`, input));
  },
  updateMemberRole(teamId: string, userId: string, role: "OWNER" | "ADMIN" | "MEMBER") {
    return unwrap<Member>(api.patch(`/teams/${teamId}/members/${userId}/role`, { role }));
  },
  removeMember(teamId: string, userId: string) {
    return unwrap<{ ok: boolean }>(api.delete(`/teams/${teamId}/members/${userId}`));
  },
  invitations(teamId: string) {
    return unwrap<Invitation[]>(api.get(`/teams/${teamId}/invitations`));
  },
  createInvitation(teamId: string, input: { email: string; role: "OWNER" | "ADMIN" | "MEMBER" }) {
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
  create(teamId: string, input: { name: string; description?: string }) {
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
  addMember(projectId: string, input: { userId: string; role: "OWNER" | "EDITOR" | "VIEWER" }) {
    return unwrap<Member>(api.post(`/projects/${projectId}/members`, input));
  },
  updateMemberRole(projectId: string, userId: string, role: "OWNER" | "EDITOR" | "VIEWER") {
    return unwrap<Member>(api.patch(`/projects/${projectId}/members/${userId}/role`, { role }));
  },
  removeMember(projectId: string, userId: string) {
    return unwrap<{ ok: boolean }>(api.delete(`/projects/${projectId}/members/${userId}`));
  },
  invitations(projectId: string) {
    return unwrap<Invitation[]>(api.get(`/projects/${projectId}/invitations`));
  },
  createInvitation(projectId: string, input: {
    email: string;
    teamRole?: "OWNER" | "ADMIN" | "MEMBER";
    projectRole: "OWNER" | "EDITOR" | "VIEWER";
  }) {
    return unwrap<Invitation>(api.post(`/projects/${projectId}/invitations`, input));
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
    assigneeIds?: string[];
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
  updateTask(taskId: string, input: Partial<Pick<Task, "title" | "description" | "status" | "priority" | "startDate" | "dueDate">> & { assigneeIds?: string[] }) {
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
