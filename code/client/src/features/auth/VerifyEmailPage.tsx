import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { authApi, getApiErrorMessage } from "../../lib/api";
import { useAuthStore } from "../../stores/authStore";

const emailVerificationEventKey = "tower.emailVerificationEvent";
const emailVerificationChannelName = "tower.emailVerification";

function notifyEmailVerificationChanged(userId?: string) {
  const payload = JSON.stringify({
    userId: userId ?? null,
    verifiedAt: new Date().toISOString()
  });

  try {
    localStorage.setItem(emailVerificationEventKey, payload);
  } catch {
    // Cross-tab refresh is best effort; the verification itself has already succeeded.
  }

  try {
    const channel = new BroadcastChannel(emailVerificationChannelName);
    channel.postMessage(payload);
    channel.close();
  } catch {
    // Older browsers may not support BroadcastChannel.
  }
}

export function VerifyEmailPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const token = useMemo(() => searchParams.get("token") ?? "", [searchParams]);
  const updateUser = useAuthStore((state) => state.updateUser);
  const requestIdRef = useRef(0);
  const [status, setStatus] = useState<"pending" | "success" | "error">("pending");
  const [message, setMessage] = useState("正在验证邮箱...");
  const [redirectPath, setRedirectPath] = useState("/login");
  const [shouldAutoRedirect, setShouldAutoRedirect] = useState(false);

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    async function verify() {
      if (!token) {
        setStatus("error");
        setMessage("邮箱验证链接无效，请重新获取。");
        return;
      }

      setStatus("pending");
      setMessage("正在验证邮箱...");

      try {
        const result = await authApi.confirmEmailVerification({ token });

        if (requestIdRef.current !== requestId) {
          return;
        }

        const currentSession = useAuthStore.getState();
        const currentUser = currentSession.user;
        const hasSession = Boolean(currentSession.accessToken && currentSession.refreshToken);
        let nextRedirectPath = "/login";
        let nextShouldAutoRedirect = false;

        if (result.user && currentUser?.id === result.user.id) {
          updateUser({
            ...currentUser,
            ...result.user,
            pendingEmail: result.type === "EMAIL_CHANGE" ? null : currentUser.pendingEmail
          });
        }

        if (hasSession) {
          try {
            const freshUser = await authApi.me();
            updateUser(freshUser);
            queryClient.setQueryData(["me"], freshUser);
            nextRedirectPath = "/dashboard";
            nextShouldAutoRedirect = true;
          } catch {
            nextRedirectPath = "/login";
            nextShouldAutoRedirect = false;
          }
        }

        notifyEmailVerificationChanged(result.user?.id ?? currentUser?.id);

        queryClient.removeQueries({ queryKey: ["teams"] });
        queryClient.removeQueries({ queryKey: ["projects"] });
        queryClient.removeQueries({ queryKey: ["my-tasks"] });
        queryClient.removeQueries({ queryKey: ["team-members"] });
        queryClient.removeQueries({ queryKey: ["project-members"] });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["me"] }),
          queryClient.invalidateQueries({ queryKey: ["teams"] }),
          queryClient.invalidateQueries({ queryKey: ["projects"] }),
          queryClient.invalidateQueries({ queryKey: ["my-tasks"] }),
          queryClient.invalidateQueries({ queryKey: ["notifications"] })
        ]);

        setRedirectPath(nextRedirectPath);
        setShouldAutoRedirect(nextShouldAutoRedirect);
        setStatus("success");
        setMessage(
          result.type === "EMAIL_CHANGE"
            ? nextShouldAutoRedirect
              ? "邮箱已更新并验证，即将返回工作台。"
              : "邮箱已更新并验证，请回到已登录页面继续使用。"
            : nextShouldAutoRedirect
              ? "邮箱验证成功，即将返回工作台。"
              : "邮箱验证成功，请回到已登录页面继续使用。"
        );
      } catch (requestError) {
        if (requestIdRef.current !== requestId) {
          return;
        }

        setStatus("error");
        setMessage(getApiErrorMessage(requestError, "邮箱验证失败，请重新获取链接。"));
      }
    }

    void verify();
  }, [queryClient, token, updateUser]);

  useEffect(() => {
    if (status !== "success" || !shouldAutoRedirect) {
      return;
    }

    const timer = window.setTimeout(() => {
      navigate(redirectPath, { replace: true });
    }, 1600);

    return () => window.clearTimeout(timer);
  }, [navigate, redirectPath, shouldAutoRedirect, status]);

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <h1>邮箱验证</h1>
        <p>
          {status === "pending"
            ? "请稍候，系统正在确认验证链接。"
            : status === "success"
              ? "验证已完成。"
              : "验证没有完成。"}
        </p>
        {status === "pending" ? <div className="form-info">{message}</div> : null}
        {status === "success" ? <div className="form-success">{message}</div> : null}
        {status === "error" ? <div className="form-error">{message}</div> : null}
        <Link className="text-link" to={status === "success" ? redirectPath : "/login"}>
          {status === "success" ? (shouldAutoRedirect ? "立即返回工作台" : "前往登录页") : "返回登录"}
        </Link>
      </section>
    </main>
  );
}
