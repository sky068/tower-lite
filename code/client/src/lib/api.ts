import axios from "axios";
import type { AxiosError, InternalAxiosRequestConfig } from "axios";
import { useAuthStore } from "../stores/authStore";
import type {
  ApiResponse,
  AuthResponse,
  Comment,
  Member,
  MyTask,
  Notification,
  Project,
  Tag,
  Task,
  TaskDetail,
  TaskList,
  Team,
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
    const data = error.response?.data as { error?: { message?: string } } | undefined;
    return data?.error?.message ?? fallback;
  }

  return fallback;
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
  me() {
    return unwrap<User & { feishuBound: boolean }>(api.get("/users/me"));
  }
};

export const userApi = {
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
  }
};

export const projectApi = {
  list(teamId: string) {
    return unwrap<Project[]>(api.get(`/teams/${teamId}/projects`));
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
  }
};

export const boardApi = {
  lists(projectId: string) {
    return unwrap<TaskList[]>(api.get(`/projects/${projectId}/lists`));
  },
  createList(projectId: string, input: { name: string }) {
    return unwrap<TaskList>(api.post(`/projects/${projectId}/lists`, input));
  },
  updateList(projectId: string, listId: string, input: { name: string }) {
    return unwrap<TaskList>(api.patch(`/projects/${projectId}/lists/${listId}`, input));
  },
  deleteList(projectId: string, listId: string, input: { targetTaskListId?: string }) {
    return unwrap<{ ok: boolean }>(api.delete(`/projects/${projectId}/lists/${listId}`, { data: input }));
  },
  reorderLists(projectId: string, items: Array<{ id: string; sortKey: string }>) {
    return unwrap<{ ok: boolean }>(api.patch(`/projects/${projectId}/lists/reorder`, { items }));
  },
  createTask(projectId: string, input: {
    taskListId: string;
    title: string;
    parentId?: string;
    description?: string;
    assigneeId?: string;
  }) {
    return unwrap<Task>(api.post(`/projects/${projectId}/tasks`, input));
  },
  getTask(taskId: string) {
    return unwrap<TaskDetail>(api.get(`/tasks/${taskId}`));
  },
  updateTask(taskId: string, input: Partial<Pick<Task, "title" | "description" | "priority" | "assigneeId" | "startDate" | "dueDate">>) {
    return unwrap<Task>(api.patch(`/tasks/${taskId}`, input));
  },
  moveTask(taskId: string, input: { targetTaskListId: string; sortKey: string }) {
    return unwrap<Task>(api.patch(`/tasks/${taskId}/move`, input));
  },
  deleteTask(taskId: string) {
    return unwrap<{ ok: boolean }>(api.delete(`/tasks/${taskId}`));
  },
  createComment(taskId: string, input: { content: string }) {
    return unwrap<Comment>(api.post(`/tasks/${taskId}/comments`, input));
  },
  tags(projectId: string) {
    return unwrap<Tag[]>(api.get(`/projects/${projectId}/tags`));
  },
  createTag(projectId: string, input: { name: string; color: string }) {
    return unwrap<Tag>(api.post(`/projects/${projectId}/tags`, input));
  },
  addTag(taskId: string, tagId: string) {
    return unwrap<{ ok: boolean }>(api.post(`/tasks/${taskId}/tags/${tagId}`));
  },
  removeTag(taskId: string, tagId: string) {
    return unwrap<{ ok: boolean }>(api.delete(`/tasks/${taskId}/tags/${tagId}`));
  }
};
