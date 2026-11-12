import ThemeToggle from "../components/ThemeToggle";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  ClipboardList,
  Headphones,
  History,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  MessageSquare,
  ShieldCheck,
  Users,
  X,
  Gauge,
  Activity,
  Zap,
  Laptop
} from "lucide-react";

import "../styles/LandingPage.css";

// --------------------------------------------------
// LANDING PAGE DATA
// --------------------------------------------------

const features = [
  {
    icon: ClipboardList,
    title: "Structured ticket management",
    tag: "01 · ORGANIZE",
    text: "Capture incidents and service requests with clear descriptions, departments, priorities, and status."
  },
  {
    icon: Users,
    title: "Clear ticket ownership",
    tag: "02 · COLLABORATE",
    text: "Assign work to the right support engineer and keep responsibility visible through resolution."
  },
  {
    icon: Gauge,
    title: "SLA monitoring",
    tag: "03 · STAY ON TRACK",
    text: "Monitor response and resolution targets, and identify tickets that are at risk or overdue."
  },
  {
    icon: ShieldCheck,
    title: "Role-based access",
    tag: "04 · CONTROL",
    text: "Separate employee, support engineer, and administrator permissions to keep actions appropriate."
  },
  {
    icon: Bell,
    title: "Relevant notifications",
    tag: "05 · STAY INFORMED",
    text: "Keep users informed about ticket creation, assignment, status changes, and resolution."
  },
  {
    icon: History,
    title: "Activity history",
    tag: "06 · ACCOUNTABILITY",
    text: "Review ticket actions and updates in a timeline that makes progress easier to understand."
  }
];

const workflow = [
  {
    icon: MessageSquare,
    title: "Submit an issue",
    text: "Employees create a support request and provide the details the IT team needs."
  },
  {
    icon: Users,
    title: "Assign and respond",
    text: "An administrator assigns the request and a support engineer takes ownership."
  },
  {
    icon: CheckCircle2,
    title: "Track to resolution",
    text: "Follow status updates, monitor deadlines, and see when the request is resolved."
  }
];

const faqs = [
  [
    "Who can use ResolveIT?",
    "ResolveIT is designed for employees who need IT help, support engineers who handle requests, and administrators who manage the workflow."
  ],
  [
    "Can employees see every ticket?",
    "No. Employees can access their own tickets. Support engineers can access tickets assigned to them, while administrators have broader management access."
  ],
  [
    "What does SLA monitoring show?",
    "It tracks response and resolution targets based on ticket priority and helps show whether targets are on track, at risk, breached, or met."
  ],
  [
    "Is the dashboard preview live data?",
    "No. The dashboard is an illustrative product preview. Sign in to access the application and its actual ticket data."
  ]
];

// --------------------------------------------------
// SCROLL REVEAL ANIMATION
// --------------------------------------------------

