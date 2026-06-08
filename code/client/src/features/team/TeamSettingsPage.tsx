import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MutationError } from "../../components/shared/MutationError";
import { invitationApi, teamApi } from "../../lib/api";
import { getAcceptUrl, getInvitationStatusLabel } from "../../lib/invitations";
import { useAuthStore } from "../../stores/authStore";

export function TeamSettingsPage() {
  const { teamId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const [teamName, setTeamName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"OWNER" | "ADMIN" | "MEMBER">("MEMBER");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"OWNER" | "ADMIN" | "MEMBER">("MEMBER");

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
  const canManageTeam = currentMember?.role === "OWNER";
  const team = (teamsQuery.data ?? []).find((item) => item.id === teamId);

  const invitationsQuery = useQuery({
    queryKey: ["team-invitations", teamId],
    queryFn: () => teamApi.invitations(teamId!),
    enabled: Boolean(teamId) && canManageTeam
  });

  const addMemberMutation = useMutation({
    mutationFn: () => teamApi.addMember(teamId!, { email, role }),
    onSuccess: () => {
      setEmail("");
      setRole("MEMBER");
      void queryClient.invalidateQueries({ queryKey: ["team-members", teamId] });
    }
  });
  const updateTeamMutation = useMutation({
    mutationFn: () => teamApi.update(teamId!, { name: teamName.trim() }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["teams"] });
    }
  });

  const createInvitationMutation = useMutation({
    mutationFn: () => teamApi.createInvitation(teamId!, { email: inviteEmail, role: inviteRole }),
    onSuccess: () => {
      setInviteEmail("");
      setInviteRole("MEMBER");
      void queryClient.invalidateQueries({ queryKey: ["team-invitations", teamId] });
    }
  });

  const revokeInvitationMutation = useMutation({
    mutationFn: invitationApi.revoke,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["team-invitations", teamId] });
    }
  });

  const updateRoleMutation = useMutation({
    mutationFn: (input: { userId: string; role: "OWNER" | "ADMIN" | "MEMBER" }) =>
      teamApi.updateMemberRole(teamId!, input.userId, input.role),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["team-members", teamId] });
    }
  });

  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => teamApi.removeMember(teamId!, userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["team-members", teamId] });
    }
  });

  const deleteTeamMutation = useMutation({
    mutationFn: () => teamApi.remove(teamId!),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["teams"] });
      navigate("/dashboard");
    }
  });

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

    if (teamName.trim() && canManageTeam) {
      updateTeamMutation.mutate();
    }
  }

  useEffect(() => {
    if (team) {
      setTeamName(team.name);
    }
  }, [team]);

  return (
    <div className="page">
      <div className="page-heading">
        <h1>团队设置</h1>
        <p>邀请成员加入团队，并管理团队角色。</p>
      </div>
      <section className="panel">
        <h2>基础信息</h2>
        <form className="settings-form" onSubmit={handleUpdateTeam}>
          <label>
            团队名称
            <input
              value={teamName}
              disabled={!canManageTeam}
              onChange={(event) => setTeamName(event.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={!canManageTeam || updateTeamMutation.isPending}>
            保存
          </button>
        </form>
        {!canManageTeam ? <span className="muted">只有团队 OWNER 可以修改团队信息。</span> : null}
        <MutationError error={updateTeamMutation.error} />
      </section>
      <section className="panel">
        <h2>邀请成员</h2>
        <form className="settings-form inline" onSubmit={handleCreateInvitation}>
          <input
            type="email"
            value={inviteEmail}
            onChange={(event) => setInviteEmail(event.target.value)}
            placeholder="成员邮箱"
            disabled={!canManageTeam}
            required
          />
          <select
            value={inviteRole}
            disabled={!canManageTeam}
            onChange={(event) => setInviteRole(event.target.value as typeof inviteRole)}
          >
            <option value="MEMBER">MEMBER</option>
            <option value="ADMIN">ADMIN</option>
            <option value="OWNER">OWNER</option>
          </select>
          <button type="submit" disabled={!canManageTeam || createInvitationMutation.isPending}>
            创建邀请
          </button>
        </form>
        {!canManageTeam ? <span className="muted">只有团队 OWNER 可以邀请成员。</span> : null}
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
                  {invitation.project ? `项目：${invitation.project.name} / ` : "团队 / "}
                  {invitation.projectRole ?? invitation.teamRole} / {getInvitationStatusLabel(invitation.status)}
                </span>
                {invitation.status === "PENDING" ? (
                  <span className="muted">{getAcceptUrl(invitation.acceptPath)}</span>
                ) : null}
              </div>
              {invitation.status === "PENDING" ? (
                <button
                  className="danger-button"
                  type="button"
                  disabled={!canManageTeam || revokeInvitationMutation.isPending}
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
        <h2>直接添加已有账号</h2>
        <form className="settings-form inline" onSubmit={handleAddMember}>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="成员邮箱"
            disabled={!canManageTeam}
            required
          />
          <select
            value={role}
            disabled={!canManageTeam}
            onChange={(event) => setRole(event.target.value as typeof role)}
          >
            <option value="MEMBER">MEMBER</option>
            <option value="ADMIN">ADMIN</option>
            <option value="OWNER">OWNER</option>
          </select>
          <button type="submit" disabled={!canManageTeam || addMemberMutation.isPending}>添加</button>
        </form>
        {!canManageTeam ? <span className="muted">只有团队 OWNER 可以管理成员。</span> : null}
        <MutationError error={addMemberMutation.error} />
      </section>
      <section className="panel">
        <h2>成员</h2>
        <MutationError error={updateRoleMutation.error ?? removeMemberMutation.error} />
        <div className="list settings-scroll-list">
          {(membersQuery.data ?? []).map((member) => (
            <div className="member-row" key={member.user.id}>
              <div>
                <strong>{member.user.name}</strong>
                <span>{member.user.email}</span>
              </div>
              <select
                value={member.role}
                disabled={!canManageTeam || updateRoleMutation.isPending}
                onChange={(event) =>
                  updateRoleMutation.mutate({
                    userId: member.user.id,
                    role: event.target.value as "OWNER" | "ADMIN" | "MEMBER"
                  })
                }
              >
                <option value="OWNER">OWNER</option>
                <option value="ADMIN">ADMIN</option>
                <option value="MEMBER">MEMBER</option>
              </select>
              <button
                className="danger-button"
                type="button"
                disabled={!canManageTeam || removeMemberMutation.isPending}
                onClick={() => {
                  if (window.confirm(`确认移除 ${member.user.name}？`)) {
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
      {canManageTeam ? (
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
    </div>
  );
}
