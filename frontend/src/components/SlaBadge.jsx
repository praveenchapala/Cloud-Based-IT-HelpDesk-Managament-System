import { useEffect, useState } from "react";
import { CheckCircle2, Clock3, PauseCircle, TriangleAlert } from "lucide-react";
import "./SlaBadge.css";

const MINUTE = 60 * 1000;

function formatDuration(milliseconds) {
  const totalMinutes = Math.max(0, Math.floor(milliseconds / MINUTE));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export default function SlaBadge({ ticket, type = "resolution", compact = false }) {
  const [, refresh] = useState(0);

  useEffect(() => {
    const update = () => refresh((value) => value + 1);
    const intervalId = window.setInterval(update, 30_000);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
    };
  }, []);

  if (!ticket) return null;

  const isResponse = type === "response";
  const deadline = isResponse ? ticket.slaResponseDueAt : ticket.slaResolutionDueAt;
  const completedAt = isResponse ? ticket.firstResponseAt : ticket.resolvedAt;
  const serverState = isResponse
    ? ticket.slaStatus?.response
    : ticket.slaStatus?.resolution;
  const paused = ticket.status === "Waiting for User" && Boolean(ticket.slaPausedAt);
  const dueTime = deadline ? new Date(deadline).getTime() : NaN;
  const now = Date.now();

  let state = "no-sla";
  let label = "SLA unavailable";
  let detail = "No deadline is recorded";
  let Icon = Clock3;

  if (paused) {
    state = "paused";
    label = "SLA paused";
    detail = "Waiting for user response";
    Icon = PauseCircle;
  } else if (completedAt && serverState === "MET") {
    state = "met";
    label = isResponse ? "Response met" : "SLA met";
    detail = `Completed ${new Date(completedAt).toLocaleString()}`;
    Icon = CheckCircle2;
  } else if (serverState === "BREACHED" || (Number.isFinite(dueTime) && now > dueTime && !completedAt)) {
    state = "breached";
    label = isResponse ? "Response overdue" : "Resolution overdue";
    detail = Number.isFinite(dueTime)
      ? `${formatDuration(now - dueTime)} overdue`
      : "Deadline passed";
    Icon = TriangleAlert;
  } else if (Number.isFinite(dueTime)) {
    const remaining = dueTime - now;
    const createdAt = new Date(ticket.createdAt || ticket.date || "").getTime();
    const total = Number.isFinite(createdAt) ? dueTime - createdAt : NaN;
    const atRisk = serverState === "AT_RISK" || (total > 0 && remaining <= total * 0.25);
    state = atRisk ? "at-risk" : "on-track";
    label = atRisk ? "Due soon" : "On track";
    detail = `${formatDuration(remaining)} left`;
    Icon = atRisk ? TriangleAlert : Clock3;
  }

  return (
    <span
      className={`sla-badge sla-badge--${state}${compact ? " sla-badge--compact" : ""}`}
      title={`${isResponse ? "First response" : "Resolution"}: ${detail}${deadline ? ` · Due ${new Date(deadline).toLocaleString()}` : ""}`}
      aria-label={`${isResponse ? "First response SLA" : "Resolution SLA"}: ${label}, ${detail}`}
      role="status"
    >
      <Icon size={14} aria-hidden="true" />
      <span className="sla-badge__copy">
        <strong>{compact ? (state === "on-track" ? "On track" : label) : label}</strong>
        {!compact && <small>{detail}</small>}
      </span>
    </span>
  );
}
