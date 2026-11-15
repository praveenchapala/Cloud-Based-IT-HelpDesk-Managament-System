import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Layers3,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Siren,
  Ticket,
  XCircle
} from "lucide-react";
import {
  confirmIncident,
  dismissIncident,
  getIncidents
} from "../services/api";
import "./IncidentCommandCenter.css";

const STATUS_LABELS = {
  DETECTED: "Awaiting review",
  INVESTIGATING: "Investigating",
  IDENTIFIED: "Cause identified",
  MONITORING: "Monitoring",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
  DISMISSED: "Dismissed"
};

const LIFECYCLE = [
  { key: "DETECTED", label: "Detected" },
  { key: "INVESTIGATING", label: "Investigating" },
  { key: "IDENTIFIED", label: "Identified" },
  { key: "MONITORING", label: "Monitoring" },
  { key: "RESOLVED", label: "Resolved" },
  { key: "CLOSED", label: "Closed" }
];

const STATUS_ORDER = LIFECYCLE.map((step) => step.key);

function formatDate(value) {
  if (!value) return "Time unavailable";

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
}

function getLifecycleProgress(status) {
  if (status === "DISMISSED") return 0;
  const index = STATUS_ORDER.indexOf(status);
  return index < 0 ? 0 : (index / (STATUS_ORDER.length - 1)) * 100;
}

function getSeverityClass(severity) {
  return `severity-${String(severity || "P2").toLowerCase()}`;
}

function MetricCard({ icon: Icon, label, value, detail, tone, index }) {
  return (
    <article
      className={`incident-metric-card metric-${tone}`}
      style={{ "--card-index": index }}
    >
      <div className="incident-metric-top">
        <span className="incident-metric-icon"><Icon size={18} /></span>
        <span className="incident-metric-label">{label}</span>
        <ArrowUpRight className="incident-metric-arrow" size={16} />
      </div>
      <strong className="incident-metric-value" key={value}>{value}</strong>
      <span className="incident-metric-detail">{detail}</span>
      <span className="incident-metric-glow" aria-hidden="true" />
    </article>
  );
}

