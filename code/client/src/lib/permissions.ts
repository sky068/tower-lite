import type { Member, ProjectRole, TeamRole } from "../types/api";

type ProjectPermissions = {
  currentProjectMember: Member | undefined;
  currentTeamMember: Member | undefined;
  isTeamAdmin: boolean;
  canEditProject: boolean;
  canManageProject: boolean;
};

const projectEditorRoles = new Set<ProjectRole>(["ADMIN", "EDITOR"]);
const teamAdminRoles = new Set<TeamRole>(["OWNER", "ADMIN"]);

export function getProjectPermissions(
  userId: string | null | undefined,
  projectMembers: Member[] = [],
  teamMembers: Member[] = []
): ProjectPermissions {
  const currentProjectMember = projectMembers.find((member) => member.user.id === userId);
  const currentTeamMember = teamMembers.find((member) => member.user.id === userId);
  const isTeamAdmin = teamAdminRoles.has(currentTeamMember?.role as TeamRole);
  const isProjectEditor = projectEditorRoles.has(currentProjectMember?.role as ProjectRole);

  return {
    currentProjectMember,
    currentTeamMember,
    isTeamAdmin,
    canEditProject: isTeamAdmin || isProjectEditor,
    canManageProject: isTeamAdmin || currentProjectMember?.role === "ADMIN"
  };
}
