import { UserRound } from "lucide-react";

type AvatarUser = {
  name: string;
  avatarUrl: string | null;
};

type UserAvatarProps = {
  user: AvatarUser | null | undefined;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
};

export function UserAvatar({ user, size = "sm" }: UserAvatarProps) {
  return (
    <span className={`user-avatar user-avatar-${size}`} aria-hidden="true">
      {user?.avatarUrl ? (
        <img src={user.avatarUrl} alt="" />
      ) : (
        <UserRound size={size === "xs" ? 12 : size === "sm" ? 14 : size === "md" ? 18 : size === "lg" ? 22 : 28} />
      )}
    </span>
  );
}
