import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ActivityLogPanel } from "../../components/shared/ActivityLogPanel";
import { CopyableInviteLink } from "../../components/shared/CopyableInviteLink";
import { MutationError } from "../../components/shared/MutationError";
import { UserAvatar } from "../../components/shared/UserAvatar";
import { activityApi, invitationApi, projectApi, systemApi, teamApi } from "../../lib/api";
import { formatCalendarDate } from "../../lib/dateTime";
import { getAcceptUrl, getInvitationStatusLabel } from "../../lib/invitations";
import { useAuthStore } from "../../stores/authStore";

function formatDeletedBy(user: { name: string; email: string } | null) {
  return user ? `${user.name} / ${user.email}` : "未知成员";
}

export function TeamDetailPage() {
  const { teamId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const [teamName, setTeamName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [isProjectTrashOpen, setIsProjectTrashOpen] = useState(false);
  const [teamSaveMessage, setTeamSaveMessage] = useState("");
  const isSystemAdmin = user?.systemRole === "ADMIN";

  const membersQuery = useQuery({
    queryKey: ["team-members", teamId],
    queryFn: () => teamApi.members(teamId!),
    enabled: Boolean(teamId)
  });
  const teamsQuery = useQuery({
    queryKey: ["teams"],
    queryFn: teamApi.list
  });
  const currentMember = (membersQuery.data ?? []).find((member) => member.user.id === user?.id);
  const canManageTeam = isSystemAdmin || currentMember?.role === "ADMIN";
  const team = (teamsQuery.data ?? []).find((item) => item.id === teamId);
  const normalizedTeamName = teamName.trim();
  const isTeamNameDirty = Boolean(team && normalizedTeamName !== team.name);

  const invitationsQuery = useQuery({
    queryKey: ["team-invitations", teamId],
    queryFn: () => teamApi.invitations(teamId!),
    enabled: Boolean(teamId) && canManageTeam
  });
  const activityQuery = useQuery({
    queryKey: ["team-activity", teamId],
    queryFn: () => activityApi.team(teamId!),
    enabled: Boolean(teamId) && canManageTeam
  });
  const projectsQuery = useQuery({
    queryKey: ["projects", teamId],
    queryFn: () => projectApi.list(teamId!),
    enabled: Boolean(teamId)
  });
  const projectTrashQuery = useQuery({
    queryKey: ["team-project-trash", teamId],
    queryFn: () => projectApi.trash(teamId!),
    enabled: Boolean(teamId && canManageTeam && isProjectTrashOpen)
  });

  const addMemberMutation = useMutation({
    mutationFn: () => teamApi.addMember(teamId!, { email, role }),
    onSuccess: () => {
      setEmail("");
      setRole("MEMBER");
      void queryClient.invalidateQueries({ queryKey: ["team-members", teamId] });
      void queryClient.invalidateQueries({ queryKey: ["team-activity", teamId] });
    }
  });
  const updateTeamMutation = useMutation({
    mutationFn: () => teamApi.update(teamId!, { name: teamName.trim() }),
    onSuccess: () => {
      setTeamSaveMessage("已保存");
      void queryClient.invalidateQueries({ queryKey: ["teams"] });
      void queryClient.invalidateQueries({ queryKey: ["team-activity", teamId] });
    }
  });

  const createInvitationMutation = useMutation({
    mutationFn: () => teamApi.createInvitation(teamId!, { email: inviteEmail, role: inviteRole }),
    onSuccess: () => {
      setInviteEmail("");
      setInviteRole("MEMBER");
      void queryClient.invalidateQueries({ queryKey: ["team-invitations", teamId] });
      void queryClient.invalidateQueries({ queryKey: ["team-activity", teamId] });
    }
  });

  const revokeInvitationMutation = useMutation({
    mutationFn: invitationApi.revoke,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["team-invitations", teamId] });
      void queryClient.invalidateQueries({ queryKey: ["team-activity", teamId] });
    }
  });

  const updateRoleMutation = useMutation({
    mutationFn: (input: { userId: string; role: "ADMIN" | "MEMBER" }) =>
      teamApi.updateMemberRole(teamId!, input.userId, input.role),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["team-members", teamId] });
      void queryClient.invalidateQueries({ queryKey: ["team-activity", teamId] });
    }
  });

  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => teamApi.removeMember(teamId!, userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["team-members", teamId] });
      void queryClient.invalidateQueries({ queryKey: ["team-activity", teamId] });
    }
  });

  const deleteTeamMutation = useMutation({
    mutationFn: () => teamApi.remove(teamId!),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["teams"] });
      navigate("/dashboard");
    }
  });
  const clearActivityMutation = useMutation({
    mutationFn: (input: { startDate: string; endDate: string }) => activityApi.clearTeam(teamId!, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["team-activity", teamId] });
    }
  });
  const setDefaultTeamMutation = useMutation({
    mutationFn: () =>
      team?.isSystemDefault ? systemApi.clearDefaultTeam(teamId!) : systemApi.setDefaultTeam(teamId!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["teams"] });
    }
  });
  const restoreProjectMutation = useMutation({
    mutationFn: (projectId: string) => projectApi.restoreFromTrash(teamId!, projectId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["team-project-trash", teamId] });
      void queryClient.invalidateQueries({ queryKey: ["projects", teamId] });
    }
  });
  const purgeProjectMutation = useMutation({
    mutationFn: (projectId: string) => projectApi.purgeFromTrash(teamId!, projectId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["team-project-trash", teamId] });
    }
  });
  const canSaveTeam =
    canManageTeam && Boolean(normalizedTeamName) && isTeamNameDirty && !updateTeamMutation.isPending;

  function handleAddMember(event: FormEvent) {
    event.preventDefault();
    if (canManageTeam) {
      addMemberMutation.mutate();
    }
  }

  function handleCreateInvitation(event: FormEvent) {
    event.preventDefault();

    if (canManageTeam) {
      createInvitationMutation.mutate();
    }
  }

  function handleUpdateTeam(event: FormEvent) {
    event.preventDefault();

    if (canSaveTeam) {
      updateTeamMutation.mutate();
    }
  }

  useEffect(() => {
    if (team) {
      setTeamName(team.name);
    }
  }, [team]);

  useEffect(() => {
    setTeamSaveMessage("");
  }, [teamId]);

  return (
    <div className="page">
      <div className="page-heading">
        <h1>{team?.name ?? "团队详情"}</h1>
        <p>查看团队信息、成员和项目；有权限时可管理成员、邀请和审计日志。</p>
      </div>
      <section className="panel">
        <h2>基础信息</h2>
        <form className="settings-form" onSubmit={handleUpdateTeam}>
          <label>
            团队名称
            <input
              value={teamName}
              disabled={!canManageTeam}
              onChange={(event) => {
                setTeamName(event.target.value);
                setTeamSaveMessage("");
              }}
              required
            />
          </label>
          {canManageTeam ? (
            <button type="submit" disabled={!canSaveTeam}>
              {updateTeamMutation.isPending ? "保存中..." : "保存"}
            </button>
          ) : null}
        </form>
        {teamSaveMessage ? <span className="form-success inline-error">{teamSaveMessage}</span> : null}
        <MutationError error={updateTeamMutation.error} />
        {isSystemAdmin ? (
          <div className="segmented-actions">
            <button
              type="button"
              disabled={setDefaultTeamMutation.isPending}
              onClick={() => setDefaultTeamMutation.mutate()}
            >
              {team?.isSystemDefault ? "取消默认团队" : "设为默认团队"}
            </button>
          </div>
        ) : null}
        <MutationError error={setDefaultTeamMutation.error} />
      </section>
      <section className="panel">
        <div className="panel-title-row">
          <h2>团队项目</h2>
          {canManageTeam ? (
            <button
              className="secondary-inline-button"
              type="button"
              onClick={() => setIsProjectTrashOpen(true)}
            >
              项目回收站
            </button>
          ) : null}
        </div>
        {canManageTeam ? <span className="muted">新建项目请使用左侧项目分组中的加号入口。</span> : null}
        <div className="list settings-scroll-list">
          {projectsQuery.isLoading ? <span className="muted">项目加载中...</span> : null}
          {(projectsQuery.data ?? []).map((project) => (
            <div className="member-row" key={project.id}>
              <div>
                <strong>{project.name}</strong>
                <span>
                  {project.status === "ARCHIVED" ? "已归档" : "进行中"}
                  {project.isSystemDefault ? " / 系统默认项目" : ""}
                </span>
              </div>
              <Link className="mini-link" to={`/projects/${project.id}/board`}>
                看板
              </Link>
            </div>
          ))}
          {!projectsQuery.isLoading && (projectsQuery.data ?? []).length === 0 ? (
            <span className="muted">这个团队还没有项目</span>
          ) : null}
        </div>
      </section>
      {canManageTeam ? (
        <section className="panel">
          <h2>邀请成员</h2>
          <form className="settings-form inline" onSubmit={handleCreateInvitation}>
            <input
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="成员邮箱"
              required
            />
            <select
              value={inviteRole}
              onChange={(event) => setInviteRole(event.target.value as typeof inviteRole)}
            >
              <option value="MEMBER">MEMBER</option>
              <option value="ADMIN">ADMIN</option>
            </select>
            <button type="submit" disabled={createInvitationMutation.isPending}>
              创建邀请
            </button>
          </form>
          <MutationError error={createInvitationMutation.error ?? revokeInvitationMutation.error} />
          {createInvitationMutation.data ? (
            <CopyableInviteLink
              label="邀请链接"
              url={getAcceptUrl(createInvitationMutation.data.acceptPath)}
              variant="field"
            />
          ) : null}
        </section>
      ) : null}
      {canManageTeam ? (
        <section className="panel">
          <h2>邀请记录</h2>
          <div className="list settings-scroll-list">
            {(invitationsQuery.data ?? []).map((invitation) => (
              <div className="member-row" key={invitation.id}>
                <div>
                  <strong>{invitation.email}</strong>
                  <span>
                    {invitation.project ? `项目：${invitation.project.name} / ` : "团队 / "}
                    {invitation.projectRole ?? invitation.teamRole} / {getInvitationStatusLabel(invitation.status)}
                  </span>
                  {invitation.status === "PENDING" ? (
                    <CopyableInviteLink url={getAcceptUrl(invitation.acceptPath)} />
                  ) : null}
                </div>
                {invitation.status === "PENDING" ? (
                  <button
                    className="danger-button"
                    type="button"
                    disabled={revokeInvitationMutation.isPending}
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
      ) : null}
      {canManageTeam ? (
        <section className="panel">
          <h2>直接添加已有账号</h2>
          <form className="settings-form inline" onSubmit={handleAddMember}>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="成员邮箱"
              required
            />
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as typeof role)}
            >
              <option value="MEMBER">MEMBER</option>
              <option value="ADMIN">ADMIN</option>
            </select>
            <button type="submit" disabled={addMemberMutation.isPending}>添加</button>
          </form>
          <MutationError error={addMemberMutation.error} />
        </section>
      ) : null}
      <section className="panel">
        <h2>成员</h2>
        <MutationError error={updateRoleMutation.error ?? removeMemberMutation.error} />
        <div className="list settings-scroll-list">
          {(membersQuery.data ?? []).map((member) => (
            <div className="member-row member-person-row" key={member.user.id}>
              <UserAvatar user={member.user} size="md" />
              <div className="member-info">
                <strong>{member.user.name}</strong>
                <span>{member.user.email}</span>
              </div>
              {canManageTeam ? (
                <select
                  value={member.role}
                  disabled={updateRoleMutation.isPending}
                  onChange={(event) =>
                    updateRoleMutation.mutate({
                      userId: member.user.id,
                      role: event.target.value as "ADMIN" | "MEMBER"
                    })
                  }
                >
                  <option value="ADMIN">ADMIN</option>
                  <option value="MEMBER">MEMBER</option>
                </select>
              ) : (
                <span className="role-pill">{member.role}</span>
              )}
              {canManageTeam ? (
                <button
                  className="danger-button"
                  type="button"
                  disabled={removeMemberMutation.isPending}
                  onClick={() => {
                    if (window.confirm(`确认移除 ${member.user.name}？`)) {
                      removeMemberMutation.mutate(member.user.id);
                    }
                  }}
                >
                  移除
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </section>
      {canManageTeam ? (
        <ActivityLogPanel
          logs={activityQuery.data ?? []}
          isLoading={activityQuery.isLoading}
          title="团队审计日志"
          clearError={clearActivityMutation.error}
          isClearing={clearActivityMutation.isPending}
          onClearRange={(input) => clearActivityMutation.mutate(input)}
        />
      ) : null}
      {isSystemAdmin ? (
        <section className="panel danger-zone">
          <h2>危险操作</h2>
          <MutationError error={deleteTeamMutation.error} />
          <button
            className="danger-button"
            type="button"
            disabled={deleteTeamMutation.isPending}
            onClick={() => {
              if (window.confirm(`确认删除团队「${team?.name ?? "当前团队"}」？此操作会将团队标记为已删除。`)) {
                deleteTeamMutation.mutate();
              }
            }}
          >
            删除团队
          </button>
        </section>
      ) : null}
      {isProjectTrashOpen && canManageTeam ? (
        <div className="modal-backdrop">
          <section className="modal" aria-label="团队项目回收站">
            <header className="modal-header">
              <div>
                <h2>项目回收站</h2>
                <p>{team?.name ?? "当前团队"}</p>
              </div>
              <button className="text-button" type="button" onClick={() => setIsProjectTrashOpen(false)}>
                关闭
              </button>
            </header>
            <MutationError
              error={projectTrashQuery.error ?? restoreProjectMutation.error ?? purgeProjectMutation.error}
            />
            <div className="trash-list">
              {projectTrashQuery.isLoading ? <span className="muted">项目回收站加载中...</span> : null}
              {(projectTrashQuery.data?.projects ?? []).map((project) => (
                <div className="trash-row" key={project.id}>
                  <div className="trash-row-main">
                    <strong>{project.name}</strong>
                    <span>
                      {project.status === "ARCHIVED" ? "已归档" : "未归档"} · 删除人：
                      {formatDeletedBy(project.deletedBy)} · 删除于{" "}
                      {project.deletedAt ? formatCalendarDate(project.deletedAt) : "未知时间"}
                    </span>
                  </div>
                  <div className="segmented-actions compact-actions">
                    <button
                      type="button"
                      disabled={restoreProjectMutation.isPending}
                      onClick={() => {
                        if (window.confirm(`确认恢复项目「${project.name}」？`)) {
                          restoreProjectMutation.mutate(project.id);
                        }
                      }}
                    >
                      恢复
                    </button>
                    <button
                      className="danger-inline"
                      type="button"
                      disabled={purgeProjectMutation.isPending}
                      onClick={() => {
                        const firstConfirmed = window.confirm(
                          `确认彻底删除项目「${project.name}」？项目内任务、清单、标签和评论都会被永久删除。`
                        );
                        const secondConfirmed =
                          firstConfirmed && window.confirm("这是不可恢复操作，请再次确认是否继续彻底删除。");
                        if (secondConfirmed) {
                          purgeProjectMutation.mutate(project.id);
                        }
                      }}
                    >
                      彻底删除
                    </button>
                  </div>
                </div>
              ))}
              {!projectTrashQuery.isLoading && (projectTrashQuery.data?.projects ?? []).length === 0 ? (
                <span className="muted">暂无已删除项目</span>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
