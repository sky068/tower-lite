import { FormEvent, useState } from "react";
import { formatRelativeTime } from "../../lib/dateTime";
import type { ActivityLog } from "../../types/api";
import { MutationError } from "./MutationError";

const actionLabels: Record<string, string> = {
  "activity_log.cleared": "清理审计日志",
  "feishu_delivery.cleared": "清理飞书投递记录",
  "team_member.added": "添加团队成员",
  "team_member.role_updated": "调整团队角色",
  "team_member.removed": "移除团队成员",
  "team_invitation.created": "创建团队邀请",
  "team_invitation.revoked": "撤销团队邀请",
  "team_invitation.accepted": "接受团队邀请",
  "project.created": "创建项目",
  "project.updated": "更新项目",
  "project.archived": "归档项目",
  "project.unarchived": "取消归档项目",
  "project.deleted": "删除项目",
  "project.restored": "恢复项目",
  "project.purged": "彻底删除项目",
  "project_member.added": "添加项目成员",
  "project_member.role_updated": "调整项目角色",
  "project_member.removed": "移除项目成员",
  "project_invitation.created": "创建项目邀请",
  "project_invitation.revoked": "撤销项目邀请",
  "project_invitation.accepted": "接受项目邀请",
  "task_list.created": "创建任务清单",
  "task_list.updated": "更新任务清单",
  "task_list.deleted": "删除任务清单",
  "task_list.restored": "恢复任务清单",
  "task_list.purged": "彻底删除任务清单",
  "task_list.reordered": "调整清单排序",
  "task.created": "创建任务",
  "task.updated": "更新任务",
  "task.moved": "移动任务",
  "task.status_changed": "修改任务状态",
  "task.deleted": "删除任务",
  "task.restored": "恢复任务",
  "task.purged": "彻底删除任务",
  "comment.created": "新增评论",
  "comment.deleted": "删除评论"
};

const feishuClearStatusLabels: Record<string, string> = {
  ALL: "全部非待发送",
  SENT: "已发送",
  FAILED: "发送失败",
  SKIPPED: "已跳过"
};

type ActivityLogPanelProps = {
  logs: ActivityLog[];
  isLoading: boolean;
  title?: string;
  clearError?: unknown;
  isClearing?: boolean;
  onClearRange?: (input: { startDate: string; endDate: string }) => void;
};

function metadataValue(metadata: ActivityLog["metadata"], key: string) {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function getLogSummary(log: ActivityLog) {
  const title =
    metadataValue(log.metadata, "title") ??
    metadataValue(log.metadata, "name") ??
    metadataValue(log.metadata, "email") ??
    metadataValue(log.metadata, "taskTitle");

  if (log.action === "task.status_changed") {
    const from = metadataValue(log.metadata, "fromTaskListName");
    const to = metadataValue(log.metadata, "toTaskListName");
    return [title, from && to ? `${from} -> ${to}` : null].filter(Boolean).join(" / ");
  }

  if (log.action === "task.updated") {
    const addedAssigneeIds = log.metadata?.addedAssigneeIds;
    const assigneeCount = Array.isArray(addedAssigneeIds) ? addedAssigneeIds.length : 0;
    return [title, assigneeCount > 0 ? `新增 ${assigneeCount} 位负责人` : null].filter(Boolean).join(" / ");
  }

  if (log.action.startsWith("comment.")) {
    return [title, metadataValue(log.metadata, "contentPreview")].filter(Boolean).join(" / ");
  }

  if (log.action === "activity_log.cleared") {
    const startDate = metadataValue(log.metadata, "startDate");
    const endDate = metadataValue(log.metadata, "endDate");
    const deletedCount = log.metadata?.deletedCount;
    return [
      startDate && endDate ? `${startDate} 至 ${endDate}` : null,
      typeof deletedCount === "number" ? `删除 ${deletedCount} 条` : null
    ]
      .filter(Boolean)
      .join(" / ");
  }

  if (log.action === "feishu_delivery.cleared") {
    const startDate = metadataValue(log.metadata, "startDate");
    const endDate = metadataValue(log.metadata, "endDate");
    const status = metadataValue(log.metadata, "status");
    const deletedCount = log.metadata?.deletedCount;
    return [
      startDate && endDate ? `${startDate} 至 ${endDate}` : null,
      status ? `状态 ${feishuClearStatusLabels[status] ?? status}` : null,
      typeof deletedCount === "number" ? `删除 ${deletedCount} 条` : null
    ]
      .filter(Boolean)
      .join(" / ");
  }

  if (log.action.includes("role_updated")) {
    return [title, metadataValue(log.metadata, "role")].filter(Boolean).join(" / ");
  }

  return title ?? log.project?.name ?? log.targetId ?? "无附加信息";
}

export function ActivityLogPanel({
  logs,
  isLoading,
  title = "审计日志",
  clearError,
  isClearing = false,
  onClearRange
}: ActivityLogPanelProps) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  function handleClear(event: FormEvent) {
    event.preventDefault();

    if (!startDate || !endDate || !onClearRange) {
      return;
    }

    if (window.confirm(`确认删除 ${startDate} 至 ${endDate} 的审计日志？此操作不可恢复。`)) {
      onClearRange({ startDate, endDate });
    }
  }

  return (
    <section className="panel">
      <div className="panel-title-row">
        <h2>{title}</h2>
      </div>
      {onClearRange ? (
        <form className="activity-clear-form" onSubmit={handleClear}>
          <label>
            开始日期
            <input
              type="date"
              value={startDate}
              max={endDate || undefined}
              onChange={(event) => setStartDate(event.target.value)}
              required
            />
          </label>
          <label>
            结束日期
            <input
              type="date"
              value={endDate}
              min={startDate || undefined}
              onChange={(event) => setEndDate(event.target.value)}
              required
            />
          </label>
          <button className="danger-button" type="submit" disabled={isClearing || !startDate || !endDate}>
            清理日志
          </button>
        </form>
      ) : null}
      <MutationError error={clearError} />
      <div className="list settings-scroll-list">
        {isLoading ? <span className="muted">日志加载中...</span> : null}
        {logs.map((log) => (
          <div className="activity-row" key={log.id}>
            <div>
              <strong>{actionLabels[log.action] ?? log.action}</strong>
              <span>{getLogSummary(log)}</span>
            </div>
            <div className="activity-meta">
              <span>{log.actor ? `${log.actor.name} / ${log.actor.email}` : "系统"}</span>
              <time dateTime={log.createdAt}>{formatRelativeTime(log.createdAt)}</time>
            </div>
          </div>
        ))}
        {!isLoading && logs.length === 0 ? <span className="muted">暂无审计日志</span> : null}
      </div>
    </section>
  );
}
