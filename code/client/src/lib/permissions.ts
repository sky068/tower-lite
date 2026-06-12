import type { Member, ProjectRole, TeamRole } from "../types/api";

type ProjectPermissions = {
  currentProjectMember: Member | undefined;
  currentTeamMember: Member | undefined;
  isTeamAdmin: boolean;
  canEditProject: boolean;
  canManageProject: boolean;
};

const projectEditorRoles = new Set<ProjectRole>(["ADMIN", "EDITOR"]);
const teamAdminRoles = new Set<TeamRole>(["ADMIN"]);

export function getProjectPermissions(
  userId: string | null | undefined,
  projectMembers: Member[] = [],
  teamMembers: Member[] = [],
  isSystemAdmin = false
): ProjectPermissions {
  const currentProjectMember = projectMembers.find((member) => member.user?.id === userId);
  const currentTeamMember = teamMembers.find((member) => member.user?.id === userId);
  const isTeamAdmin = teamAdminRoles.has(currentTeamMember?.role as TeamRole);
  const isProjectEditor = projectEditorRoles.has(currentProjectMember?.role as ProjectRole);

  return {
    currentProjectMember,
    currentTeamMember,
    isTeamAdmin,
    canEditProject: isSystemAdmin || isTeamAdmin || isProjectEditor,
    canManageProject: isSystemAdmin || isTeamAdmin || currentProjectMember?.role === "ADMIN"
  };
}
