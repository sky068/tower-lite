export type ApiResponse<T> = {
  data: T;
  requestId: string;
};

export type User = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
};

export type AuthResponse = {
  accessToken: string;
  refreshToken: string;
  user: User;
};

export type Team = {
  id: string;
  name: string;
  role?: "OWNER" | "ADMIN" | "MEMBER";
  createdAt: string;
  updatedAt: string;
};

export type TeamRole = "OWNER" | "ADMIN" | "MEMBER";
export type ProjectRole = "OWNER" | "EDITOR" | "VIEWER";

export type Member = {
  id: string;
  role: TeamRole | ProjectRole;
  user: User;
};

export type Project = {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  status: "ACTIVE" | "ARCHIVED";
  teamId: string;
  createdAt: string;
  updatedAt: string;
};

export type TaskList = {
  id: string;
  name: string;
  type: "TODO" | "IN_PROGRESS" | "DONE" | "CUSTOM";
  sortKey: string;
  tasks: Task[];
};

export type Task = {
  id: string;
  title: string;
  description: string | null;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  sortKey: string;
  startDate: string | null;
  dueDate: string | null;
  taskListId: string;
  projectId: string;
  assigneeId: string | null;
  creatorId: string;
  parentId: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Comment = {
  id: string;
  content: string;
  createdAt: string;
  author: {
    id: string;
    name: string;
    avatarUrl: string | null;
  };
};

export type TaskDetail = Task & {
  subTasks: Task[];
  comments: Comment[];
  tags: Tag[];
};

export type Tag = {
  id: string;
  name: string;
  color: string;
  projectId: string;
};

export type MyTask = {
  id: string;
  title: string;
  priority: Task["priority"];
  dueDate: string | null;
  completedAt: string | null;
  project: {
    id: string;
    name: string;
  };
  taskList: {
    id: string;
    name: string;
    type: TaskList["type"];
  };
};

export type Notification = {
  id: string;
  type: string;
  title: string;
  content: string;
  link: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
};
