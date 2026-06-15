import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ActivityLogPanel } from "../../components/shared/ActivityLogPanel";
import { CopyableInviteLink } from "../../components/shared/CopyableInviteLink";
import { MutationError } from "../../components/shared/MutationError";
import { ResourceState } from "../../components/shared/ResourceState";
import { Select } from "../../components/shared/Select";
import { UserAvatar } from "../../components/shared/UserAvatar";
import { UserSelect } from "../../components/shared/UserSelect";
import { activityApi, projectApi, teamApi } from "../../lib/api";
import { getAcceptUrl } from "../../lib/invitations";
import { getMemberName, getMemberUser, isVerifiedSystemAdmin } from "../../lib/members";
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
  const [selectedTeamMemberId, setSelectedTeamMemberId] = useState("");
  const [memberRole, setMemberRole] = useState<"ADMIN" | "EDITOR" | "VIEWER">("EDITOR");
  const [feishuDeliveryStatusFilter, setFeishuDeliveryStatusFilter] =
    useState<(typeof feishuDeliveryStatusFilters)[number]["value"]>("ALL");
  const [feishuClearStartDate, setFeishuClearStartDate] = useState("");
  const [feishuClearEndDate, setFeishuClearEndDate] = useState("");
  const [feishuClearStatus, setFeishuClearStatus] = useState<FeishuDeliveryClearStatus>("ALL");
  const [projectSaveMessage, setProjectSaveMessage] = useState("");
  const isSystemAdmin = isVerifiedSystemAdmin(user);

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
  const availableProjectMemberCandidates = useMemo(() => {
    const projectTeamMemberIds = new Set(
      (membersQuery.data ?? []).map((member) => member.teamMemberId).filter(Boolean)
    );
    const projectMemberEmails = new Set((membersQuery.data ?? []).map((member) => member.normalizedEmail));

    return (teamMembersQuery.data ?? [])
      .filter((member) => !projectTeamMemberIds.has(member.id) && !projectMemberEmails.has(member.normalizedEmail))
      .map((member) => ({
        ...getMemberUser(member),
        id: member.id
      }));
  }, [membersQuery.data, teamMembersQuery.data]);

  const updateProjectMutation = useMutation({
    mutationFn: () => projectApi.update(projectId!, { name: name.trim(), description: description.trim() }),
    onSuccess: () => {
      setProjectSaveMessage("已保存");
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
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
    mutationFn: () => projectApi.addMember(projectId!, { teamMemberId: selectedTeamMemberId, role: memberRole }),
    onSuccess: () => {
      setSelectedTeamMemberId("");
      setMemberRole("EDITOR");
      void queryClient.invalidateQueries({ queryKey: ["project-members", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["team-members", projectQuery.data?.teamId] });
      void queryClient.invalidateQueries({ queryKey: ["project-activity", projectId] });
    }
  });

  const updateRoleMutation = useMutation({
    mutationFn: (input: { memberId: string; role: "ADMIN" | "EDITOR" | "VIEWER" }) =>
      projectApi.updateMemberRole(projectId!, input.memberId, input.role),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["project-members", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["project-activity", projectId] });
    }
  });

  const removeMemberMutation = useMutation({
    mutationFn: (memberId: string) => projectApi.removeMember(projectId!, memberId),
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
  const normalizedProjectName = name.trim();
  const normalizedProjectDescription = description.trim();
  const isProjectDirty = Boolean(
    projectQuery.data &&
      (normalizedProjectName !== projectQuery.data.name ||
        normalizedProjectDescription !== (projectQuery.data.description ?? ""))
  );
  const canSaveProject =
    canManageProject && Boolean(normalizedProjectName) && isProjectDirty && !updateProjectMutation.isPending;

  useEffect(() => {
    if (projectQuery.data) {
      setName(projectQuery.data.name);
      setDescription(projectQuery.data.description ?? "");
    }
  }, [projectQuery.data]);

  useEffect(() => {
    setProjectSaveMessage("");
  }, [projectId]);

  if (projectQuery.error) {
    return (
      <div className="page">
        <ResourceState error={projectQuery.error} />
      </div>
    );
  }

  function handleUpdateProject(event: FormEvent) {
    event.preventDefault();
    if (canSaveProject) {
      updateProjectMutation.mutate();
    }
  }

  function handleAddMember(event: FormEvent) {
    event.preventDefault();

    if (!selectedTeamMemberId || !canManageProject) {
      return;
    }

    addMemberMutation.mutate();
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
              onChange={(event) => {
                setName(event.target.value);
                setProjectSaveMessage("");
              }}
              required
            />
          </label>
          <label>
            描述
            <textarea
              value={description}
              disabled={!canManageProject}
              onChange={(event) => {
                setDescription(event.target.value);
                setProjectSaveMessage("");
              }}
              rows={3}
            />
          </label>
          <button type="submit" disabled={!canSaveProject}>
            {updateProjectMutation.isPending ? "保存中..." : "保存"}
          </button>
        </form>
        {!canManageProject ? <span className="muted">只有项目 ADMIN、团队 ADMIN 或系统管理员可以修改项目基础信息。</span> : null}
        {projectSaveMessage ? <span className="form-success inline-error">{projectSaveMessage}</span> : null}
        <MutationError error={updateProjectMutation.error} />
      </section>
      <section className="panel">
        <h2>添加项目成员</h2>
        <form className="settings-form inline" onSubmit={handleAddMember}>
          <UserSelect
            value={selectedTeamMemberId}
            users={availableProjectMemberCandidates}
            onChange={setSelectedTeamMemberId}
            placeholder="选择团队成员"
            emptyText={teamMembersQuery.isLoading ? "团队成员加载中..." : "暂无可添加团队成员"}
            searchPlaceholder="按名字或邮箱筛选"
            searchable
            disabled={!canManageProject}
          />
          <Select
            value={memberRole}
            disabled={!canManageProject}
            onChange={(value) => setMemberRole(value as typeof memberRole)}
            options={[
              { value: "ADMIN", label: "ADMIN" },
              { value: "EDITOR", label: "EDITOR" },
              { value: "VIEWER", label: "VIEWER" }
            ]}
          />
          <button
            type="submit"
            disabled={!canManageProject || addMemberMutation.isPending || !selectedTeamMemberId}
          >
            添加
          </button>
        </form>
        {!canManageProject ? <span className="muted">只有项目 ADMIN、团队 ADMIN 或系统管理员可以管理项目成员。</span> : null}
        <span className="muted">项目成员必须来自团队成员；如果找不到成员，请先在团队页面通过邮箱添加团队成员。</span>
        <MutationError error={addMemberMutation.error} />
      </section>
      <section className="panel">
        <h2>项目成员</h2>
        <MutationError error={updateRoleMutation.error ?? removeMemberMutation.error} />
        <div className="list settings-scroll-list">
          {(membersQuery.data ?? []).map((member) => {
            const memberUser = getMemberUser(member);

            return (
              <div className="member-row member-person-row" key={member.id}>
                <UserAvatar user={memberUser} size="md" />
                <div className="member-info">
                  <strong>{getMemberName(member)}</strong>
                  <span>{member.status === "PENDING" ? "待认领成员" : member.email}</span>
                  {member.status === "PENDING" && member.inviteAcceptPath ? (
                    <CopyableInviteLink url={getAcceptUrl(member.inviteAcceptPath)} />
                  ) : null}
                </div>
                <Select
                  value={member.role}
                  disabled={!canManageProject || updateRoleMutation.isPending}
                  onChange={(value) =>
                    updateRoleMutation.mutate({
                      memberId: member.id,
                      role: value as "ADMIN" | "EDITOR" | "VIEWER"
                    })
                  }
                  options={[
                    { value: "ADMIN", label: "ADMIN" },
                    { value: "EDITOR", label: "EDITOR" },
                    { value: "VIEWER", label: "VIEWER" }
                  ]}
                />
                <button
                  className="danger-button"
                  type="button"
                  disabled={!canManageProject || removeMemberMutation.isPending}
                  onClick={() => {
                    if (window.confirm(`确认移除 ${getMemberName(member)}？任务中的历史负责人会保留为“已移除”。`)) {
                      removeMemberMutation.mutate(member.id);
                    }
                  }}
                >
                  移除
                </button>
              </div>
            );
          })}
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
            <Select
              className="project-filter-select"
              aria-label="飞书投递状态筛选"
              value={feishuDeliveryStatusFilter}
              onChange={(value) => setFeishuDeliveryStatusFilter(value as typeof feishuDeliveryStatusFilter)}
              options={feishuDeliveryStatusFilters.map((filter) => ({ value: filter.value, label: filter.label }))}
            />
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
              <Select
                value={feishuClearStatus}
                onChange={(value) => setFeishuClearStatus(value as FeishuDeliveryClearStatus)}
                options={feishuDeliveryClearStatusOptions.map((option) => ({
                  value: option.value,
                  label: option.label
                }))}
              />
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