function IncidentLifecycle({ status }) {
  if (status === "DISMISSED") {
    return (
      <div className="incident-dismissed-track">
        <XCircle size={15} />
        <span>This detection was dismissed by an administrator</span>
      </div>
    );
  }

  const currentIndex = Math.max(0, STATUS_ORDER.indexOf(status));

  return (
    <div className="incident-lifecycle" aria-label={`Incident lifecycle: ${STATUS_LABELS[status] || status}`}>
      <div className="incident-lifecycle-heading">
        <span>RESPONSE LIFECYCLE</span>
        <strong>{Math.round(getLifecycleProgress(status))}%</strong>
      </div>
      <div className="incident-lifecycle-track">
        <span
          className="incident-lifecycle-fill"
          style={{ width: `${getLifecycleProgress(status)}%` }}
        />
      </div>
      <div className="incident-lifecycle-steps">
        {LIFECYCLE.map((step, index) => {
          const complete = index < currentIndex;
          const current = index === currentIndex;
          return (
            <div
              className={`incident-lifecycle-step${complete ? " is-complete" : ""}${current ? " is-current" : ""}`}
              key={step.key}
            >
              <span className="incident-step-dot">
                {complete ? <CheckCircle2 size={12} /> : null}
              </span>
              <span>{step.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function IncidentCommandCenter({ isAdmin }) {
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [severityById, setSeverityById] = useState({});

  const loadIncidents = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);

    try {
      const response = await getIncidents();
      setError("");
      setIncidents(Array.isArray(response?.data) ? response.data : []);
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Unable to load incidents. Please try again."
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadIncidents();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadIncidents]);

  const metrics = useMemo(() => {
    const detected = incidents.filter((item) => item.status === "DETECTED").length;
    const active = incidents.filter((item) =>
      ["INVESTIGATING", "IDENTIFIED", "MONITORING"].includes(item.status)
    ).length;
    const affected = incidents.reduce(
      (total, item) => total + (Number(item.affectedTicketCount) || 0),
      0
    );

    return { detected, active, affected, total: incidents.length };
  }, [incidents]);

  async function handleAction(incident, action) {
    setBusyId(incident.id);
    setError("");

    try {
      if (action === "confirm") {
        await confirmIncident(
          incident.id,
          severityById[incident.id] || incident.severity || "P2"
        );
      } else {
        await dismissIncident(incident.id);
      }
      await loadIncidents(true);
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Unable to update this incident. Please try again."
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="incident-center" aria-labelledby="incident-center-title">
      <div className="incident-command-banner">
        <div className="incident-banner-orbit orbit-one" />
        <div className="incident-banner-orbit orbit-two" />
        <div className="incident-banner-content">
          <div className="incident-banner-kicker">
            <span className="incident-live-dot" />
            LIVE OPERATIONS
            <span className="incident-banner-divider" />
            INCIDENT RESPONSE &amp; SERVICE RESILIENCE
          </div>
          <h2 id="incident-center-title">Incident Command Center</h2>
          <p>Detect disruption early. Coordinate response. Restore service with confidence.</p>
          <div className="incident-banner-foot">
            <span><ShieldCheck size={15} /> Response workspace</span>
            <span><Activity size={15} /> Correlation engine enabled</span>
          </div>
        </div>
        <div className="incident-banner-emblem" aria-hidden="true">
          <div className="incident-emblem-ring">
            <Siren size={35} />
          </div>
          <span className="emblem-spark spark-a" />
          <span className="emblem-spark spark-b" />
          <span className="emblem-spark spark-c" />
        </div>
      </div>

      <header className="incident-center-toolbar">
        <div>
          <div className="incident-eyebrow">
            <ShieldAlert size={15} />
            MAJOR INCIDENT MANAGEMENT
          </div>
          <p>Monitor correlated service disruptions and coordinate the response.</p>
        </div>
        <button
          className="incident-refresh"
          onClick={() => void loadIncidents(true)}
          disabled={loading || refreshing}
          type="button"
        >
          <RefreshCw
            size={16}
            className={loading || refreshing ? "incident-spin" : ""}
          />
          <span>{refreshing ? "Updating…" : "Refresh data"}</span>
        </button>
      </header>

      <div className="incident-metrics">
        <MetricCard
          icon={Siren}
          label="Awaiting review"
          value={metrics.detected}
          detail="Detections requiring admin review"
          tone="warning"
          index={0}
        />
        <MetricCard
          icon={Activity}
          label="Active incidents"
          value={metrics.active}
          detail="Confirmed and in progress"
          tone="critical"
          index={1}
        />
        <MetricCard
          icon={Ticket}
          label="Affected tickets"
          value={metrics.affected}
          detail="Tickets linked to detected incidents"
          tone="info"
          index={2}
        />
        <MetricCard
          icon={Layers3}
          label="Total incidents"
          value={metrics.total}
          detail="All recorded incident events"
          tone="neutral"
          index={3}
        />
      </div>

      <div className="incident-section-heading">
        <div>
          <span className="incident-section-kicker">RESPONSE QUEUE</span>
          <h3>Incident activity</h3>
          <p>Review detections and follow each incident through its response lifecycle.</p>
        </div>
        <span className="incident-queue-count">
          <span /> {incidents.length} {incidents.length === 1 ? "incident" : "incidents"}
        </span>
      </div>

      {error && (
        <div className="incident-alert" role="alert">
          <AlertTriangle size={17} />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="incident-loading">
          <span className="incident-loading-pulse"><Activity size={23} /></span>
          <strong>Synchronizing incident intelligence</strong>
          <span>Retrieving the latest response data…</span>
          <div className="incident-loading-bar"><span /></div>
        </div>
      ) : incidents.length === 0 ? (
        <div className="incident-empty">
          <div className="incident-empty-icon"><ShieldCheck size={30} /></div>
          <span className="incident-section-kicker">ALL SYSTEMS CLEAR</span>
          <strong>No incidents detected</strong>
          <span>When correlated service disruptions are detected, they will appear here.</span>
        </div>
      ) : (
        <div className="incident-list">
          {incidents.map((incident, index) => {
            const severity = incident.severity || "P2";
            const isDetected = incident.status === "DETECTED";
            const isBusy = busyId === incident.id;

            return (
              <article
                className={`incident-card incident-status-${String(incident.status).toLowerCase()}`}
                key={incident.incidentId || incident.id}
                style={{ "--card-index": index }}
              >
                <div className="incident-card-accent" />
                <div className="incident-card-top">
                  <div className="incident-card-heading">
                    <span className="incident-card-icon"><AlertTriangle size={17} /></span>
                    <span className="incident-number">{incident.incidentNumber || `INC-${incident.id}`}</span>
                    <span className={`incident-status-pill status-${String(incident.status).toLowerCase()}`}>
                      <span className="incident-status-dot" />
                      {STATUS_LABELS[incident.status] || incident.status}
                    </span>
                  </div>
                  <span className={`incident-severity ${getSeverityClass(severity)}`}>
                    <span /> {severity}
                  </span>
                </div>

                <div className="incident-card-main">
                  <div className="incident-card-copy">
                    <h4>{incident.title || "Service disruption detected"}</h4>
                    <p className="incident-description">
                      {incident.description || "Correlated service indicators require investigation."}
                    </p>
                  </div>
                  <div className="incident-impact-number">
                    <strong>{Number(incident.affectedTicketCount) || 0}</strong>
                    <span>IMPACTED<br />TICKETS</span>
                  </div>
                </div>

                <div className="incident-card-meta">
                  <span><Layers3 size={15} /> {incident.serviceLabel || incident.service || "Unclassified service"}</span>
                  <span><Clock3 size={15} /> Detected {formatDate(incident.createdAt)}</span>
                  <span><Ticket size={15} /> {Number(incident.affectedTicketCount) || 0} linked tickets</span>
                </div>

                <IncidentLifecycle status={incident.status} />

                {isDetected && isAdmin && (
                  <div className="incident-review-actions">
                    <div className="incident-review-copy">
                      <span className="incident-section-kicker">ADMINISTRATOR DECISION</span>
                      <strong>Validate this detection</strong>
                      <span>Confirm it as a major incident or dismiss it as a false positive.</span>
                    </div>
                    <label className="incident-severity-control">
                      <span>Assign severity</span>
                      <select
                        value={severityById[incident.id] || severity}
                        onChange={(event) =>
                          setSeverityById((current) => ({
                            ...current,
                            [incident.id]: event.target.value
                          }))
                        }
                        disabled={isBusy}
                      >
                        <option value="P1">P1 — Critical</option>
                        <option value="P2">P2 — High</option>
                        <option value="P3">P3 — Medium</option>
                        <option value="P4">P4 — Low</option>
                      </select>
                    </label>
                    <button
                      className="incident-confirm"
                      onClick={() => void handleAction(incident, "confirm")}
                      disabled={isBusy}
                      type="button"
                    >
                      {isBusy ? <RefreshCw size={16} className="incident-spin" /> : <CheckCircle2 size={16} />}
                      {isBusy ? "Processing…" : "Confirm incident"}
                    </button>
                    <button
                      className="incident-dismiss"
                      onClick={() => void handleAction(incident, "dismiss")}
                      disabled={isBusy}
                      type="button"
                    >
                      <XCircle size={16} /> Dismiss
                    </button>
                  </div>
                )}

                {isDetected && !isAdmin && (
                  <div className="incident-review-note">
                    <ShieldAlert size={15} />
                    Awaiting administrator confirmation.
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      <footer className="incident-center-footer">
        <span><ShieldCheck size={15} /> Automated correlation · Human-approved major incidents</span>
        <span>ResolveIT Incident Operations</span>
      </footer>
    </section>
  );
}
