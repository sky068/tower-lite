import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { authApi, getApiErrorMessage } from "../../lib/api";
import { useAuthStore } from "../../stores/authStore";

export function FeishuCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { accessToken, setSession } = useAuthStore();
  const [error, setError] = useState<string | null>(null);
  const [isHandling, setIsHandling] = useState(true);
  const handledCallbackRef = useRef<string | null>(null);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const feishuError = searchParams.get("error");

  useEffect(() => {
    if (accessToken) {
      return;
    }

    const callbackKey = `${code ?? ""}:${state ?? ""}:${feishuError ?? ""}`;
    if (handledCallbackRef.current === callbackKey) {
      return;
    }
    handledCallbackRef.current = callbackKey;

    async function handleCallback() {
      if (feishuError) {
        setError("飞书授权已取消或失败。");
        setIsHandling(false);
        return;
      }

      if (!code || !state) {
        setError("飞书登录回调参数不完整，请重新发起登录。");
        setIsHandling(false);
        return;
      }

      try {
        const session = await authApi.feishuCallback({ code, state });
        setSession(session);
        navigate(session.redirectTo || "/dashboard", { replace: true });
      } catch (requestError) {
        setError(getApiErrorMessage(requestError, "飞书登录失败，请稍后再试。"));
        setIsHandling(false);
      }
    }

    void handleCallback();
  }, [accessToken, code, feishuError, navigate, setSession, state]);

  if (accessToken) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <h1>飞书登录</h1>
        {isHandling ? <p>正在完成飞书登录...</p> : <p>没有完成登录，请返回后重试。</p>}
        {error ? <div className="form-error">{error}</div> : null}
        {!isHandling ? (
          <Link className="text-link" to="/login">
            返回登录
          </Link>
        ) : null}
      </section>
    </main>
  );
}
