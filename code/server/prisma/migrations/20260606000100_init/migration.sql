CREATE TYPE "TeamRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');
CREATE TYPE "ProjectStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "ProjectRole" AS ENUM ('OWNER', 'EDITOR', 'VIEWER');
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');
CREATE TYPE "TaskListType" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE', 'CUSTOM');
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');
CREATE TYPE "DependencyType" AS ENUM ('FINISH_TO_START', 'START_TO_START', 'FINISH_TO_FINISH', 'START_TO_FINISH');
CREATE TYPE "NotificationType" AS ENUM ('TASK_ASSIGNED', 'TASK_DUE_SOON', 'COMMENT_MENTION', 'TASK_COMPLETED', 'PROJECT_JOINED');
CREATE TYPE "DeliveryChannel" AS ENUM ('IN_APP', 'FEISHU');
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT,
  "name" TEXT NOT NULL,
  "avatarUrl" TEXT,
  "feishuOpenId" TEXT,
  "feishuUnionId" TEXT,
  "emailVerifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RefreshToken" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Team" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeamMember" (
  "id" TEXT NOT NULL,
  "role" "TeamRole" NOT NULL,
  "userId" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Project" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "color" TEXT,
  "icon" TEXT,
  "status" "ProjectStatus" NOT NULL DEFAULT 'ACTIVE',
  "teamId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectMember" (
  "id" TEXT NOT NULL,
  "role" "ProjectRole" NOT NULL,
  "projectId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Invitation" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
  "teamRole" "TeamRole",
  "projectRole" "ProjectRole",
  "teamId" TEXT NOT NULL,
  "projectId" TEXT,
  "inviterId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaskList" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "TaskListType" NOT NULL DEFAULT 'CUSTOM',
  "sortKey" DECIMAL(18,6) NOT NULL,
  "projectId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaskList_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Task" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
  "sortKey" DECIMAL(18,6) NOT NULL,
  "startDate" TIMESTAMP(3),
  "dueDate" TIMESTAMP(3),
  "taskListId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "assigneeId" TEXT,
  "creatorId" TEXT NOT NULL,
  "parentId" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaskDependency" (
  "id" TEXT NOT NULL,
  "type" "DependencyType" NOT NULL DEFAULT 'FINISH_TO_START',
  "dependentTaskId" TEXT NOT NULL,
  "prerequisiteId" TEXT NOT NULL,
  "lagDays" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskDependency_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Tag" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "color" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaskTag" (
  "taskId" TEXT NOT NULL,
  "tagId" TEXT NOT NULL,
  CONSTRAINT "TaskTag_pkey" PRIMARY KEY ("taskId","tagId")
);

CREATE TABLE "Comment" (
  "id" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Notification" (
  "id" TEXT NOT NULL,
  "type" "NotificationType" NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "link" TEXT,
  "payload" JSONB,
  "isRead" BOOLEAN NOT NULL DEFAULT false,
  "readAt" TIMESTAMP(3),
  "dedupeKey" TEXT,
  "recipientId" TEXT NOT NULL,
  "actorId" TEXT,
  "teamId" TEXT,
  "projectId" TEXT,
  "taskId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationDelivery" (
  "id" TEXT NOT NULL,
  "notificationId" TEXT NOT NULL,
  "channel" "DeliveryChannel" NOT NULL,
  "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_feishuOpenId_key" ON "User"("feishuOpenId");
CREATE UNIQUE INDEX "User_feishuUnionId_key" ON "User"("feishuUnionId");
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");
CREATE UNIQUE INDEX "TeamMember_userId_teamId_key" ON "TeamMember"("userId", "teamId");
CREATE INDEX "TeamMember_teamId_role_idx" ON "TeamMember"("teamId", "role");
CREATE INDEX "Project_teamId_status_idx" ON "Project"("teamId", "status");
CREATE UNIQUE INDEX "ProjectMember_projectId_userId_key" ON "ProjectMember"("projectId", "userId");
CREATE INDEX "ProjectMember_userId_idx" ON "ProjectMember"("userId");
CREATE UNIQUE INDEX "Invitation_token_key" ON "Invitation"("token");
CREATE INDEX "Invitation_email_status_idx" ON "Invitation"("email", "status");
CREATE INDEX "Invitation_teamId_status_idx" ON "Invitation"("teamId", "status");
CREATE INDEX "TaskList_projectId_sortKey_idx" ON "TaskList"("projectId", "sortKey");
CREATE INDEX "Task_projectId_idx" ON "Task"("projectId");
CREATE INDEX "Task_taskListId_sortKey_idx" ON "Task"("taskListId", "sortKey");
CREATE INDEX "Task_assigneeId_dueDate_idx" ON "Task"("assigneeId", "dueDate");
CREATE INDEX "Task_parentId_idx" ON "Task"("parentId");
CREATE UNIQUE INDEX "TaskDependency_dependentTaskId_prerequisiteId_key" ON "TaskDependency"("dependentTaskId", "prerequisiteId");
CREATE UNIQUE INDEX "Tag_projectId_name_key" ON "Tag"("projectId", "name");
CREATE INDEX "Comment_taskId_createdAt_idx" ON "Comment"("taskId", "createdAt");
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");
CREATE INDEX "Notification_recipientId_isRead_createdAt_idx" ON "Notification"("recipientId", "isRead", "createdAt");
CREATE INDEX "Notification_taskId_idx" ON "Notification"("taskId");
CREATE INDEX "NotificationDelivery_status_channel_idx" ON "NotificationDelivery"("status", "channel");
CREATE INDEX "NotificationDelivery_notificationId_channel_idx" ON "NotificationDelivery"("notificationId", "channel");

ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaskList" ADD CONSTRAINT "TaskList_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_taskListId_fkey" FOREIGN KEY ("taskListId") REFERENCES "TaskList"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_dependentTaskId_fkey" FOREIGN KEY ("dependentTaskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_prerequisiteId_fkey" FOREIGN KEY ("prerequisiteId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaskTag" ADD CONSTRAINT "TaskTag_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaskTag" ADD CONSTRAINT "TaskTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
