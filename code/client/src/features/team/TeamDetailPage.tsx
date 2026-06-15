import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ActivityLogPanel } from "../../components/shared/ActivityLogPanel";
import { CopyableInviteLink } from "../../components/shared/CopyableInviteLink";
import { MutationError } from "../../components/shared/MutationError";
import { Select } from "../../components/shared/Select";
import { UserAvatar } from "../../components/shared/UserAvatar";
import { activityApi, getApiErrorMessage, projectApi, teamApi } from "../../lib/api";
import { formatCalendarDate } from "../../lib/dateTime";
import { getAcceptUrl } from "../../lib/invitations";
import { getMemberName, getMemberUser, isVerifiedSystemAdmin } from "../../lib/members";
import { useModalScrollLock } from "../../lib/modalScrollLock";
import { useAuthStore } from "../../stores/authStore";

type TeamMemberImportRow = {
  email: string;
  lineNumber: number;
  role: "ADMIN" | "MEMBER";
};

function formatDeletedBy(user: { name: string; email: string } | null) {
  return user ? `${user.name} / ${user.email}` : "未知成员";
}

function splitCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const nextCharacter = line[index + 1];

    if (character === "\"" && inQuotes && nextCharacter === "\"") {
      current += "\"";
      index += 1;
      continue;
    }

    if (character === "\"") {
      inQuotes = !inQuotes;
      continue;
    }

    if (character === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += character;
  }

  values.push(current.trim());
  return values;
}

function normalizeImportRole(value: string, lineNumber: number): "ADMIN" | "MEMBER" {
  const role = value.trim().toLowerCase();

  if (["1", "admin", "管理员", "team_admin"].includes(role)) {
    return "ADMIN";
  }

  if (["2", "member", "成员", "team_member"].includes(role)) {
    return "MEMBER";
  }

  throw new Error(`第 ${lineNumber} 行权限无效，请填写 ADMIN / MEMBER，或 1 / 2。`);
}

function parseTeamMemberCsv(text: string): TeamMemberImportRow[] {
  const rows = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const members: TeamMemberImportRow[] = [];
  const seenEmails = new Set<string>();

  rows.forEach((line, index) => {
    const lineNumber = index + 1;

    if (!line.trim()) {
      return;
    }

    const [emailValue = "", roleValue = ""] = splitCsvLine(line);
    const email = emailValue.trim().toLowerCase();

    if (lineNumber === 1 && ["email", "邮箱"].includes(email)) {
      return;
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error(`第 ${lineNumber} 行邮箱格式不正确。`);
    }

    if (!roleValue.trim()) {
      throw new Error(`第 ${lineNumber} 行缺少权限，请填写 ADMIN / MEMBER，或 1 / 2。`);
    }

    if (seenEmails.has(email)) {
      throw new Error(`第 ${lineNumber} 行邮箱重复：${email}`);
    }

    seenEmails.add(email);
    members.push({
      email,
      lineNumber,
      role: normalizeImportRole(roleValue, lineNumber)
    });
  });

  if (members.length === 0) {
    throw new Error("CSV 中没有可导入的成员。");
  }

  return members;
}

