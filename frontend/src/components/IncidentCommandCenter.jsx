
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  RefreshCw,
  ShieldAlert,
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

export default function IncidentCommandCenter({ isAdmin }) {
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [severityById, setSeverityById] = useState({});

  const loadIncidents = useCallback(async () => {
    try {
      const response = await getIncidents();

      setError("");
      setIncidents(
        Array.isArray(response?.data) ? response.data : []
      );
    } catch (err) {
      setError(
        err.response?.data?.message ||
        "Unable to load incidents."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // Defer initial loading to avoid synchronous state updates inside an effect.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadIncidents();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [loadIncidents]);

  async function handleAction(incident, action) {
    setBusyId(incident.id);
    setError("");

    try {
      if (action === "confirm") {
        await confirmIncident(
          incident.id,
          severityById[incident.id] ||
            incident.severity ||
            "P2"
        );
      } else {
        await dismissIncident(incident.id);
      }

      await loadIncidents();
    } catch (err) {
      setError(
        err.response?.data?.message ||
        "Unable to update this incident."
      );
    } finally {
      setBusyId(null);
    }
  }

  const detectedCount = incidents.filter(
    (item) => item.status === "DETECTED"
  ).length;

  const activeCount = incidents.filter(
    (item) =>
      ["INVESTIGATING", "IDENTIFIED", "MONITORING"].includes(
        item.status
      )
  ).length;

  return (
    <section
      className="incident-center"
      aria-labelledby="incident-center-title"
    >
      <header className="incident-center-header">
        <div>
          <div className="incident-eyebrow">
            <ShieldAlert size={15} />
            MAJOR INCIDENT MANAGEMENT
          </div>

          <h2 id="incident-center-title">
            Incident Command Center
          </h2>

          <p>
            Review correlated service disruptions and coordinate response.
          </p>
        </div>

        <button
          className="incident-refresh"
          onClick={loadIncidents}
          disabled={loading}
          type="button"
        >
          <RefreshCw
            size={16}
            className={loading ? "incident-spin" : ""}
          />
          <span>Refresh</span>
        </button>
      </header>

      <div className="incident-metrics">
        <article className="incident-metric">
          <span>Awaiting review</span>
          <strong>{detectedCount}</strong>
          <small>Detected automatically</small>
        </article>

        <article className="incident-metric">
          <span>Active major incidents</span>
          <strong>{activeCount}</strong>
          <small>Confirmed by administrators</small>
        </article>

        <article className="incident-metric">
          <span>Total incidents</span>
          <strong>{incidents.length}</strong>
          <small>Including resolved and dismissed</small>
        </article>
      </div>

      {error && (
        <div className="incident-alert" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <div className="incident-empty">
          Loading incidents…
        </div>
      ) : incidents.length === 0 ? (
        <div className="incident-empty">
          <CheckCircle2 size={28} />
          <strong>No incidents detected</strong>
          <span>
            New correlated incidents will appear here automatically.
          </span>
        </div>
      ) : (
        <div className="incident-list">
          {incidents.map((incident) => (
            <article
              className={`incident-card incident-status-${String(
                incident.status
              ).toLowerCase()}`}
              key={incident.incidentId || incident.id}
            >
              <div className="incident-card-top">
                <div className="incident-card-heading">
                  <span className="incident-number">
                    {incident.incidentNumber}
                  </span>

                  <span
                    className={`incident-status-pill status-${String(
                      incident.status
                    ).toLowerCase()}`}
                  >
                    {STATUS_LABELS[incident.status] ||
                      incident.status}
                  </span>
                </div>

                <span className="incident-severity">
                  {incident.severity || "P2"}
                </span>
              </div>

              <h3>{incident.title}</h3>

              <p className="incident-description">
                {incident.description}
              </p>

              <div className="incident-card-meta">
                <span>
                  <AlertTriangle size={15} />
                  {incident.serviceLabel || incident.service}
                </span>

                <span>
                  <Clock3 size={15} />
                  {formatDate(incident.createdAt)}
                </span>

                <span>
                  {Number(incident.affectedTicketCount) || 0} affected tickets
                </span>
              </div>

              {incident.status === "DETECTED" && isAdmin && (
                <div className="incident-review-actions">
                  <label className="incident-severity-control">
                    <span>Confirm severity</span>

                    <select
                      value={
                        severityById[incident.id] ||
                        incident.severity ||
                        "P2"
                      }
                      onChange={(event) =>
                        setSeverityById((current) => ({
                          ...current,
                          [incident.id]: event.target.value
                        }))
                      }
                    >
                      <option value="P1">P1 — Critical</option>
                      <option value="P2">P2 — High</option>
                      <option value="P3">P3 — Medium</option>
                      <option value="P4">P4 — Low</option>
                    </select>
                  </label>

                  <button
                    className="incident-confirm"
                    onClick={() =>
                      handleAction(incident, "confirm")
                    }
                    disabled={busyId === incident.id}
                    type="button"
                  >
                    <CheckCircle2 size={16} />
                    {busyId === incident.id
                      ? "Working…"
                      : "Confirm incident"}
                  </button>

                  <button
                    className="incident-dismiss"
                    onClick={() =>
                      handleAction(incident, "dismiss")
                    }
                    disabled={busyId === incident.id}
                    type="button"
                  >
                    <XCircle size={16} />
                    Dismiss
                  </button>
                </div>
              )}

              {incident.status === "DETECTED" && !isAdmin && (
                <p className="incident-review-note">
                  Awaiting administrator confirmation.
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
