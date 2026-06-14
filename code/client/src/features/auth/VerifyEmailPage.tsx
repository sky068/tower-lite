import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { authApi, getApiErrorMessage } from "../../lib/api";
import { useAuthStore } from "../../stores/authStore";

export function VerifyEmailPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = useMemo(() => searchParams.get("token") ?? "", [searchParams]);
  const updateUser = useAuthStore((state) => state.updateUser);
  const requestIdRef = useRef(0);
  const [status, setStatus] = useState<"pending" | "success" | "error">("pending");
  const [message, setMessage] = useState("正在验证邮箱...");
  const [redirectPath, setRedirectPath] = useState("/login");

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

        const currentUser = useAuthStore.getState().user;
        const nextRedirectPath = currentUser ? "/dashboard" : "/login";

        if (result.user && currentUser?.id === result.user.id) {
          updateUser({ ...currentUser, ...result.user });
        }

        setRedirectPath(nextRedirectPath);
        setStatus("success");
        setMessage(
          result.type === "EMAIL_CHANGE"
            ? "邮箱已更新并验证，即将返回。"
            : "邮箱验证成功，即将返回。"
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
  }, [token, updateUser]);

  useEffect(() => {
    if (status !== "success") {
      return;
    }

    const timer = window.setTimeout(() => {
      navigate(redirectPath, { replace: true });
    }, 1600);

    return () => window.clearTimeout(timer);
  }, [navigate, redirectPath, status]);

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
          {status === "success" ? "立即返回" : "返回登录"}
        </Link>
      </section>
    </main>
  );
}
