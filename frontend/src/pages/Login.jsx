import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Headphones,
  LockKeyhole,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const navigate = useNavigate();
  const { login, loading } = useAuth();

  const [formData, setFormData] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  function handleChange(event) {
    const { name, value } = event.target;
    setFormData((previous) => ({ ...previous, [name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    try {
      await login({
        email: formData.email.trim(),
        password: formData.password,
      });
      navigate("/", { replace: true });
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "We couldn't verify those details. Check your email and password, then try again."
      );
    }
  }

  return (
    <main className="auth-login-page">
      <section className="auth-login-brand-panel" aria-label="ResolveIT introduction">
        <Link to="/login" className="auth-login-brand" aria-label="ResolveIT home">
          <span className="auth-login-brand-mark"><Headphones size={27} strokeWidth={2.2} /></span>
          <span className="auth-login-brand-name">
            ResolveIT
            <small>IT SERVICE DESK</small>
          </span>
        </Link>

        <div className="auth-login-story">
          <div className="auth-login-eyebrow">IT operations, in control</div>
          <h1>Less disruption.<br /><span>More resolution.</span></h1>
          <p>
            One focused workspace for support requests, service ownership, and
            the people who keep work moving.
          </p>
          <div className="auth-login-visual" aria-hidden="true">
            <span className="auth-login-orbit orbit-one" />
            <span className="auth-login-orbit orbit-two" />
            <span className="auth-login-orbit orbit-three" />
            <span className="auth-login-core"><Activity size={43} strokeWidth={1.5} /></span>
            <i className="auth-login-node node-one" />
            <i className="auth-login-node node-two" />
            <i className="auth-login-node node-three" />
          </div>
        </div>

        <div className="auth-login-proof">
          <span><CheckCircle2 size={15} /> Clear ticket ownership</span>
          <span><ShieldCheck size={15} /> Role-based access</span>
        </div>
      </section>

      <section className="auth-login-form-panel" aria-label="Sign in">
        <div className="auth-login-form-wrap">
          <div className="auth-login-mobile-brand">
            <span className="auth-login-brand-mark"><Headphones size={23} /></span>
            <span>ResolveIT<small>IT SERVICE DESK</small></span>
          </div>

          <header className="auth-login-heading">
            <p className="auth-login-kicker">WELCOME BACK</p>
            <h2>Sign in to ResolveIT</h2>
            <p>Enter your account details to access your support workspace.</p>
          </header>

          {error && (
            <div className="auth-login-error" role="alert">
              <ShieldCheck size={17} />
              <span>{error}</span>
            </div>
          )}

          <form className="auth-login-form" onSubmit={handleSubmit}>
            <div className="auth-login-field">
              <label htmlFor="email">Work email</label>
              <div className="auth-login-input-wrap">
                <Mail className="auth-login-input-icon" size={18} />
                <input
                  id="email"
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  placeholder="you@company.com"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck="false"
                  required
                />
              </div>
            </div>

            <div className="auth-login-field">
              <label htmlFor="password">Password</label>
              <div className="auth-login-input-wrap">
                <LockKeyhole className="auth-login-input-icon" size={18} />
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  className="auth-login-password-toggle"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button type="submit" className="auth-login-submit" disabled={loading}>
              {loading ? "Signing you in..." : "Sign in securely"}
              {!loading && <ArrowRight size={17} />}
            </button>
          </form>

          <div className="auth-login-divider">NEW TO RESOLVEIT?</div>
          <p className="auth-login-register">
            Need an account? <Link to="/register">Create one <ArrowRight size={13} /></Link>
          </p>
          <div className="auth-login-security">
            <ShieldCheck size={14} /> Your session is protected with secure authentication
          </div>
        </div>
      </section>
    </main>
  );
}
