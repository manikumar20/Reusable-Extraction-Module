import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { initialsOf } from "./auth/session";

export const ProfilePage = () => {
  const { user, ready, updateProfile, logout } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [organization, setOrganization] = useState(user?.organization ?? "");
  const [role, setRole] = useState(user?.role ?? "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = "Profile · ExtractIQ";
  }, []);

  useEffect(() => {
    if (!user) return;
    setName(user.name);
    setEmail(user.email);
    setOrganization(user.organization);
    setRole(user.role);
  }, [user]);

  if (!ready) return null;
  if (!user) return <Navigate to="/login" replace />;

  const onSave = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSaved(false);
    if (!name.trim() || !email.trim()) {
      setError("Name and email are required.");
      return;
    }
    setBusy(true);
    try {
      await updateProfile({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        organization: organization.trim() || "ExtractIQ",
        role: role.trim() || "Document reviewer",
      });
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save profile.");
    } finally {
      setBusy(false);
    }
  };

  const onSignOut = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <section className="profile-page">
      <header className="profile-hero">
        <div className="profile-avatar" aria-hidden="true">
          {initialsOf(name || user.name)}
        </div>
        <div className="profile-hero-copy">
          <p className="profile-kicker">Account</p>
          <h1>{name || user.name}</h1>
          <p>{email || user.email}</p>
        </div>
      </header>

      <form className="profile-card" onSubmit={onSave}>
        <div className="profile-card-head">
          <h2>Profile details</h2>
          <p>Update how you appear across ExtractIQ.</p>
        </div>

        <div className="profile-grid">
          <label className="auth-field">
            <span>Full name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="auth-field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="auth-field">
            <span>Organization</span>
            <input
              value={organization}
              onChange={(event) => setOrganization(event.target.value)}
            />
          </label>
          <label className="auth-field">
            <span>Role</span>
            <input value={role} onChange={(event) => setRole(event.target.value)} />
          </label>
        </div>

        {error ? (
          <p className="error-text" role="alert">
            {error}
          </p>
        ) : null}
        {saved ? <p className="profile-saved">Profile saved.</p> : null}

        <div className="profile-actions">
          <button type="submit" className="app-btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Save profile"}
          </button>
          <button type="button" className="app-btn-ghost" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </form>
    </section>
  );
};
