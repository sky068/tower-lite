import { useQuery } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { authApi } from "../../lib/api";
import { useAuthStore } from "../../stores/authStore";

export function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  const accessToken = useAuthStore((state) => state.accessToken);
  const setSession = useAuthStore((state) => state.setSession);
  const refreshToken = useAuthStore((state) => state.refreshToken);
  const clearSession = useAuthStore((state) => state.clearSession);

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: authApi.me,
    enabled: Boolean(accessToken),
    retry: false
  });

  useEffect(() => {
    if (meQuery.data && accessToken && refreshToken) {
      setSession({
        accessToken,
        refreshToken,
        user: meQuery.data
      });
    }
  }, [accessToken, meQuery.data, refreshToken, setSession]);

  useEffect(() => {
    if (meQuery.isError) {
      clearSession();
    }
  }, [clearSession, meQuery.isError]);

  if (!accessToken) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (meQuery.isLoading) {
    return <div className="route-loading">正在恢复登录状态...</div>;
  }

  return children;
}
