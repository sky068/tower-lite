import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MutationError } from "../../components/shared/MutationError";
import { projectApi, teamApi } from "../../lib/api";
import { useAuthStore } from "../../stores/authStore";

export function ProjectSettingsPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [memberUserId, setMemberUserId] = useState("");
  const [memberRole, setMemberRole] = useState<"OWNER" | "EDITOR" | "VIEWER">("EDITOR");

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

  const availableTeamMembers = useMemo(() => {
    const projectMemberIds = new Set((membersQuery.data ?? []).map((member) => member.user.id));
    return (teamMembersQuery.data ?? []).filter((member) => !projectMemberIds.has(member.user.id));
  }, [membersQuery.data, teamMembersQuery.data]);
  const currentProjectMember = (membersQuery.data ?? []).find((member) => member.user.id === user?.id);
  const currentTeamMember = (teamMembersQuery.data ?? []).find((member) => member.user.id === user?.id);
  const isTeamAdmin = currentTeamMember?.role === "OWNER" || currentTeamMember?.role === "ADMIN";
  const canEditProject =
    isTeamAdmin ||
    currentProjectMember?.role === "OWNER" ||
    currentProjectMember?.role === "EDITOR";
  const canManageProject = isTeamAdmin || currentProjectMember?.role === "OWNER";
  const isArchived = projectQuery.data?.status === "ARCHIVED";

  const updateProjectMutation = useMutation({
    mutationFn: () => projectApi.update(projectId!, { name, description }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    }
  });

  const archiveProjectMutation = useMutation({
    mutationFn: () => projectApi.archive(projectId!),
    onSuccess: () => navigate("/dashboard")
  });

  const deleteProjectMutation = useMutation({
    mutationFn: () => projectApi.remove(projectId!),
    onSuccess: () => navigate("/dashboard")
  });

  const addMemberMutation = useMutation({
    mutationFn: () => projectApi.addMember(projectId!, { userId: memberUserId, role: memberRole }),
    onSuccess: () => {
      setMemberUserId("");
      setMemberRole("EDITOR");
      void queryClient.invalidateQueries({ queryKey: ["project-members", projectId] });
    }
  });

  const updateRoleMutation = useMutation({
    mutationFn: (input: { userId: string; role: "OWNER" | "EDITOR" | "VIEWER" }) =>
      projectApi.updateMemberRole(projectId!, input.userId, input.role),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["project-members", projectId] });
    }
  });

  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => projectApi.removeMember(projectId!, userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["project-members", projectId] });
    }
  });

  useEffect(() => {
    if (projectQuery.data) {
      setName(projectQuery.data.name);
      setDescription(projectQuery.data.description ?? "");
    }
  }, [projectQuery.data]);

  function handleUpdateProject(event: FormEvent) {
    event.preventDefault();
    if (canEditProject) {
      updateProjectMutation.mutate();
    }
  }

  function handleAddMember(event: FormEvent) {
    event.preventDefault();

    if (!memberUserId || !canManageProject) {
      return;
    }

    addMemberMutation.mutate();
  }

  return (
    <div className="page">
      <div className="page-heading">
        <h1>项目设置</h1>
        <p>管理项目基础信息、成员和生命周期。</p>
      </div>
      {isArchived ? <section className="notice-panel">这个项目已归档，任务协作已进入只读状态。</section> : null}
      <section className="panel">
        <h2>基础信息</h2>
        <form className="settings-form" onSubmit={handleUpdateProject}>
          <label>
            项目名称
            <input
              value={name}
              disabled={!canEditProject}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </label>
          <label>
            描述
            <textarea
              value={description}
              disabled={!canEditProject}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
            />
          </label>
          <button type="submit" disabled={!canEditProject || updateProjectMutation.isPending}>保存</button>
        </form>
        {!canEditProject ? <span className="muted">你当前是只读成员，不能修改项目基础信息。</span> : null}
        <MutationError error={updateProjectMutation.error} />
      </section>
      <section className="panel">
        <h2>添加项目成员</h2>
        <form className="settings-form inline" onSubmit={handleAddMember}>
          <select
            value={memberUserId}
            onChange={(event) => setMemberUserId(event.target.value)}
            required
            disabled={!canManageProject || availableTeamMembers.length === 0}
          >
            <option value="">选择团队成员</option>
            {availableTeamMembers.map((member) => (
              <option key={member.user.id} value={member.user.id}>
                {member.user.name} / {member.user.email}
              </option>
            ))}
          </select>
          <select
            value={memberRole}
            disabled={!canManageProject}
            onChange={(event) => setMemberRole(event.target.value as typeof memberRole)}
          >
            <option value="OWNER">OWNER</option>
            <option value="EDITOR">EDITOR</option>
            <option value="VIEWER">VIEWER</option>
          </select>
          <button
            type="submit"
            disabled={!canManageProject || addMemberMutation.isPending || availableTeamMembers.length === 0}
          >
            添加
          </button>
        </form>
        {!canManageProject ? <span className="muted">只有项目 OWNER 或团队 OWNER / ADMIN 可以管理项目成员。</span> : null}
        {availableTeamMembers.length === 0 ? (
          <span className="muted">所有团队成员都已经在项目里。</span>
        ) : null}
        <MutationError error={addMemberMutation.error} />
      </section>
      <section className="panel">
        <h2>项目成员</h2>
        <MutationError error={updateRoleMutation.error ?? removeMemberMutation.error} />
        <div className="list">
          {(membersQuery.data ?? []).map((member) => (
            <div className="member-row" key={member.user.id}>
              <div>
                <strong>{member.user.name}</strong>
                <span>{member.user.email}</span>
              </div>
              <select
                value={member.role}
                disabled={!canManageProject || updateRoleMutation.isPending}
                onChange={(event) =>
                  updateRoleMutation.mutate({
                    userId: member.user.id,
                    role: event.target.value as "OWNER" | "EDITOR" | "VIEWER"
                  })
                }
              >
                <option value="OWNER">OWNER</option>
                <option value="EDITOR">EDITOR</option>
                <option value="VIEWER">VIEWER</option>
              </select>
              <button
                className="danger-button"
                type="button"
                disabled={!canManageProject || removeMemberMutation.isPending}
                onClick={() => {
                  if (window.confirm(`确认移除 ${member.user.name}？任务中的历史负责人会保留为“已移除”。`)) {
                    removeMemberMutation.mutate(member.user.id);
                  }
                }}
              >
                移除
              </button>
            </div>
          ))}
        </div>
      </section>
      <section className="panel danger-zone">
        <h2>危险操作</h2>
        <MutationError error={archiveProjectMutation.error ?? deleteProjectMutation.error} />
        <div className="segmented-actions">
          <button
            type="button"
            disabled={!canManageProject || archiveProjectMutation.isPending || isArchived}
            onClick={() => {
              if (window.confirm("确认归档这个项目？")) {
                archiveProjectMutation.mutate();
              }
            }}
          >
            归档项目
          </button>
          <button
            type="button"
            disabled={!canManageProject || deleteProjectMutation.isPending}
            onClick={() => {
              if (window.confirm("确认删除这个项目？")) {
                deleteProjectMutation.mutate();
              }
            }}
          >
            删除项目
          </button>
        </div>
      </section>
    </div>
  );
}
