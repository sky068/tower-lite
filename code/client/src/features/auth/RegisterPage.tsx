import { FormEvent, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, type Location } from "react-router-dom";
import { authApi, getApiErrorMessage } from "../../lib/api";
import { useAuthStore } from "../../stores/authStore";

type AuthRedirectState = {
  from?: Location;
};

export function RegisterPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { accessToken, setSession } = useAuthStore();
  const [name, setName] = useState("");
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
      const session = await authApi.register({ name, email, password });
      setSession(session);
      navigate(redirectTo, { replace: true });
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "注册失败，请检查邮箱是否已被使用"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <h1>创建账号</h1>
        <p>先用邮箱账号进入 V0，飞书登录后续接入。</p>
        <form className="form" onSubmit={handleSubmit}>
          <label>
            姓名
            <input
              type="text"
              placeholder="你的名字"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </label>
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
              placeholder="至少 8 位"
              value={password}
              minLength={8}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {error ? <div className="form-error">{error}</div> : null}
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "注册中..." : "注册"}
          </button>
          <Link className="text-link" to="/login" state={location.state}>
            已有账号？登录
          </Link>
        </form>
      </section>
    </main>
  );
}