function useReveal() {
  useEffect(() => {
    const nodes = document.querySelectorAll("[data-reveal]");

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    if (reduced || !("IntersectionObserver" in window)) {
      nodes.forEach((node) => node.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      {
        threshold: 0.14,
        rootMargin: "0px 0px -40px 0px"
      }
    );

    nodes.forEach((node) => observer.observe(node));

    return () => observer.disconnect();
  }, []);
}

// --------------------------------------------------
// 3D TILT EFFECT
// --------------------------------------------------

function useTilt(ref) {
  useEffect(() => {
    const node = ref.current;

    if (
      !node ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !window.matchMedia("(pointer: fine)").matches
    ) {
      return;
    }

    const move = (event) => {
      const rect = node.getBoundingClientRect();

      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;

      node.style.setProperty("--tilt-x", `${(0.5 - y) * 3}deg`);
      node.style.setProperty("--tilt-y", `${(x - 0.5) * 4}deg`);
      node.style.setProperty("--glow-x", `${x * 100}%`);
      node.style.setProperty("--glow-y", `${y * 100}%`);
    };

    const reset = () => {
      node.style.setProperty("--tilt-x", "0deg");
      node.style.setProperty("--tilt-y", "0deg");
      node.style.setProperty("--glow-x", "50%");
      node.style.setProperty("--glow-y", "50%");
    };

    node.addEventListener("pointermove", move);
    node.addEventListener("pointerleave", reset);

    return () => {
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerleave", reset);
    };
  }, [ref]);
}

// --------------------------------------------------
// DASHBOARD PREVIEW
// --------------------------------------------------

function DashboardPreview() {
  const [tab, setTab] = useState("Overview");

  return (
    <div className="lp-dashboard">
      <div className="lp-windowbar">
        <div className="lp-dots">
          <i />
          <i />
          <i />
        </div>

        <div className="lp-address">
          <b /> resolveit.app / workspace
        </div>

        <span className="lp-secure">
          <ShieldCheck size={14} /> Secure
        </span>
      </div>

      <div className="lp-dash-layout">
        <aside className="lp-sidebar">
          <div className="lp-side-brand">
            <Headphones size={17} /> ResolveIT
          </div>

          <small>WORKSPACE</small>

          <div className="lp-side-item selected">
            <LayoutDashboard size={15} /> Dashboard
          </div>

          <div className="lp-side-item">
            <ClipboardList size={15} /> Tickets <i>8</i>
          </div>

          <div className="lp-side-item">
            <Users size={15} /> Team
          </div>

          <div className="lp-side-item">
            <Bell size={15} /> Notifications
          </div>

          <div className="lp-side-user">
            <span>IT</span>
            <div>
              <b>Support team</b>
              <small>Workspace preview</small>
            </div>
          </div>
        </aside>

        <div className="lp-dash-main">
          <div className="lp-dash-title">
            <div>
              <small>WORKSPACE / HOME</small>
              <h3>Support overview</h3>
              <p>Your support operations at a glance.</p>
            </div>
            <span>IT</span>
          </div>

          <div className="lp-tabs" role="tablist">
            {["Overview", "Tickets", "SLA"].map((item) => (
              <button
                key={item}
                role="tab"
                aria-selected={tab === item}
                className={tab === item ? "active" : ""}
                onClick={() => setTab(item)}
              >
                {item}
              </button>
            ))}
          </div>

          {tab === "Overview" && (
            <div className="lp-tab-body" key="overview">
              <div className="lp-metrics">
                {["Total tickets", "In progress", "Resolved"].map((x) => (
                  <div key={x}>
                    <small>{x}</small>
                    <b>—</b>
                    <span>Illustrative preview</span>
                  </div>
                ))}
              </div>

              <div className="lp-panel">
                <header>
                  <b>Recent activity</b>
                  <small>Sample interface</small>
                </header>

                {[
                  ["Ticket assigned", "Support ownership updated", "purple"],
                  ["Status updated", "Request moved forward", "green"],
                  ["New request", "Employee submitted a ticket", "blue"]
                ].map((r) => (
                  <div className="lp-activity" key={r[0]}>
                    <i className={r[2]} />
                    <span>
                      <b>{r[0]}</b>
                      <small>{r[1]}</small>
                    </span>
                    <time>Recent</time>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "Tickets" && (
            <div className="lp-tab-body" key="tickets">
              <div className="lp-panel">
                <header>
                  <b>Recent tickets</b>
                  <small>Sample interface</small>
                </header>

                {[
                  ["TKT-001", "Unable to access email", "High", "In progress"],
                  ["TKT-002", "VPN connection issue", "Medium", "Open"],
                  ["TKT-003", "Software installation", "Low", "Resolved"]
                ].map((r) => (
                  <div className="lp-ticket" key={r[0]}>
                    <span>
                      <b>{r[0]}</b>
                      <small>{r[1]}</small>
                    </span>

                    <i className={`priority-${r[2].toLowerCase()}`}>
                      {r[2]}
                    </i>

                    <small>{r[3]}</small>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "SLA" && (
            <div className="lp-tab-body" key="sla">
              <div className="lp-panel lp-sla-panel">
                <div className="lp-sla-head">
                  <Clock3 />
                  <span>
                    <b>Response and resolution targets</b>
                    <small>Priority-based monitoring</small>
                  </span>
                </div>

                <div className="lp-progress-row">
                  <span>Response target</span>
                  <i>
                    <b style={{ width: "72%" }} />
                  </i>
                  <small>Sample</small>
                </div>

                <div className="lp-progress-row">
                  <span>Resolution target</span>
                  <i>
                    <b style={{ width: "54%" }} />
                  </i>
                  <small>Sample</small>
                </div>

                <p>
                  <CheckCircle2 size={14} />
                  Identify tickets that need attention.
                </p>
              </div>
            </div>
          )}

          <div className="lp-disclaimer">
            Illustrative interface · Not live application data
          </div>
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------
// NAVIGATION BAR
// --------------------------------------------------

function Navbar() {
  const [open, setOpen] = useState(false);

  const close = () => setOpen(false);

  return (
    <header className="lp-navbar">
      <Link to="/" className="lp-brand" onClick={close}>
        <span className="lp-brand-icon">
          <Headphones size={25} />
        </span>

        <span>
          Resolve<span>IT</span>
        </span>
      </Link>

      <button
        className="lp-menu-toggle"
        onClick={() => setOpen(!open)}
        aria-label="Toggle navigation"
        aria-expanded={open}
      >
        {open ? <X /> : <Menu />}
      </button>

      <nav className={open ? "lp-nav open" : "lp-nav"}>
        <a href="#features" onClick={close}>Features</a>
        <a href="#use-cases" onClick={close}>Use cases</a>
        <a href="#workflow" onClick={close}>How it works</a>
        <a href="#for-teams" onClick={close}>For teams</a>
        <a href="#security" onClick={close}>Security</a>
        <a href="#faq" onClick={close}>FAQ</a>

        <div className="lp-mobile-links">
          <Link to="/login" onClick={close}>Sign in</Link>

          <Link
            to="/register"
            className="lp-nav-cta"
            onClick={close}
          >
            Get started <ArrowUpRight size={16} />
          </Link>
        </div>
      </nav>

      <div className="lp-nav-actions">
        <ThemeToggle />
        <Link to="/login">Sign in</Link>

        <Link to="/register" className="lp-nav-cta">
          Get started <ArrowUpRight size={17} />
        </Link>
      </div>
    </header>
  );
}

// --------------------------------------------------
// FAQ COMPONENT
// --------------------------------------------------

function FAQ({ item, index }) {
  const [open, setOpen] = useState(index === 0);

  return (
    <article className={`lp-faq ${open ? "open" : ""}`}>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span>{item[0]}</span>
        <ChevronDown size={18} />
      </button>

      <div className="lp-faq-answer">
        <p>{item[1]}</p>
      </div>
    </article>
  );
}

// --------------------------------------------------
// MAIN LANDING PAGE
// --------------------------------------------------

export default function LandingPage() {
  useReveal();

  const visualRef = useRef(null);

  useTilt(visualRef);

  return (
    <div className="lp-page">
      <div className="lp-bg" aria-hidden="true">
        <div className="lp-grid" />
        <div className="lp-glow glow-a" />
        <div className="lp-glow glow-b" />
        <div className="lp-orbit" />
      </div>

      <div className="lp-container">
        <Navbar />

        <main>
          {/* HERO SECTION */}

          <section className="lp-hero">
            <div className="lp-hero-copy">
              <div className="lp-badge">
                <i /> A BETTER WAY TO MANAGE IT SUPPORT
              </div>

              <h1>
                Support that
                <br />
                <span>moves work</span>
                <br />
                forward<span className="lp-period">.</span>
              </h1>

              <p>
                Bring IT requests, ticket ownership, SLA monitoring,
                and team collaboration together in one focused workspace.
              </p>

              <div className="lp-actions">
                <Link to="/register" className="lp-primary">
                  Get started <ArrowRight size={18} />
                </Link>

                <a href="#workflow" className="lp-secondary">
                  Explore the workflow <ArrowUpRight size={17} />
                </a>
              </div>

              <div className="lp-proof">
                <span><Check size={14} /> Structured ticket tracking</span>
                <span><Check size={14} /> Role-based access</span>
                <span><Check size={14} /> SLA visibility</span>
              </div>
            </div>

            <div className="lp-hero-visual" ref={visualRef}>
              <div className="lp-floating lp-float-one">
                <span><Clock3 size={19} /></span>
                <div>
                  <b>SLA visibility</b>
                  <small>Monitor deadlines</small>
                </div>
              </div>

              <DashboardPreview />

              <div className="lp-floating lp-float-two">
                <span><CheckCircle2 size={19} /></span>
                <div>
                  <b>Clear ownership</b>
                  <small>Assigned to support</small>
                </div>
              </div>
            </div>

            <a className="lp-scroll" href="#intro">
              <i /> Scroll to explore
            </a>
          </section>

          {/* INTRODUCTION */}

          <section className="lp-intro" id="intro" data-reveal>
            <span className="lp-kicker">
              BUILT AROUND THE SUPPORT WORKFLOW
            </span>

            <div className="lp-intro-grid">
              <h2>
                Less chasing.
                <br />
                <span>More clarity.</span>
              </h2>

              <div>
                <p>
                  IT support becomes difficult when requests are scattered
                  across chats, emails, and spreadsheets. ResolveIT brings
                  the process into a shared workspace, so requests have
                  context, owners, and visible progress.
                </p>

                <p className="lp-muted">
                  From the first report to the final update, employees and
                  support teams can follow the same ticket lifecycle.
                </p>
              </div>
            </div>

            <div className="lp-principles">
              <div>
                <ClipboardList />
                <span>
                  <b>Structured requests</b>
                  <small>Capture the details that matter</small>
                </span>
              </div>

              <div>
                <Users />
                <span>
                  <b>Visible responsibility</b>
                  <small>Know who owns the next action</small>
                </span>
              </div>

              <div>
                <Activity />
                <span>
                  <b>Progress you can follow</b>
                  <small>Keep updates in one timeline</small>
                </span>
              </div>
            </div>
          </section>

          {/* USE CASES */}

          <section className="lp-use-cases" id="use-cases">
            <div className="lp-section-heading" data-reveal>
              <span className="lp-kicker">WHERE RESOLVEIT FITS</span>

              <h2>
                Bring everyday IT requests
                <br />
                <span>into one clear process.</span>
              </h2>

              <p>
                Use a shared ticket workflow for common support
                situations across your organization.
              </p>
            </div>

            <div className="lp-use-grid">
              <article data-reveal>
                <span className="lp-use-icon"><MessageSquare /></span>
                <small>01 / INCIDENTS</small>
                <h3>Report a problem</h3>
                <p>
                  Give employees a consistent way to describe technical
                  issues and follow the request as it moves through support.
                </p>
              </article>

              <article data-reveal style={{ "--delay": "90ms" }}>
                <span className="lp-use-icon"><LockKeyhole /></span>
                <small>02 / ACCESS</small>
                <h3>Request access or help</h3>
                <p>
                  Keep requests for account access, permissions, and
                  application assistance recorded with their status and owner.
                </p>
              </article>

              <article data-reveal style={{ "--delay": "180ms" }}>
                <span className="lp-use-icon"><Laptop /></span>
                <small>03 / DEVICES</small>
                <h3>Track device issues</h3>
                <p>
                  Record hardware, connectivity, and workstation problems
                  so support teams can review the details and progress.
                </p>
              </article>

              <article data-reveal style={{ "--delay": "270ms" }}>
                <span className="lp-use-icon"><ClipboardList /></span>
                <small>04 / SERVICE</small>
                <h3>Manage service requests</h3>
                <p>
                  Keep routine IT requests out of scattered messages
                  and make their ownership and completion visible.
                </p>
              </article>
            </div>
          </section>

          {/* FEATURES */}

          <section className="lp-section" id="features">
            <div className="lp-section-heading" data-reveal>
              <span className="lp-kicker">THE WORKSPACE</span>

              <h2>
                Everything support needs.
                <br />
                <span>Nothing lost in the noise.</span>
              </h2>

              <p>
                Core tools to organize requests, coordinate people,
                and keep service work visible.
              </p>
            </div>

            <div className="lp-feature-grid">
              {features.map((f, i) => {
                const Icon = f.icon;

                return (
                  <article
                    className="lp-feature"
                    data-reveal
                    style={{
                      "--delay": `${(i % 3) * 100}ms`
                    }}
                    key={f.title}
                  >
                    <div className="lp-feature-top">
                      <span><Icon size={21} /></span>
                      <small>{f.tag}</small>
                    </div>

                    <h3>{f.title}</h3>
                    <p>{f.text}</p>
                    <i />
                  </article>
                );
              })}
            </div>
          </section>

          {/* WORKFLOW */}

          <section className="lp-workflow" id="workflow">
            <div className="lp-section-heading centered" data-reveal>
              <span className="lp-kicker">HOW IT WORKS</span>

              <h2>
                A clearer path from
                <br />
                <span>issue to solution.</span>
              </h2>

              <p>
                One structured process that connects employees
                and IT support teams.
              </p>
            </div>

            <div className="lp-workflow-grid">
              {workflow.map((step, i) => {
                const Icon = step.icon;

                return (
                  <article
                    className="lp-step"
                    data-reveal
                    style={{
                      "--delay": `${i * 120}ms`
                    }}
                    key={step.title}
                  >
                    <div className="lp-step-top">
                      <b>0{i + 1}</b>
                      <Icon size={22} />
                    </div>

                    <h3>{step.title}</h3>
                    <p>{step.text}</p>

                    <span>
                      <CheckCircle2 size={15} /> Clear next action
                    </span>
                  </article>
                );
              })}
            </div>
          </section>

          {/* SECURITY AND ACCESS CONTROL */}

          <section className="lp-security" id="security">
            <div className="lp-security-card" data-reveal>
              <div className="lp-lock">
                <LockKeyhole size={27} />
              </div>

              <span className="lp-kicker">ACCESS CONTROL</span>

              <h3>
                Right access.
                <br />
                <span>Clear boundaries.</span>
              </h3>

              {[
                ["A", "Administrator", "Manage the workspace", "admin"],
                ["S", "Support engineer", "Work assigned tickets", "support"],
                ["E", "Employee", "Track own requests", "employee"]
              ].map((r) => (
                <div className="lp-role" key={r[1]}>
                  <i className={r[3]}>{r[0]}</i>
                  <b>{r[1]}</b>
                  <small>{r[2]}</small>
                </div>
              ))}
            </div>

            <div className="lp-security-copy" data-reveal>
              <span className="lp-kicker">DESIGNED FOR ACCOUNTABILITY</span>

              <h2>
                Every role has
                <br />
                <span>a clear purpose.</span>
              </h2>

              <p>
                ResolveIT uses role-based permissions to keep ticket
                access and actions aligned with each person's responsibility.
              </p>

              <ul>
                <li>
                  <CheckCircle2 />
                  Employees create and follow their own requests.
                </li>

                <li>
                  <CheckCircle2 />
                  Support engineers manage tickets assigned to them.
                </li>

                <li>
                  <CheckCircle2 />
                  Administrators oversee assignment and ticket management.
                </li>
              </ul>

              <Link to="/register" className="lp-inline-link">
                Explore the workspace <ArrowRight size={17} />
              </Link>
            </div>
          </section>

          {/* TEAMS */}

          <section className="lp-team-section" id="for-teams">
            <div className="lp-section-heading centered" data-reveal>
              <span className="lp-kicker">
                ONE WORKSPACE · THREE PERSPECTIVES
              </span>

              <h2>
                Useful to the people
                <br />
                <span>on every side of support.</span>
              </h2>

              <p>
                Each role sees the work that belongs to its responsibility.
              </p>
            </div>

            <div className="lp-team-grid">
              <article data-reveal>
                <span className="lp-team-number">01</span>
                <div className="lp-team-icon employee"><Users /></div>

                <h3>Employees</h3>

                <p>
                  Raise requests, add the details support needs,
                  and check progress on their own tickets.
                </p>

                <ul>
                  <li><Check /> Create support tickets</li>
                  <li><Check /> Follow status updates</li>
                  <li><Check /> Receive relevant notifications</li>
                </ul>
              </article>

              <article data-reveal style={{ "--delay": "100ms" }}>
                <span className="lp-team-number">02</span>
                <div className="lp-team-icon engineer"><Headphones /></div>

                <h3>Support engineers</h3>

                <p>
                  Focus on assigned work, update ticket progress,
                  and respond to the people who need help.
                </p>

                <ul>
                  <li><Check /> View assigned tickets</li>
                  <li><Check /> Update status and priority</li>
                  <li><Check /> Record ticket activity</li>
                </ul>
              </article>

              <article data-reveal style={{ "--delay": "200ms" }}>
                <span className="lp-team-number">03</span>
                <div className="lp-team-icon admin"><ShieldCheck /></div>

                <h3>Administrators</h3>

                <p>
                  Oversee the support queue, coordinate assignment,
                  and manage tickets across the workspace.
                </p>

                <ul>
                  <li><Check /> Review ticket activity</li>
                  <li><Check /> Assign support engineers</li>
                  <li><Check /> Manage ticket records</li>
                </ul>
              </article>
            </div>
          </section>

          {/* VISIBILITY */}

          <section className="lp-visibility">
            <div data-reveal>
              <span className="lp-kicker">STAY AWARE</span>

              <h2>
                Know what needs
                <br />
                <span>attention next.</span>
              </h2>

              <p>
                Ticket status, priority, notifications, and SLA indicators
                help teams focus on the next useful action instead of chasing
                updates.
              </p>
            </div>

            <div className="lp-visibility-list" data-reveal>
              <div>
                <Bell />
                <span>
                  <b>Relevant notifications</b>
                  <small>Updates when ticket activity affects you</small>
                </span>
                <ArrowUpRight />
              </div>

              <div>
                <Clock3 />
                <span>
                  <b>Response and resolution targets</b>
                  <small>Understand deadlines by ticket priority</small>
                </span>
                <ArrowUpRight />
              </div>

              <div>
                <History />
                <span>
                  <b>Ticket activity history</b>
                  <small>Follow important actions and changes</small>
                </span>
                <ArrowUpRight />
              </div>
            </div>
          </section>

          {/* FAQ */}

          <section className="lp-faq-section" id="faq">
            <div data-reveal>
              <span className="lp-kicker">GOOD TO KNOW</span>

              <h2>
                Questions,
                <br />
                <span>answered.</span>
              </h2>

              <p>
                Quick details about how the ResolveIT workspace
                is designed to work.
              </p>
            </div>

            <div className="lp-faq-list" data-reveal>
              {faqs.map((item, i) => (
                <FAQ
                  item={item}
                  index={i}
                  key={item[0]}
                />
              ))}
            </div>
          </section>

          {/* FINAL CTA */}

          <section className="lp-cta" data-reveal>
            <div>
              <span className="lp-kicker">MAKE SUPPORT WORK BETTER</span>

              <h2>
                Bring every request
                <br />
                <span>one step closer to solved.</span>
              </h2>

              <p>
                Give employees and IT teams a shared place to manage
                support work with more clarity.
              </p>

              <div className="lp-actions">
                <Link to="/register" className="lp-primary">
                  Get started <ArrowRight size={18} />
                </Link>

                <Link to="/login" className="lp-secondary">
                  Sign in to ResolveIT <ArrowUpRight size={17} />
                </Link>
              </div>
            </div>

            <div className="lp-cta-symbol">
              <Zap size={42} />
            </div>
          </section>
        </main>

        {/* FOOTER */}

        <footer className="lp-footer">
          <div>
            <Link to="/" className="lp-brand">
              <span className="lp-brand-icon">
                <Headphones size={22} />
              </span>

              <span>
                Resolve<span>IT</span>
              </span>
            </Link>

            <p>A focused workspace for clearer IT support.</p>

            <nav>
              <a href="#features">Features</a>
              <a href="#use-cases">Use cases</a>
              <a href="#workflow">How it works</a>
              <a href="#for-teams">For teams</a>
              <a href="#security">Security</a>
              <a href="#faq">FAQ</a>
              <Link to="/login">Sign in</Link>
            </nav>
          </div>

          <small>
            © {new Date().getFullYear()} ResolveIT. All rights reserved.
          </small>
        </footer>
      </div>
    </div>
  );
}
