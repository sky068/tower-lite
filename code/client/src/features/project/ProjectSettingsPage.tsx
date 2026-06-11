import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ActivityLogPanel } from "../../components/shared/ActivityLogPanel";
import { CopyableInviteLink } from "../../components/shared/CopyableInviteLink";
import { MutationError } from "../../components/shared/MutationError";
import { ResourceState } from "../../components/shared/ResourceState";
import { UserAvatar } from "../../components/shared/UserAvatar";
import { activityApi, invitationApi, projectApi, systemApi, teamApi } from "../../lib/api";
import { getAcceptUrl, getInvitationStatusLabel } from "../../lib/invitations";
import { getProjectPermissions } from "../../lib/permissions";
import { useAuthStore } from "../../stores/authStore";
import type { FeishuDelivery } from "../../types/api";

const feishuDeliveryStatusLabels: Record<FeishuDelivery["status"], string> = {
  PENDING: "待发送",
  SENT: "已发送",
  FAILED: "发送失败",
  SKIPPED: "已跳过"
};

const feishuDeliveryStatusFilters = [
  { value: "ALL", label: "全部" },
  { value: "PENDING", label: "待发送" },
  { value: "FAILED", label: "发送失败" },
  { value: "SKIPPED", label: "已跳过" },
  { value: "SENT", label: "已发送" }
] as const;

const feishuDeliveryClearStatusOptions = [
  { value: "ALL", label: "全部非待发送" },
  { value: "SENT", label: "已发送" },
  { value: "FAILED", label: "发送失败" },
  { value: "SKIPPED", label: "已跳过" }
] as const;

type FeishuDeliveryClearStatus = (typeof feishuDeliveryClearStatusOptions)[number]["value"];

