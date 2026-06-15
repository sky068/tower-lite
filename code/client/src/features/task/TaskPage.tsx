import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useParams, type Location } from "react-router-dom";
import { ResourceState } from "../../components/shared/ResourceState";
import { boardApi, projectApi, teamApi } from "../../lib/api";
import { isVerifiedSystemAdmin } from "../../lib/members";
import { getProjectPermissions } from "../../lib/permissions";
import { useAuthStore } from "../../stores/authStore";
import { TaskDetailPanel } from "../board/TaskDetailPanel";

type TaskRouteState = {
  backgroundLocation?: Location;
  returnTo?: string;
};

function locationToPath(location: Location) {
  return `${location.pathname}${location.search}${location.hash}`;
}

function getReturnTo(location: Location) {
  const state = location.state as TaskRouteState | null;
  return typeof state?.returnTo === "string" &&
    state.returnTo.startsWith("/") &&
    !state.returnTo.startsWith("/tasks/")
    ? state.returnTo
    : null;
}

function useTaskRouteData() {
  const { taskId } = useParams();
  const user = useAuthStore((state) => state.user);
  const taskQuery = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => boardApi.getTask(taskId!),
    enabled: Boolean(taskId)
  });

  const task = taskQuery.data;
  const projectQuery = useQuery({
    queryKey: ["project", task?.projectId],
    queryFn: () => projectApi.get(task!.projectId),
    enabled: Boolean(task?.projectId)
  });
  const isArchived = projectQuery.data?.status === "ARCHIVED";
  const projectMembersQuery = useQuery({
    queryKey: ["project-members", task?.projectId],
    queryFn: () => projectApi.members(task!.projectId),
    enabled: Boolean(task?.projectId)
  });
  const teamMembersQuery = useQuery({
    queryKey: ["team-members", projectQuery.data?.teamId],
    queryFn: () => teamApi.members(projectQuery.data!.teamId),
    enabled: Boolean(projectQuery.data?.teamId)
  });
  const { canEditProject } = getProjectPermissions(
    user?.id,
    projectMembersQuery.data,
    teamMembersQuery.data,
    isVerifiedSystemAdmin(user)
  );
  const isReadOnly = isArchived || !canEditProject;
  const readOnlyReason = isArchived
    ? "这个项目已归档，不能修改任务、子任务、标签或评论。"
    : !canEditProject
    ? "你当前是只读成员，可以查看任务但不能修改。"
    : undefined;

  return {
    task,
    taskQuery,
    isArchived,
    isReadOnly,
    readOnlyReason,
    canEditProject
  };
}

export function TaskModalRoute() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as TaskRouteState | null;
  const { task, taskQuery, isReadOnly, readOnlyReason } = useTaskRouteData();
  const closePath = state?.backgroundLocation
    ? locationToPath(state.backgroundLocation)
    : getReturnTo(location) ?? "/dashboard";

  if (taskQuery.error) {
    return (
      <div className="modal-backdrop">
        <section className="task-detail-modal" aria-label="任务详情">
          <header className="task-detail-header">
            <div>
              <span className="eyebrow">任务详情</span>
              <h2>任务不可用</h2>
            </div>
            <button className="text-button" type="button" onClick={() => navigate(closePath, { replace: true })}>
              关闭
            </button>
          </header>
          <ResourceState error={taskQuery.error} backTo={closePath} backLabel="返回上一页" />
        </section>
      </div>
    );
  }

  return task ? (
    <TaskDetailPanel
      projectId={task.projectId}
      taskId={task.id}
      readOnly={isReadOnly}
      readOnlyReason={readOnlyReason}
      closeOnSave={false}
      restoreWindowScrollOnClose={false}
      onOpenTask={(nextTaskId) =>
        navigate(`/tasks/${nextTaskId}`, {
          replace: true,
          state
        })
      }
      onClose={() => navigate(closePath, { replace: true })}
    />
  ) : null;
}

export function TaskPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { task, taskQuery, isArchived, isReadOnly, readOnlyReason, canEditProject } =
    useTaskRouteData();
  const returnTo = getReturnTo(location);
  const fallbackPath = "/dashboard";
  const closePath = returnTo ?? fallbackPath;
  const returnLabel = returnTo === "/dashboard" || !returnTo ? "返回工作台" : "返回上一页";

  return (
    <div className="page">
      <div className="page-heading">
        <h1>任务</h1>
        <p>{task?.title ?? "正在加载任务详情"}</p>
        {task ? (
          <Link className="text-link inline" to={closePath}>
            {returnLabel}
          </Link>
        ) : null}
      </div>
      {isArchived ? (
        <section className="notice-panel">
          这个项目已归档，当前任务为只读状态。
        </section>
      ) : null}
      {!isArchived && !canEditProject ? (
        <section className="notice-panel">
          你当前是只读成员，可以查看任务但不能修改。
        </section>
      ) : null}
      {taskQuery.isLoading ? <span className="muted">任务加载中...</span> : null}
      {taskQuery.error ? <ResourceState error={taskQuery.error} backTo={closePath} backLabel={returnLabel} /> : null}
      {task ? (
        <TaskDetailPanel
          projectId={task.projectId}
          taskId={task.id}
          readOnly={isReadOnly}
          readOnlyReason={readOnlyReason}
          closeOnSave={false}
          restoreWindowScrollOnClose={false}
          onOpenTask={(nextTaskId) => navigate(`/tasks/${nextTaskId}`, { replace: true })}
          onClose={() => navigate(closePath)}
        />
      ) : null}
    </div>
  );
}
