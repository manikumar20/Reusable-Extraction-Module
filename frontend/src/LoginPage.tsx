import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "./auth/api";
import { useAuth } from "./auth/AuthContext";

export const LoginPage = () => {
  const { user, ready, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const from = (location.state as { from?: string } | null)?.from ?? "/";

  useEffect(() => {
    document.title = "Sign in · ExtractIQ";
  }, []);

  if (!ready) return null;
  if (user) return <Navigate to="/" replace />;

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      const next = from && from !== "/login" ? from : "/";
      navigate(next, { replace: true });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : "Unable to sign in. Please try again.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-card" aria-label="Sign in">
        <header className="auth-card-header">
          <p className="auth-eyebrow">ExtractIQ</p>
          <h1>Sign in</h1>
          <p className="auth-card-desc">Enter your email and password to continue.</p>
        </header>

        <form className="auth-form" onSubmit={(event) => void onSubmit(event)}>
          {error ? (
            <p className="auth-error" role="alert">
              {error}
            </p>
          ) : null}

          <label className="auth-field">
            <span>Email</span>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>

          <label className="auth-field">
            <span>Password</span>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>

          <button type="submit" className="app-btn-primary auth-submit" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
};
