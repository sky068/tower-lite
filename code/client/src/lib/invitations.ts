import type { Invitation } from "../types/api";

export function getInvitationStatusLabel(status: Invitation["status"]) {
  const labels: Record<Invitation["status"], string> = {
    PENDING: "待接受",
    ACCEPTED: "已接受",
    EXPIRED: "已过期",
    REVOKED: "已撤销"
  };

  return labels[status];
}

export function getAcceptUrl(acceptPath: string) {
  return `${window.location.origin}${acceptPath}`;
}
