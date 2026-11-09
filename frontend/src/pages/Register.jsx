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
  UserRound,
} from "lucide-react";
import { registerUser } from "../services/api";

export default function Register() {
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  function handleChange(event) {
    const { name, value } = event.target;
    setFormData((previous) => ({ ...previous, [name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    if (formData.password.length < 8) {
      setError("Your password must contain at least 8 characters.");
      return;
    }

    setLoading(true);

    try {
      await registerUser({
        name: formData.name.trim(),
        email: formData.email.trim(),
        password: formData.password,
      });

      navigate("/login", { replace: true });
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "We couldn't create your account. Please review your details and try again."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-login-page auth-register-page">
      <section className="auth-login-brand-panel" aria-label="ResolveIT introduction">
        <Link to="/login" className="auth-login-brand" aria-label="ResolveIT sign in">
          <span className="auth-login-brand-mark">
            <Headphones size={27} strokeWidth={2.2} />
          </span>
          <span className="auth-login-brand-name">
            ResolveIT
            <small>IT SERVICE DESK</small>
          </span>
        </Link>

        <div className="auth-login-story">
          <div className="auth-login-eyebrow">A better way to get support</div>
          <h1>Get back to<br /><span>what matters.</span></h1>
          <p>
            Create your workspace account to raise support requests, follow
            progress, and stay connected with your IT team.
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
          <span><CheckCircle2 size={15} /> Simple request tracking</span>
          <span><ShieldCheck size={15} /> Secure employee access</span>
        </div>
      </section>

      <section className="auth-login-form-panel" aria-label="Create employee account">
        <div className="auth-login-form-wrap auth-register-form-wrap">
          <div className="auth-login-mobile-brand">
            <span className="auth-login-brand-mark"><Headphones size={23} /></span>
            <span>ResolveIT<small>IT SERVICE DESK</small></span>
          </div>

          <header className="auth-login-heading">
            <p className="auth-login-kicker">JOIN YOUR WORKSPACE</p>
            <h2>Create your account</h2>
            <p>Set up your employee account to start managing IT support requests.</p>
          </header>

          {error && (
            <div className="auth-login-error" role="alert">
              <ShieldCheck size={17} />
              <span>{error}</span>
            </div>
          )}

          <form className="auth-login-form" onSubmit={handleSubmit}>
            <div className="auth-login-field">
              <label htmlFor="name">Full name</label>
              <div className="auth-login-input-wrap">
                <UserRound className="auth-login-input-icon" size={18} />
                <input
                  id="name"
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  placeholder="Enter your full name"
                  autoComplete="name"
                  maxLength={80}
                  required
                />
              </div>
            </div>

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
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck="false"
                  maxLength={254}
                  required
                />
              </div>
            </div>

            <div className="auth-login-field">
              <label htmlFor="password">Create password</label>
              <div className="auth-login-input-wrap">
                <LockKeyhole className="auth-login-input-icon" size={18} />
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  minLength={8}
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
              <small className="auth-register-hint">Use at least 8 characters. Your account will be created with the Employee role.</small>
            </div>

            <button type="submit" className="auth-login-submit" disabled={loading}>
              {loading ? "Creating your account..." : "Create employee account"}
              {!loading && <ArrowRight size={17} />}
            </button>
          </form>

          <div className="auth-login-divider">ALREADY HAVE AN ACCOUNT?</div>
          <p className="auth-login-register">
            Sign in instead <Link to="/login">Go to sign in <ArrowRight size={13} /></Link>
          </p>
          <div className="auth-login-security">
            <ShieldCheck size={14} /> Your details are protected by ResolveIT authentication
          </div>
        </div>
      </section>
    </main>
  );
}