export function TeamDetailPage() {
  const { teamId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const [teamName, setTeamName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [isBatchImportOpen, setIsBatchImportOpen] = useState(false);
  const [batchImportRows, setBatchImportRows] = useState<TeamMemberImportRow[]>([]);
  const [batchImportError, setBatchImportError] = useState("");
  const [batchImportMessage, setBatchImportMessage] = useState("");
  const [isProjectTrashOpen, setIsProjectTrashOpen] = useState(false);
  const [teamSaveMessage, setTeamSaveMessage] = useState("");
  const isSystemAdmin = isVerifiedSystemAdmin(user);

  useModalScrollLock(isBatchImportOpen || isProjectTrashOpen);

  const membersQuery = useQuery({
    queryKey: ["team-members", teamId],
    queryFn: () => teamApi.members(teamId!),
    enabled: Boolean(teamId)
  });
  const teamsQuery = useQuery({
    queryKey: ["teams"],
    queryFn: teamApi.list
  });
  const currentMember = (membersQuery.data ?? []).find((member) => member.user?.id === user?.id);
  const canManageTeam = isSystemAdmin || currentMember?.role === "ADMIN";
  const team = (teamsQuery.data ?? []).find((item) => item.id === teamId);
  const normalizedTeamName = teamName.trim();
  const isTeamNameDirty = Boolean(team && normalizedTeamName !== team.name);

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
  const batchImportMutation = useMutation({
    mutationFn: (rows: TeamMemberImportRow[]) => teamApi.batchImportMembers(teamId!, { members: rows }),
    onSuccess: (result) => {
      setBatchImportMessage(`已导入 ${result.importedCount} 个成员`);
      setBatchImportRows([]);
      void queryClient.invalidateQueries({ queryKey: ["team-members", teamId] });
      void queryClient.invalidateQueries({ queryKey: ["team-activity", teamId] });
    },
    onError: (error) => {
      setBatchImportError(getApiErrorMessage(error, "批量导入失败，请检查 CSV 内容。"));
    },
    onSettled: () => {
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

  const updateRoleMutation = useMutation({
    mutationFn: (input: { memberId: string; role: "ADMIN" | "MEMBER" }) =>
      teamApi.updateMemberRole(teamId!, input.memberId, input.role),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["team-members", teamId] });
      void queryClient.invalidateQueries({ queryKey: ["team-activity", teamId] });
    }
  });

  const removeMemberMutation = useMutation({
    mutationFn: (memberId: string) => teamApi.removeMember(teamId!, memberId),
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

  async function handleBatchImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    setBatchImportRows([]);
    setBatchImportError("");
    setBatchImportMessage("");
    batchImportMutation.reset();

    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      setBatchImportRows(parseTeamMemberCsv(text));
    } catch (error) {
      setBatchImportError(error instanceof Error ? error.message : "CSV 解析失败，请检查文件内容。");
    } finally {
      event.target.value = "";
    }
  }

  function handleBatchImport(event: FormEvent) {
    event.preventDefault();

    if (!canManageTeam || batchImportRows.length === 0) {
      return;
    }

    batchImportMutation.mutate(batchImportRows);
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
        <p>查看团队信息、成员和项目；有权限时可管理成员、注册链接和审计日志。</p>
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
      </section>
      <section className="panel">
        <div className="panel-title-row">
          <h2>团队项目</h2>
          {canManageTeam ? (
            <button
              className="project-trash-button"
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
                <span>{project.status === "ARCHIVED" ? "已归档" : "进行中"}</span>
              </div>
              <Link className="mini-link" to={`/projects/${project.id}/board`}>
                看板
              </Link>
            </div>
          ))}
          {!projectsQuery.isLoading && (projectsQuery.data ?? []).length === 0 ? (
            <span className="muted">暂无项目</span>
          ) : null}
        </div>
      </section>
      {canManageTeam ? (
        <section className="panel">
          <h2>添加成员</h2>
          <form className="settings-form team-member-add-form" onSubmit={handleAddMember}>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="成员邮箱"
              required
            />
            <Select
              value={role}
              onChange={(value) => setRole(value as typeof role)}
              options={[
                { value: "MEMBER", label: "MEMBER" },
                { value: "ADMIN", label: "ADMIN" }
              ]}
            />
            <button
              className="mini-button"
              type="button"
              onClick={() => {
                setBatchImportRows([]);
                setBatchImportError("");
                setBatchImportMessage("");
                batchImportMutation.reset();
                setIsBatchImportOpen(true);
              }}
            >
              批量导入
            </button>
            <button type="submit" disabled={addMemberMutation.isPending}>添加</button>
          </form>
          <span className="muted">邮箱未注册时会显示为未注册成员，可先分配项目和任务。</span>
          <MutationError error={addMemberMutation.error} />
        </section>
      ) : null}
      <section className="panel">
        <h2>成员</h2>
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
                {canManageTeam ? (
                  <Select
                    value={member.role}
                    disabled={updateRoleMutation.isPending}
                    onChange={(value) =>
                      updateRoleMutation.mutate({
                        memberId: member.id,
                        role: value as "ADMIN" | "MEMBER"
                      })
                    }
                    options={[
                      { value: "ADMIN", label: "ADMIN" },
                      { value: "MEMBER", label: "MEMBER" }
                    ]}
                  />
                ) : (
                  <span className="role-pill">{member.role}</span>
                )}
                {canManageTeam ? (
                  <button
                    className="danger-button"
                    type="button"
                    disabled={removeMemberMutation.isPending}
                    onClick={() => {
                      if (window.confirm(`确认移除 ${getMemberName(member)}？`)) {
                        removeMemberMutation.mutate(member.id);
                      }
                    }}
                  >
                    移除
                  </button>
                ) : null}
              </div>
            );
          })}
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
      {isBatchImportOpen && canManageTeam ? (
        <div className="modal-backdrop">
          <section className="modal" aria-label="批量导入团队成员">
            <header className="modal-header">
              <div>
                <h2>批量导入团队成员</h2>
                <p>上传 CSV 文件，第一列为邮箱，第二列为权限。</p>
              </div>
              <button className="modal-close-button" type="button" onClick={() => setIsBatchImportOpen(false)}>
                ×
              </button>
            </header>
            <form className="modal-form" onSubmit={handleBatchImport}>
              <label>
                CSV 文件
                <input type="file" accept=".csv,text/csv" onChange={handleBatchImportFile} />
              </label>
              <div className="import-help">
                <span>示例：email,role</span>
                <span>alice@example.com,ADMIN</span>
                <span>bob@example.com,2</span>
                <span>权限支持：ADMIN / MEMBER，或 1=ADMIN、2=MEMBER。</span>
              </div>
              {batchImportRows.length > 0 ? (
                <div className="list import-preview-list">
                  {batchImportRows.map((row) => (
                    <div className="import-preview-row" key={`${row.lineNumber}-${row.email}`}>
                      <span>{row.email}</span>
                      <strong>{row.role}</strong>
                    </div>
                  ))}
                </div>
              ) : null}
              {batchImportError ? <div className="form-error">{batchImportError}</div> : null}
              {batchImportMessage ? <span className="form-success">{batchImportMessage}</span> : null}
              <div className="modal-action-row">
                <button
                  className="danger-button"
                  type="button"
                  disabled={batchImportMutation.isPending}
                  onClick={() => setIsBatchImportOpen(false)}
                >
                  取消
                </button>
                <button type="submit" disabled={batchImportMutation.isPending || batchImportRows.length === 0}>
                  {batchImportMutation.isPending ? "导入中..." : "开始导入"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
