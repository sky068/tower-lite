import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "react-router-dom";
import { MutationError } from "../../components/shared/MutationError";
import { ResourceState } from "../../components/shared/ResourceState";
import { boardApi, projectApi, teamApi } from "../../lib/api";
import { formatCalendarDate } from "../../lib/dateTime";
import { getProjectPermissions } from "../../lib/permissions";
import { useAuthStore } from "../../stores/authStore";

function formatDeletedAt(value: string | null) {
  return value ? formatCalendarDate(value) : "未知时间";
}

function formatDeletedBy(user: { name: string } | null) {
  return user?.name ?? "未知成员";
}

export function ProjectTrashPage() {
  const { projectId } = useParams();
  const location = useLocation();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => projectApi.get(projectId!),
    enabled: Boolean(projectId)
  });

  const membersQuery = useQuery({
    queryKey: ["project-members", projectId],
    queryFn: () => projectApi.members(projectId!),
    enabled: Boolean(projectId)
  });

  const teamMembersQuery = useQuery({
    queryKey: ["team-members", projectQuery.data?.teamId],
    queryFn: () => teamApi.members(projectQuery.data!.teamId),
    enabled: Boolean(projectQuery.data?.teamId)
  });

  const projectPermissions = getProjectPermissions(user?.id, membersQuery.data, teamMembersQuery.data);
  const canManageProject = projectPermissions.canManageProject;
  const isArchived = projectQuery.data?.status === "ARCHIVED";

  const trashQuery = useQuery({
    queryKey: ["project-trash", projectId],
    queryFn: () => boardApi.trash(projectId!),
    enabled: Boolean(projectId) && canManageProject
  });

  const invalidateProjectTrash = () => {
    void queryClient.invalidateQueries({ queryKey: ["project-trash", projectId] });
    void queryClient.invalidateQueries({ queryKey: ["board", projectId] });
    void queryClient.invalidateQueries({ queryKey: ["project-task-list", projectId] });
    void queryClient.invalidateQueries({ queryKey: ["project-activity", projectId] });
  };

  const restoreListMutation = useMutation({
    mutationFn: (listId: string) => boardApi.restoreList(projectId!, listId),
    onSuccess: invalidateProjectTrash
  });

  const purgeListMutation = useMutation({
    mutationFn: (listId: string) => boardApi.purgeList(projectId!, listId),
    onSuccess: invalidateProjectTrash
  });

  const restoreTaskMutation = useMutation({
    mutationFn: boardApi.restoreTask,
    onSuccess: invalidateProjectTrash
  });

  const purgeTaskMutation = useMutation({
    mutationFn: boardApi.purgeTask,
    onSuccess: invalidateProjectTrash
  });

  const taskLists = trashQuery.data?.taskLists ?? [];
  const tasks = trashQuery.data?.tasks ?? [];
  const mutationError =
    restoreListMutation.error ??
    purgeListMutation.error ??
    restoreTaskMutation.error ??
    purgeTaskMutation.error;

  if (projectQuery.error) {
    return (
      <div className="page">
        <ResourceState error={projectQuery.error} />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-heading">
        <h1>{projectQuery.data?.name ?? "项目"}</h1>
        <nav className="project-menu" aria-label="项目菜单">
          <Link to={`/projects/${projectId}/board`}>看板</Link>
          <Link to={`/projects/${projectId}/list`}>列表</Link>
          {projectId && canManageProject ? (
            <Link to={`/projects/${projectId}/settings`} state={{ returnTo: location.pathname }}>
              设置
            </Link>
          ) : null}
          {canManageProject ? (
            <Link className="active" aria-current="page" to={`/projects/${projectId}/trash`}>
              回收站
            </Link>
          ) : null}
        </nav>
      </div>

      {!canManageProject ? (
        <section className="notice-panel">只有项目 ADMIN 或团队 OWNER / ADMIN 可以查看回收站。</section>
      ) : null}
      {isArchived ? (
        <section className="notice-panel">项目已归档，回收站只允许查看，不能恢复或彻底删除。</section>
      ) : null}

      <MutationError error={trashQuery.error ?? mutationError} />

      <section className="panel">
        <div className="panel-title-row">
          <h2>已删除清单</h2>
          <span className="muted">{taskLists.length} 个</span>
        </div>
        {trashQuery.isLoading ? <span className="muted">回收站加载中...</span> : null}
        <div className="list settings-scroll-list">
          {taskLists.map((list) => (
            <div className="trash-row" key={list.id}>
              <div className="trash-row-main">
                <strong>{list.name}</strong>
                <span>
                  {list.taskCount} 个任务 · 删除人：{formatDeletedBy(list.deletedBy)} · 删除于 {formatDeletedAt(list.deletedAt)}
                </span>
              </div>
              <div className="segmented-actions compact-actions">
                <button
                  type="button"
                  disabled={isArchived || restoreListMutation.isPending}
                  onClick={() => {
                    const taskCopy = list.taskCount > 0 ? `，并恢复其中 ${list.taskCount} 个任务` : "";
                    if (window.confirm(`确认恢复清单“${list.name}”${taskCopy}？`)) {
                      restoreListMutation.mutate(list.id);
                    }
                  }}
                >
                  恢复
                </button>
                <button
                  className="danger-inline"
                  type="button"
                  disabled={isArchived || purgeListMutation.isPending}
                  onClick={() => {
                    const firstConfirmed = window.confirm(
                      `确认彻底删除清单“${list.name}”？清单内任务也会被永久删除。`
                    );
                    const secondConfirmed =
                      firstConfirmed && window.confirm("这是不可恢复操作，请再次确认是否继续彻底删除。");
                    if (secondConfirmed) {
                      purgeListMutation.mutate(list.id);
                    }
                  }}
                >
                  彻底删除
                </button>
              </div>
            </div>
          ))}
          {!trashQuery.isLoading && taskLists.length === 0 ? (
            <span className="muted">暂无已删除清单</span>
          ) : null}
        </div>
      </section>

      <section className="panel">
        <div className="panel-title-row">
          <h2>已删除任务</h2>
          <span className="muted">{tasks.length} 个</span>
        </div>
        <div className="list settings-scroll-list">
          {tasks.map((task) => (
            <div className="trash-row" key={task.id}>
              <div className="trash-row-main">
                <strong>{task.title}</strong>
                <span>
                  {task.taskList.name}
                  {task.parent ? ` · 父任务：${task.parent.title}` : ""} · 删除人：{formatDeletedBy(task.deletedBy)} · 删除于 {formatDeletedAt(task.deletedAt)}
                </span>
              </div>
              <div className="segmented-actions compact-actions">
                <button
                  type="button"
                  disabled={isArchived || restoreTaskMutation.isPending}
                  onClick={() => {
                    if (window.confirm(`确认恢复任务“${task.title}”？`)) {
                      restoreTaskMutation.mutate(task.id);
                    }
                  }}
                >
                  恢复
                </button>
                <button
                  className="danger-inline"
                  type="button"
                  disabled={isArchived || purgeTaskMutation.isPending}
                  onClick={() => {
                    const firstConfirmed = window.confirm(`确认彻底删除任务“${task.title}”？该操作不可恢复。`);
                    const secondConfirmed =
                      firstConfirmed && window.confirm("这是不可恢复操作，请再次确认是否继续彻底删除。");
                    if (secondConfirmed) {
                      purgeTaskMutation.mutate(task.id);
                    }
                  }}
                >
                  彻底删除
                </button>
              </div>
            </div>
          ))}
          {!trashQuery.isLoading && tasks.length === 0 ? (
            <span className="muted">暂无已删除任务</span>
          ) : null}
        </div>
      </section>
    </div>
  );
}
