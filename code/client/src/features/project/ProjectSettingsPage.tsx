import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ActivityLogPanel } from "../../components/shared/ActivityLogPanel";
import { MutationError } from "../../components/shared/MutationError";
import { UserAvatar } from "../../components/shared/UserAvatar";
import { activityApi, invitationApi, projectApi, teamApi } from "../../lib/api";
import { getAcceptUrl, getInvitationStatusLabel } from "../../lib/invitations";
import { getProjectPermissions } from "../../lib/permissions";
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
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteTeamRole, setInviteTeamRole] = useState<"OWNER" | "ADMIN" | "MEMBER">("MEMBER");
  const [inviteProjectRole, setInviteProjectRole] = useState<"OWNER" | "EDITOR" | "VIEWER">("EDITOR");

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
  const { canManageProject } = getProjectPermissions(
    user?.id,
    membersQuery.data,
    teamMembersQuery.data
  );
  const isArchived = projectQuery.data?.status === "ARCHIVED";

  const invitationsQuery = useQuery({
    queryKey: ["project-invitations", projectId],
    queryFn: () => projectApi.invitations(projectId!),
    enabled: Boolean(projectId) && canManageProject
  });
  const activityQuery = useQuery({
    queryKey: ["project-activity", projectId],
    queryFn: () => activityApi.project(projectId!),
    enabled: Boolean(projectId) && canManageProject
  });

  const updateProjectMutation = useMutation({
    mutationFn: () => projectApi.update(projectId!, { name, description }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.invalidateQueries({ queryKey: ["project-activity", projectId] });
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
      void queryClient.invalidateQueries({ queryKey: ["project-activity", projectId] });
    }
  });

  const createInvitationMutation = useMutation({
    mutationFn: () =>
      projectApi.createInvitation(projectId!, {
        email: inviteEmail,
        teamRole: inviteTeamRole,
        projectRole: inviteProjectRole
      }),
    onSuccess: () => {
      setInviteEmail("");
      setInviteTeamRole("MEMBER");
      setInviteProjectRole("EDITOR");
      void queryClient.invalidateQueries({ queryKey: ["project-invitations", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["project-activity", projectId] });
    }
  });

  const revokeInvitationMutation = useMutation({
    mutationFn: invitationApi.revoke,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["project-invitations", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["project-activity", projectId] });
    }
  });

  const updateRoleMutation = useMutation({
    mutationFn: (input: { userId: string; role: "OWNER" | "EDITOR" | "VIEWER" }) =>
      projectApi.updateMemberRole(projectId!, input.userId, input.role),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["project-members", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["project-activity", projectId] });
    }
  });

  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => projectApi.removeMember(projectId!, userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["project-members", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["project-activity", projectId] });
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
    if (canManageProject) {
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

  function handleCreateInvitation(event: FormEvent) {
    event.preventDefault();

    if (canManageProject) {
      createInvitationMutation.mutate();
    }
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
              disabled={!canManageProject}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </label>
          <label>
            描述
            <textarea
              value={description}
              disabled={!canManageProject}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
            />
          </label>
          <button type="submit" disabled={!canManageProject || updateProjectMutation.isPending}>保存</button>
        </form>
        {!canManageProject ? <span className="muted">只有项目 OWNER 或团队 OWNER / ADMIN 可以修改项目基础信息。</span> : null}
        <MutationError error={updateProjectMutation.error} />
      </section>
      <section className="panel">
        <h2>邀请项目成员</h2>
        <form className="settings-form invite-form" onSubmit={handleCreateInvitation}>
          <input
            type="email"
            value={inviteEmail}
            onChange={(event) => setInviteEmail(event.target.value)}
            placeholder="成员邮箱"
            disabled={!canManageProject}
            required
          />
          <select
            value={inviteProjectRole}
            disabled={!canManageProject}
            onChange={(event) => setInviteProjectRole(event.target.value as typeof inviteProjectRole)}
          >
            <option value="OWNER">项目 OWNER</option>
            <option value="EDITOR">项目 EDITOR</option>
            <option value="VIEWER">项目 VIEWER</option>
          </select>
          <select
            value={inviteTeamRole}
            disabled={!canManageProject}
            onChange={(event) => setInviteTeamRole(event.target.value as typeof inviteTeamRole)}
          >
            <option value="MEMBER">团队 MEMBER</option>
            <option value="ADMIN">团队 ADMIN</option>
            <option value="OWNER">团队 OWNER</option>
          </select>
          <button type="submit" disabled={!canManageProject || createInvitationMutation.isPending}>
            创建邀请
          </button>
        </form>
        {!canManageProject ? <span className="muted">只有项目 OWNER 或团队 OWNER / ADMIN 可以邀请项目成员。</span> : null}
        <MutationError error={createInvitationMutation.error ?? revokeInvitationMutation.error} />
        {createInvitationMutation.data ? (
          <label className="copy-field">
            邀请链接
            <input readOnly value={getAcceptUrl(createInvitationMutation.data.acceptPath)} />
          </label>
        ) : null}
      </section>
      <section className="panel">
        <h2>邀请记录</h2>
        <div className="list settings-scroll-list">
          {(invitationsQuery.data ?? []).map((invitation) => (
            <div className="member-row" key={invitation.id}>
              <div>
                <strong>{invitation.email}</strong>
                <span>
                  团队 {invitation.teamRole ?? "MEMBER"} / 项目{" "}
                  {invitation.projectRole ?? "VIEWER"} / {getInvitationStatusLabel(invitation.status)}
                </span>
                {invitation.status === "PENDING" ? (
                  <span className="muted">{getAcceptUrl(invitation.acceptPath)}</span>
                ) : null}
              </div>
              {invitation.status === "PENDING" ? (
                <button
                  className="danger-button"
                  type="button"
                  disabled={!canManageProject || revokeInvitationMutation.isPending}
                  onClick={() => {
                    if (window.confirm(`确认撤销发给 ${invitation.email} 的邀请？`)) {
                      revokeInvitationMutation.mutate(invitation.id);
                    }
                  }}
                >
                  撤销
                </button>
              ) : null}
            </div>
          ))}
          {!invitationsQuery.isLoading && (invitationsQuery.data ?? []).length === 0 ? (
            <span className="muted">暂无邀请记录</span>
          ) : null}
        </div>
      </section>
      <section className="panel">
        <h2>直接添加已有团队成员</h2>
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
        <div className="list settings-scroll-list">
          {(membersQuery.data ?? []).map((member) => (
            <div className="member-row member-person-row" key={member.user.id}>
              <UserAvatar user={member.user} size="md" />
              <div className="member-info">
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
      {canManageProject ? (
        <ActivityLogPanel logs={activityQuery.data ?? []} isLoading={activityQuery.isLoading} />
      ) : null}
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
