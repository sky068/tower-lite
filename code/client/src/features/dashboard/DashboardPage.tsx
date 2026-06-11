import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Select } from "../../components/shared/Select";
import { userApi } from "../../lib/api";
import { formatCalendarDate } from "../../lib/dateTime";
import { getPriorityClassName, getPriorityLabel } from "../../lib/priority";
import type { MyTask } from "../../types/api";

type MyTaskTreeNode = {
  key: string;
  task: MyTask;
  children: MyTask[];
};

const taskStatusTabs = [
  { value: "OPEN", label: "未完成" },
  { value: "DONE", label: "已完成" },
  { value: "ALL", label: "全部" }
] as const;

const myTaskExpandedStorageKey = "tower.dashboard.myTaskTreeExpanded";

function readStoredMyTaskExpanded() {
  try {
    return JSON.parse(localStorage.getItem(myTaskExpandedStorageKey) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

function writeStoredMyTaskExpanded(nextExpanded: Record<string, boolean>) {
  localStorage.setItem(myTaskExpandedStorageKey, JSON.stringify(nextExpanded));
}

function formatCompletedByName(completedBy: MyTask["completedBy"]) {
  if (!completedBy) {
    return "未知成员";
  }

  return completedBy.isRemoved ? `${completedBy.name}(已移除)` : completedBy.name;
}

function formatMyTaskDate(task: MyTask) {
  return task.dueDate ? formatCalendarDate(task.dueDate) : "-";
}

function MyTaskTreeRow({
  node,
  backgroundLocation,
  returnTo,
  expanded,
  onToggle
}: {
  node: MyTaskTreeNode;
  backgroundLocation: ReturnType<typeof useLocation>;
  returnTo: string;
  expanded: Record<string, boolean>;
  onToggle: (nodeKey: string) => void;
}) {
  const task = node.task;
  const childTasks = node.children.filter((child) => child.isAssignedToMe);
  const hasChildren = childTasks.length > 0;
  const isExpanded = expanded[node.key] ?? true;
  const isContextOnly = !task.isAssignedToMe;
  const completedSubTaskCount = childTasks.filter((child) => child.completedAt).length;
  const rowClassName = [
    "project-task-list-row",
    "dashboard-task-list-row",
    "root",
    task.completedAt ? "completed" : null,
    isContextOnly ? "context" : null
  ].filter(Boolean).join(" ");

  return (
    <div className="project-task-list-node">
      <div className={rowClassName}>
        <span className="project-task-title-cell">
          {hasChildren ? (
            <button
              className="tree-toggle-button"
              type="button"
              aria-label={`${isExpanded ? "收起" : "展开"}${task.title}`}
              aria-expanded={isExpanded}
              onClick={() => onToggle(node.key)}
            >
              {isExpanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
            </button>
          ) : (
            <span className="tree-spacer" />
          )}
          <Link className="project-task-title-button" to={`/tasks/${task.id}`} state={{ backgroundLocation, returnTo }}>
            <span>{task.title}</span>
            {hasChildren ? (
              <span className="project-task-subtask-count">
                ({completedSubTaskCount}/{childTasks.length})
              </span>
            ) : null}
          </Link>
        </span>
        <span
          className={`${getPriorityClassName(task.priority)} project-task-priority-square`}
          title={getPriorityLabel(task.priority)}
        >
          {getPriorityLabel(task.priority)}
        </span>
        <span className="project-task-date-cell">
          {task.completedAt ? (
            <span className="task-completion-meta">
              {formatCompletedByName(task.completedBy)} {formatCalendarDate(task.completedAt)}完成
            </span>
          ) : (
            formatMyTaskDate(task)
          )}
        </span>
        <span className="dashboard-task-context-cell">
          {isContextOnly ? <span className="dashboard-task-context-label">父任务</span> : null}
          <span>{task.project.name}</span>
          <span>{task.taskList.name}</span>
        </span>
      </div>
      {hasChildren && isExpanded ? (
        <div className="project-task-list-node">
          {childTasks.map((child) => (
            <div
              className={[
                "project-task-list-row",
                "dashboard-task-list-row",
                "child",
                child.completedAt ? "completed" : null
              ].filter(Boolean).join(" ")}
              key={child.id}
            >
              <span className="project-task-title-cell" style={{ paddingLeft: "22px" }}>
                <span className="tree-spacer" />
                <Link className="project-task-title-button" to={`/tasks/${child.id}`} state={{ backgroundLocation, returnTo }}>
                  <span>{child.title}</span>
                </Link>
              </span>
              <span
                className={`${getPriorityClassName(child.priority)} project-task-priority-square`}
                title={getPriorityLabel(child.priority)}
              >
                {getPriorityLabel(child.priority)}
              </span>
              <span className="project-task-date-cell">
                {child.completedAt ? (
                  <span className="task-completion-meta">
                    {formatCompletedByName(child.completedBy)} {formatCalendarDate(child.completedAt)}完成
                  </span>
                ) : (
                  formatMyTaskDate(child)
                )}
              </span>
              <span className="dashboard-task-context-cell">
                <span>{child.project.name}</span>
                <span>{child.taskList.name}</span>
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function DashboardPage() {
  const location = useLocation();
  const [taskSearch, setTaskSearch] = useState("");
  const [taskProjectFilter, setTaskProjectFilter] = useState("ALL");
  const [taskStatusFilter, setTaskStatusFilter] = useState<"OPEN" | "DONE" | "ALL">("OPEN");
  const [myTaskExpanded, setMyTaskExpanded] = useState<Record<string, boolean>>(() => readStoredMyTaskExpanded());

  const myTasksQuery = useQuery({
    queryKey: ["my-tasks"],
    queryFn: userApi.myTasks
  });
  const myTaskProjects = useMemo(() => {
    const projects = new Map<string, string>();

    for (const task of myTasksQuery.data ?? []) {
      if (task.isAssignedToMe) {
        projects.set(task.project.id, task.project.name);
      }
    }

    return Array.from(projects, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name, "zh-CN")
    );
  }, [myTasksQuery.data]);

  const myTaskDisplay = useMemo(() => {
    const keyword = taskSearch.trim().toLowerCase();
    const tasks = myTasksQuery.data ?? [];
    const taskMap = new Map(tasks.map((task) => [task.id, task]));
    const visibleAssignedTaskIds = new Set<string>();

    function matchesTreeStatus(task: MyTask) {
      const parentTask = task.parentId ? taskMap.get(task.parentId) : null;
      const isCompletedBySelfOrParent = Boolean(task.completedAt || parentTask?.completedAt);

      return (
        taskStatusFilter === "ALL" ||
        (taskStatusFilter === "OPEN" && !isCompletedBySelfOrParent) ||
        (taskStatusFilter === "DONE" && isCompletedBySelfOrParent)
      );
    }

    const visibleAssignedTasks = tasks.filter((task) => {
      const matchesKeyword =
        !keyword ||
        task.title.toLowerCase().includes(keyword) ||
        task.parentTask?.title.toLowerCase().includes(keyword) ||
        task.project.name.toLowerCase().includes(keyword) ||
        task.taskList.name.toLowerCase().includes(keyword);
      const matchesProject = taskProjectFilter === "ALL" || task.project.id === taskProjectFilter;

      return task.isAssignedToMe && matchesTreeStatus(task) && matchesKeyword && matchesProject;
    });

    for (const task of visibleAssignedTasks) {
      visibleAssignedTaskIds.add(task.id);
    }

    const visibleContextParentIds = new Set(
      visibleAssignedTasks
        .map((task) => task.parentId)
        .filter((parentId): parentId is string => Boolean(parentId))
        .filter((parentId) => !visibleAssignedTaskIds.has(parentId))
    );

    return {
      tasks: tasks.filter(
        (task) => visibleAssignedTaskIds.has(task.id) || visibleContextParentIds.has(task.id)
      ),
      visibleAssignedTasks
    };
  }, [myTasksQuery.data, taskProjectFilter, taskSearch, taskStatusFilter]);

  const myTaskTree = useMemo(() => {
    const taskMap = new Map(myTaskDisplay.tasks.map((task) => [task.id, task]));

    const nodes: MyTaskTreeNode[] = [];

    for (const task of myTaskDisplay.visibleAssignedTasks) {
      if (task.parentId) {
        const parentTask = taskMap.get(task.parentId);

        if (parentTask) {
          nodes.push({
            key: `${parentTask.id}:${task.id}`,
            task: parentTask,
            children: [task]
          });
          continue;
        }
      }

      nodes.push({
        key: task.id,
        task,
        children: []
      });
    }

    return nodes;
  }, [myTaskDisplay]);
  const toggleMyTaskNode = (nodeKey: string) => {
    setMyTaskExpanded((current) => {
      const next = {
        ...current,
        [nodeKey]: !(current[nodeKey] ?? true)
      };
      writeStoredMyTaskExpanded(next);
      return next;
    });
  };
  return (
    <div className="page">
      <div className="page-heading">
        <h1>工作台</h1>
        <p>这里聚合分配给你的任务；团队和项目从左侧边栏进入。</p>
      </div>

      <div className="dashboard-grid">
        <section className="panel dashboard-scroll-panel dashboard-task-panel">
          <div className="panel-title-row">
            <h2>我的任务</h2>
            <div className="panel-title-actions">
              <Select
                className="project-filter-select"
                ariaLabel="我的任务项目筛选"
                value={taskProjectFilter}
                onChange={setTaskProjectFilter}
                options={[
                  { value: "ALL", label: "全部项目" },
                  ...myTaskProjects.map((project) => ({ value: project.id, label: project.name }))
                ]}
              />
              <div className="status-tabs" role="tablist" aria-label="我的任务状态筛选">
                {taskStatusTabs.map((tab) => (
                  <button
                    className={taskStatusFilter === tab.value ? "active" : ""}
                    key={tab.value}
                    type="button"
                    role="tab"
                    aria-selected={taskStatusFilter === tab.value}
                    onClick={() => setTaskStatusFilter(tab.value)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <input
            className="filter-input"
            value={taskSearch}
            onChange={(event) => setTaskSearch(event.target.value)}
            placeholder="搜索任务、项目或清单"
          />
          <div className="project-task-list-table dashboard-task-list-table dashboard-scroll-list">
            <div className="project-task-list-head dashboard-task-list-head">
              <span>任务标题</span>
              <span>优先级</span>
              <span>截止时间</span>
              <span>项目 / 清单</span>
            </div>
            {myTasksQuery.isLoading ? <span className="muted">任务加载中...</span> : null}
            {myTaskTree.map((node) => (
              <MyTaskTreeRow
                backgroundLocation={location}
                expanded={myTaskExpanded}
                key={node.key}
                node={node}
                onToggle={toggleMyTaskNode}
                returnTo={location.pathname}
              />
            ))}
            {!myTasksQuery.isLoading && myTaskTree.length === 0 ? (
              <span className="muted">没有匹配的任务</span>
            ) : null}
          </div>
        </section>
      </div>

    </div>
  );
}
