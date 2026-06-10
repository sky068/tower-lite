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

export type CurrentUser = User & {
  feishuBound: boolean;
  feishuOpenId: string | null;
  feishuUnionId: string | null;
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
  role?: ProjectRole;
  createdAt: string;
  updatedAt: string;
};

export type TaskList = {
  id: string;
  name: string;
  isDefault: boolean;
  sortKey: string;
  deletedAt: string | null;
  tasks: Task[];
};

export type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE";

export type Task = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  sortKey: string;
  startDate: string | null;
  dueDate: string | null;
  taskListId: string;
  projectId: string;
  creatorId: string;
  parentId: string | null;
  completedAt: string | null;
  completedBy: Pick<User, "id" | "name" | "avatarUrl"> | null;
  createdAt: string;
  updatedAt: string;
  assignees?: Array<Pick<User, "id" | "name" | "avatarUrl"> & { isRemoved?: boolean }>;
  tags?: Tag[];
  subTaskCount?: number;
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
  mentions: Array<Pick<User, "id" | "name" | "avatarUrl">>;
};

export type TaskDetail = Task & {
  parentTrail: Array<{
    id: string;
    title: string;
  }>;
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
  completedBy: (Pick<User, "id" | "name" | "avatarUrl"> & { isRemoved?: boolean }) | null;
  parentId: string | null;
  isAssignedToMe: boolean;
  parentTask: {
    id: string;
    title: string;
  } | null;
  project: {
    id: string;
    name: string;
  };
  taskList: {
    id: string;
    name: string;
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

export type FeishuDelivery = {
  id: string;
  status: "PENDING" | "SENT" | "FAILED" | "SKIPPED";
  attemptCount: number;
  lastError: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
  notification: {
    id: string;
    type: string;
    title: string;
    content: string;
    link: string | null;
    taskId: string | null;
    createdAt: string;
  };
  recipient: Pick<User, "id" | "name" | "email" | "avatarUrl"> & {
    feishuBound: boolean;
  };
};

export type Invitation = {
  id: string;
  email: string;
  token: string;
  status: "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED";
  teamRole: "OWNER" | "ADMIN" | "MEMBER" | null;
  projectRole: "OWNER" | "EDITOR" | "VIEWER" | null;
  teamId: string;
  projectId: string | null;
  acceptPath: string;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
  inviter?: {
    id: string;
    name: string;
    email: string;
  };
  project?: {
    id: string;
    name: string;
  } | null;
};

export type ActivityLog = {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  actorId: string | null;
  teamId: string;
  projectId: string | null;
  taskId: string | null;
  createdAt: string;
  actor: (Pick<User, "id" | "name" | "email" | "avatarUrl">) | null;
  project?: {
    id: string;
    name: string;
  } | null;
};

export type ProjectTrash = {
  taskLists: Array<{
    id: string;
    name: string;
    deletedAt: string | null;
    deletedBy: Pick<User, "id" | "name" | "email" | "avatarUrl"> | null;
    taskCount: number;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    deletedAt: string | null;
    deletedBy: Pick<User, "id" | "name" | "email" | "avatarUrl"> | null;
    taskList: {
      id: string;
      name: string;
      deletedAt: string | null;
    };
    parent: {
      id: string;
      title: string;
      deletedAt: string | null;
    } | null;
  }>;
};

export type TeamProjectTrash = {
  projects: Array<{
    id: string;
    name: string;
    description: string | null;
    status: "ACTIVE" | "ARCHIVED";
    deletedAt: string | null;
    deletedBy: Pick<User, "id" | "name" | "email" | "avatarUrl"> | null;
  }>;
};
