import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { boardApi, projectApi, teamApi } from "../../lib/api";
import { getProjectPermissions } from "../../lib/permissions";
import { useAuthStore } from "../../stores/authStore";
import { TaskDetailPanel } from "../board/TaskDetailPanel";
import { DashboardPage } from "../dashboard/DashboardPage";

export function TaskPage() {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
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
    teamMembersQuery.data
  );
  const isReadOnly = isArchived || !canEditProject;
  const returnTo =
    typeof location.state?.returnTo === "string" &&
    location.state.returnTo.startsWith("/") &&
    !location.state.returnTo.startsWith("/tasks/")
      ? location.state.returnTo
      : null;
  const fallbackPath = task ? `/projects/${task.projectId}/board` : "/dashboard";
  const closePath = returnTo ?? fallbackPath;
  const returnLabel = returnTo === "/dashboard" ? "返回工作台" : returnTo ? "返回上一页" : "返回项目看板";
  const shouldRenderDashboardBehindModal = returnTo === "/dashboard";

  if (shouldRenderDashboardBehindModal) {
    return (
      <>
        <DashboardPage />
        {task ? (
          <TaskDetailPanel
            projectId={task.projectId}
            taskId={task.id}
            readOnly={isReadOnly}
            closeOnSave={false}
            onClose={() => navigate(closePath)}
          />
        ) : null}
      </>
    );
  }

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
      {task ? (
        <TaskDetailPanel
          projectId={task.projectId}
          taskId={task.id}
          readOnly={isReadOnly}
          closeOnSave={false}
          onClose={() => navigate(closePath)}
        />
      ) : null}
    </div>
  );
}
