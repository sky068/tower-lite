import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { boardApi } from "../../lib/api";
import { TaskDetailPanel } from "../board/TaskDetailPanel";

export function TaskPage() {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const taskQuery = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => boardApi.getTask(taskId!),
    enabled: Boolean(taskId)
  });

  const task = taskQuery.data;

  return (
    <div className="page">
      <div className="page-heading">
        <h1>任务</h1>
        <p>{task?.title ?? "正在加载任务详情"}</p>
        {task ? (
          <Link className="text-link inline" to={`/projects/${task.projectId}/board`}>
            返回项目看板
          </Link>
        ) : null}
      </div>
      {taskQuery.isLoading ? <span className="muted">任务加载中...</span> : null}
      {task ? (
        <TaskDetailPanel
          projectId={task.projectId}
          taskId={task.id}
          onClose={() => navigate(`/projects/${task.projectId}/board`)}
        />
      ) : null}
    </div>
  );
}
