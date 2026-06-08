import { FormEvent, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, type Location } from "react-router-dom";
import { authApi, getApiErrorMessage } from "../../lib/api";
import { useAuthStore } from "../../stores/authStore";

type AuthRedirectState = {
  from?: Location;
};

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { accessToken, setSession } = useAuthStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const redirectLocation = (location.state as AuthRedirectState | null)?.from;
  const redirectTo = redirectLocation
    ? `${redirectLocation.pathname}${redirectLocation.search}${redirectLocation.hash}`
    : "/dashboard";

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
          <Link className="text-link" to="/register" state={location.state}>
            还没有账号？注册
          </Link>
        </form>
      </section>
    </main>
  );
}
