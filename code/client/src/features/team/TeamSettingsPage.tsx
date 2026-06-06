import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { useParams } from "react-router-dom";
import { MutationError } from "../../components/shared/MutationError";
import { teamApi } from "../../lib/api";

export function TeamSettingsPage() {
  const { teamId } = useParams();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"OWNER" | "ADMIN" | "MEMBER">("MEMBER");

  const membersQuery = useQuery({
    queryKey: ["team-members", teamId],
    queryFn: () => teamApi.members(teamId!),
    enabled: Boolean(teamId)
  });

  const addMemberMutation = useMutation({
    mutationFn: () => teamApi.addMember(teamId!, { email, role }),
    onSuccess: () => {
      setEmail("");
      setRole("MEMBER");
      void queryClient.invalidateQueries({ queryKey: ["team-members", teamId] });
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

  function handleAddMember(event: FormEvent) {
    event.preventDefault();
    addMemberMutation.mutate();
  }

  return (
    <div className="page">
      <div className="page-heading">
        <h1>团队设置</h1>
        <p>添加已有账号到团队，并管理团队角色。</p>
      </div>
      <section className="panel">
        <h2>添加成员</h2>
        <form className="settings-form inline" onSubmit={handleAddMember}>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="成员邮箱"
            required
          />
          <select value={role} onChange={(event) => setRole(event.target.value as typeof role)}>
            <option value="MEMBER">MEMBER</option>
            <option value="ADMIN">ADMIN</option>
            <option value="OWNER">OWNER</option>
          </select>
          <button type="submit" disabled={addMemberMutation.isPending}>添加</button>
        </form>
        <MutationError error={addMemberMutation.error} />
      </section>
      <section className="panel">
        <h2>成员</h2>
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
                onClick={() => removeMemberMutation.mutate(member.user.id)}
              >
                移除
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
