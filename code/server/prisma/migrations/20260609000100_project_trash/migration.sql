ALTER TABLE "TaskList" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "deletedWithTaskListId" TEXT;

DROP INDEX IF EXISTS "TaskList_projectId_name_key";

CREATE UNIQUE INDEX IF NOT EXISTS "TaskList_projectId_name_active_key"
  ON "TaskList"("projectId", "name")
  WHERE "deletedAt" IS NULL;