export function ProjectSettingsPage() {
  const { projectId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [memberUserId, setMemberUserId] = useState("");
  const [memberRole, setMemberRole] = useState<"ADMIN" | "EDITOR" | "VIEWER">("EDITOR");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteTeamRole, setInviteTeamRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [inviteProjectRole, setInviteProjectRole] = useState<"ADMIN" | "EDITOR" | "VIEWER">("EDITOR");
  const [feishuDeliveryStatusFilter, setFeishuDeliveryStatusFilter] =
    useState<(typeof feishuDeliveryStatusFilters)[number]["value"]>("ALL");
  const [feishuClearStartDate, setFeishuClearStartDate] = useState("");
  const [feishuClearEndDate, setFeishuClearEndDate] = useState("");
  const [feishuClearStatus, setFeishuClearStatus] = useState<FeishuDeliveryClearStatus>("ALL");
  const isSystemAdmin = user?.systemRole === "ADMIN";

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
    teamMembersQuery.data,
    isSystemAdmin
  );
  const isArchived = projectQuery.data?.status === "ARCHIVED";
  const locationState = location.state as { returnTo?: string } | null;
  const fallbackReturnPath = projectId ? `/projects/${projectId}/board` : "/dashboard";
  const returnPath =
    locationState?.returnTo?.startsWith(projectId ? `/projects/${projectId}/` : "") ? locationState.returnTo : fallbackReturnPath;
  const returnLabel = `← 返回 ${projectQuery.data?.name ?? "项目"}`;

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
  const feishuDeliveriesQuery = useQuery({
    queryKey: ["project-feishu-deliveries", projectId],
    queryFn: () => projectApi.feishuDeliveries(projectId!),
    enabled: Boolean(projectId) && canManageProject
  });
  const filteredFeishuDeliveries = useMemo(
    () =>
      (feishuDeliveriesQuery.data ?? []).filter(
        (delivery) => feishuDeliveryStatusFilter === "ALL" || delivery.status === feishuDeliveryStatusFilter
      ),
    [feishuDeliveriesQuery.data, feishuDeliveryStatusFilter]
  );

  const updateProjectMutation = useMutation({
    mutationFn: () => projectApi.update(projectId!, { name, description }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.invalidateQueries({ queryKey: ["project-activity", projectId] });
    }
  });

  const archiveProjectMutation = useMutation({
    mutationFn: () => projectApi.archive(projectId!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.invalidateQueries({ queryKey: ["project-activity", projectId] });
    }
  });

  const unarchiveProjectMutation = useMutation({
    mutationFn: () => projectApi.unarchive(projectId!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.invalidateQueries({ queryKey: ["project-activity", projectId] });
    }
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
    mutationFn: (input: { userId: string; role: "ADMIN" | "EDITOR" | "VIEWER" }) =>
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
  const retryFeishuDeliveryMutation = useMutation({
    mutationFn: (deliveryId: string) => projectApi.retryFeishuDelivery(projectId!, deliveryId),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["project-feishu-deliveries", projectId] });
    }
  });
  const clearFeishuDeliveriesMutation = useMutation({
    mutationFn: (input: { startDate: string; endDate: string; status: FeishuDeliveryClearStatus }) =>
      projectApi.clearFeishuDeliveries(projectId!, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["project-feishu-deliveries", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["project-activity", projectId] });
    }
  });
  const clearActivityMutation = useMutation({
    mutationFn: (input: { startDate: string; endDate: string }) => activityApi.clearProject(projectId!, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["project-activity", projectId] });
    }
  });
  const setDefaultProjectMutation = useMutation({
    mutationFn: () =>
      projectQuery.data?.isSystemDefault
        ? systemApi.clearDefaultProject(projectId!)
        : systemApi.setDefaultProject(projectId!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["projects", projectQuery.data?.teamId] });
      void queryClient.invalidateQueries({ queryKey: ["teams"] });
    }
  });

  useEffect(() => {
    if (projectQuery.data) {
      setName(projectQuery.data.name);
      setDescription(projectQuery.data.description ?? "");
    }
  }, [projectQuery.data]);

  if (projectQuery.error) {
    return (
      <div className="page">
        <ResourceState error={projectQuery.error} />
      </div>
    );
  }

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

  function handleClearFeishuDeliveries(event: FormEvent) {
    event.preventDefault();

    if (!feishuClearStartDate || !feishuClearEndDate || !canManageProject) {
      return;
    }

    if (
      window.confirm(
        `确认删除 ${feishuClearStartDate} 至 ${feishuClearEndDate} 的飞书投递记录？待发送记录不会被清理，此操作不可恢复。`
      )
    ) {
      clearFeishuDeliveriesMutation.mutate({
        startDate: feishuClearStartDate,
        endDate: feishuClearEndDate,
        status: feishuClearStatus
      });
    }
  }

  return (
    <div className="page">
      <div className="page-heading">
        {projectId ? (
          <button
            className="back-button"
            type="button"
            onClick={() => navigate(returnPath)}
          >
            {returnLabel}
          </button>
        ) : null}
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
        {!canManageProject ? <span className="muted">只有项目 ADMIN、团队 ADMIN 或系统管理员可以修改项目基础信息。</span> : null}
        <MutationError error={updateProjectMutation.error} />
        {isSystemAdmin ? (
          <div className="segmented-actions">
            <button
              type="button"
              disabled={setDefaultProjectMutation.isPending || isArchived}
              onClick={() => setDefaultProjectMutation.mutate()}
            >
              {projectQuery.data?.isSystemDefault ? "取消默认项目" : "设为默认项目"}
            </button>
          </div>
        ) : null}
        <MutationError error={setDefaultProjectMutation.error} />
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
            <option value="ADMIN">项目 ADMIN</option>
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
          </select>
          <button type="submit" disabled={!canManageProject || createInvitationMutation.isPending}>
            创建邀请
          </button>
        </form>
        {!canManageProject ? <span className="muted">只有项目 ADMIN、团队 ADMIN 或系统管理员可以邀请项目成员。</span> : null}
        <MutationError error={createInvitationMutation.error ?? revokeInvitationMutation.error} />
        {createInvitationMutation.data ? (
          <CopyableInviteLink
            label="邀请链接"
            url={getAcceptUrl(createInvitationMutation.data.acceptPath)}
            variant="field"
          />
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
                  <CopyableInviteLink url={getAcceptUrl(invitation.acceptPath)} />
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
            <option value="ADMIN">ADMIN</option>
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
        {!canManageProject ? <span className="muted">只有项目 ADMIN、团队 ADMIN 或系统管理员可以管理项目成员。</span> : null}
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
                    role: event.target.value as "ADMIN" | "EDITOR" | "VIEWER"
                  })
                }
              >
                <option value="ADMIN">ADMIN</option>
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
        <ActivityLogPanel
          logs={activityQuery.data ?? []}
          isLoading={activityQuery.isLoading}
          title="项目审计日志"
          clearError={clearActivityMutation.error}
          isClearing={clearActivityMutation.isPending}
          onClearRange={(input) => clearActivityMutation.mutate(input)}
        />
      ) : null}
      {canManageProject ? (
        <section className="panel">
          <div className="panel-title-row">
            <h2>飞书通知投递</h2>
            <select
              className="project-filter-select"
              aria-label="飞书投递状态筛选"
              value={feishuDeliveryStatusFilter}
              onChange={(event) =>
                setFeishuDeliveryStatusFilter(event.target.value as typeof feishuDeliveryStatusFilter)
              }
            >
              {feishuDeliveryStatusFilters.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </select>
          </div>
          <form className="activity-clear-form delivery-clear-form" onSubmit={handleClearFeishuDeliveries}>
            <label>
              开始日期
              <input
                type="date"
                value={feishuClearStartDate}
                max={feishuClearEndDate || undefined}
                onChange={(event) => setFeishuClearStartDate(event.target.value)}
                required
              />
            </label>
            <label>
              结束日期
              <input
                type="date"
                value={feishuClearEndDate}
                min={feishuClearStartDate || undefined}
                onChange={(event) => setFeishuClearEndDate(event.target.value)}
                required
              />
            </label>
            <label>
              清理状态
              <select
                value={feishuClearStatus}
                onChange={(event) => setFeishuClearStatus(event.target.value as FeishuDeliveryClearStatus)}
              >
                {feishuDeliveryClearStatusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="danger-button"
              type="submit"
              disabled={
                clearFeishuDeliveriesMutation.isPending || !feishuClearStartDate || !feishuClearEndDate
              }
            >
              清理投递记录
            </button>
          </form>
          <div className="list settings-scroll-list delivery-scroll-list">
            {filteredFeishuDeliveries.map((delivery) => (
              <div className="delivery-row" key={delivery.id}>
                <UserAvatar user={delivery.recipient} size="md" />
                <div>
                  <strong>{delivery.notification.title}</strong>
                  <span>
                    {delivery.recipient.name} / {feishuDeliveryStatusLabels[delivery.status]} / 重试{" "}
                    {delivery.attemptCount} 次
                  </span>
                  {delivery.lastError ? <span className="error-text">{delivery.lastError}</span> : null}
                </div>
                <div className="delivery-actions">
                  <time dateTime={delivery.updatedAt}>
                    {new Date(delivery.updatedAt).toLocaleString("zh-CN")}
                  </time>
                  {delivery.canRetry ? (
                    <button
                      className="mini-button"
                      type="button"
                      disabled={retryFeishuDeliveryMutation.isPending}
                      onClick={() => retryFeishuDeliveryMutation.mutate(delivery.id)}
                    >
                      重试
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
            {feishuDeliveriesQuery.isLoading ? <span className="muted">飞书投递记录加载中...</span> : null}
            {!feishuDeliveriesQuery.isLoading && filteredFeishuDeliveries.length === 0 ? (
              <span className="muted">暂无飞书投递记录</span>
            ) : null}
          </div>
          <MutationError
            error={
              feishuDeliveriesQuery.error ??
              retryFeishuDeliveryMutation.error ??
              clearFeishuDeliveriesMutation.error
            }
          />
        </section>
      ) : null}
      <section className="panel danger-zone">
        <h2>危险操作</h2>
        <MutationError
          error={archiveProjectMutation.error ?? unarchiveProjectMutation.error ?? deleteProjectMutation.error}
        />
        <div className="segmented-actions">
          <button
            type="button"
            disabled={!canManageProject || archiveProjectMutation.isPending || unarchiveProjectMutation.isPending}
            onClick={() => {
              if (isArchived) {
                if (window.confirm("确认取消归档这个项目？")) {
                  unarchiveProjectMutation.mutate();
                }
              } else if (window.confirm("确认归档这个项目？")) {
                archiveProjectMutation.mutate();
              }
            }}
          >
            {isArchived ? "取消归档" : "归档项目"}
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
