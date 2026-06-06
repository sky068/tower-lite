export const API_PREFIX = "/api/v1";

export type ApiResponse<T> = {
  data: T;
  requestId: string;
};

export type ApiErrorResponse = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId: string;
};

export type ProjectRole = "OWNER" | "EDITOR" | "VIEWER";
export type TeamRole = "OWNER" | "ADMIN" | "MEMBER";
export type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
