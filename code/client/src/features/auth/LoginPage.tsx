import { FormEvent, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, type Location } from "react-router-dom";
import { authApi, getApiErrorMessage } from "../../lib/api";
import { useAuthStore } from "../../stores/authStore";

type AuthRedirectState = {
  from?: Location;
};

function getPostAuthRedirect(location: Location) {
  const redirectLocation = (location.state as AuthRedirectState | null)?.from;

  if (redirectLocation?.pathname === "/invitations/accept") {
    return `${redirectLocation.pathname}${redirectLocation.search}${redirectLocation.hash}`;
  }

  return "/dashboard";
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { accessToken, setSession } = useAuthStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFeishuSubmitting, setIsFeishuSubmitting] = useState(false);

  const redirectTo = getPostAuthRedirect(location);

  if (accessToken) {
    return <Navigate to={redirectTo} replace />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const session = await authApi.login({ email, password });
      setSession(session);
      navigate(redirectTo, { replace: true });
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "邮箱或密码不正确"));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleFeishuLogin() {
    setError(null);
    setIsFeishuSubmitting(true);

    try {
      const result = await authApi.feishuAuthorizeUrl({ redirectTo });

      if (!result.configured || !result.authorizeUrl) {
        setError("飞书登录尚未配置，请先在后端环境变量中配置 FEISHU_APP_ID 和 FEISHU_APP_SECRET。");
        return;
      }

      window.location.assign(result.authorizeUrl);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "飞书登录启动失败，请稍后再试。"));
    } finally {
      setIsFeishuSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <h1>Tower Lite</h1>
        <p>登录后进入你的团队任务空间。</p>
        <form className="form" onSubmit={handleSubmit}>
          <label>
            邮箱
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            密码
            <input
              type="password"
              placeholder="请输入密码"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {error ? <div className="form-error">{error}</div> : null}
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "登录中..." : "登录"}
          </button>
          <button
            className="feishu-login-button"
            type="button"
            disabled={isFeishuSubmitting}
            onClick={() => void handleFeishuLogin()}
          >
            {isFeishuSubmitting ? "正在打开飞书..." : "使用飞书登录"}
          </button>
          <Link className="text-link" to="/register" state={location.state}>
            还没有账号？注册
          </Link>
        </form>
      </section>
    </main>
  );
}
