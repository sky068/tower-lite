CREATE TABLE IF NOT EXISTS "ActivityLog" (
  "id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT,
  "metadata" JSONB,
  "actorId" TEXT,
  "teamId" TEXT NOT NULL,
  "projectId" TEXT,
  "taskId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ActivityLog_teamId_createdAt_idx" ON "ActivityLog"("teamId", "createdAt");
CREATE INDEX IF NOT EXISTS "ActivityLog_projectId_createdAt_idx" ON "ActivityLog"("projectId", "createdAt");
CREATE INDEX IF NOT EXISTS "ActivityLog_taskId_createdAt_idx" ON "ActivityLog"("taskId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ActivityLog_actorId_fkey'
  ) THEN
    ALTER TABLE "ActivityLog"
      ADD CONSTRAINT "ActivityLog_actorId_fkey"
      FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ActivityLog_teamId_fkey'
  ) THEN
    ALTER TABLE "ActivityLog"
      ADD CONSTRAINT "ActivityLog_teamId_fkey"
      FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ActivityLog_projectId_fkey'
  ) THEN
    ALTER TABLE "ActivityLog"
      ADD CONSTRAINT "ActivityLog_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
