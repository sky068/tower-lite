import type { Member, User } from "../types/api";

export function getMemberUser(member: Member): User {
  return member.user ?? {
    id: member.id,
    email: member.email,
    name: `${member.email}（未注册）`,
    avatarUrl: null,
    systemRole: "USER"
  };
}

export function getMemberName(member: Member) {
  return member.user?.name ?? `${member.email}（未注册）`;
}

export function isActiveMember(member: Member) {
  return Boolean(member.user);
}

export function isVerifiedSystemAdmin(user?: User | null) {
  return user?.systemRole === "ADMIN" && Boolean(user.emailVerifiedAt);
}
