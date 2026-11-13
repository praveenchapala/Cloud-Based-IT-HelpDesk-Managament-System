import {
  QueryCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import { dynamoDB, TABLE_NAME } from "./dynamodb.js";
import {
  createNotification
} from "./notificationRepository.js";
import {
  findActiveStaff,
  findActiveSupportEngineer
} from "./userRepository.js";

const MINUTE = 60 * 1000;
const INDEX_NAME = process.env.SLA_ACTIVE_INDEX_NAME || "sla-active-index";
const SHADOW_MODE = String(process.env.SLA_SHADOW_MODE ?? "true").toLowerCase() !== "false";
const MAX_TICKETS_PER_RUN = Math.max(1, Math.min(500, Number(process.env.SLA_SWEEP_LIMIT || 200)));
const HORIZON_MINUTES = Math.max(1, Number(process.env.SLA_SWEEP_HORIZON_MINUTES || 5));

function validTime(value) {
  const time = new Date(value || "").getTime();
  return Number.isFinite(time) ? time : null;
}

function durationMs(ticket, kind) {
  const minutes = Number(ticket.slaPolicy?.[kind === "response" ? "responseMinutes" : "resolutionMinutes"]);
  return Number.isFinite(minutes) && minutes > 0 ? minutes * MINUTE : null;
}

function getPendingResolutionTime(ticket) {
  if (ticket.resolvedAt || ticket.status === "Resolved") return null;
  return validTime(ticket.slaResolutionDueAt);
}

/** Earliest future scheduler action. Undefined means the ticket must not be in the sparse GSI. */
export function getNextSlaActionAt(ticket) {
  if (!ticket || ticket.status === "Resolved" || ticket.status === "Waiting for User") return null;

  const actions = [];
  const responseDue = validTime(ticket.slaResponseDueAt);
  const resolutionDue = getPendingResolutionTime(ticket);
  const responseDuration = durationMs(ticket, "response");
  const resolutionDuration = durationMs(ticket, "resolution");

  if (!ticket.firstResponseAt && responseDue && responseDuration && !ticket.slaResponseWarnedAt) {
    actions.push(responseDue - responseDuration * 0.25);
  }
  if (resolutionDue && resolutionDuration && !ticket.slaResolutionWarnedAt) {
    actions.push(resolutionDue - resolutionDuration * 0.25);
  }
  if (resolutionDue && Number(ticket.slaBreachLevel || 0) < 1) actions.push(resolutionDue);
  if (resolutionDue && Number(ticket.slaBreachLevel || 0) === 1 && !ticket.slaEscalatedAt) {
    actions.push(resolutionDue + 60 * MINUTE);
  }

  const createdAt = validTime(ticket.unassignedAt || ticket.createdAt);
  const isUnassigned = !ticket.assignedTo && ticket.assignmentStatus !== "Assigned";
  if (isUnassigned && createdAt && !ticket.slaUnassignedRemindedAt) {
    actions.push(createdAt + 30 * MINUTE);
  }

  const futureOrDue = actions.filter(Number.isFinite);
  return futureOrDue.length ? new Date(Math.min(...futureOrDue)).toISOString() : null;
}

function isTicket(item) {
  if (!item || item.recordType === "USER" || item.recordType === "NOTIFICATION") return false;
  return item.recordType === "TICKET" || (
    typeof item.title === "string" && typeof item.description === "string" &&
    typeof item.status === "string" && typeof item.priority === "string"
  );
}

async function notifyUser({ userId, ticket, type, title, message }) {
  if (!userId) return;
  await createNotification({ userId, ticketId: ticket.id, type, title, message });
}

async function notifyAssignedEngineer(ticket, payload) {
  if (!ticket.assignedTo) return false;
  const engineer = await findActiveSupportEngineer(ticket.assignedTo);
  if (!engineer) return false;
  await notifyUser({ userId: engineer.userId, ticket, ...payload });
  return true;
}

async function notifyAdmins(ticket, payload) {
  const staff = await findActiveStaff("");
  const admins = staff.filter((person) => person.role === "ADMIN");
  const results = await Promise.allSettled(
    admins.map((admin) => notifyUser({ userId: admin.userId, ticket, ...payload }))
  );
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) throw new Error(`${failures.length} admin SLA notification(s) failed`);
  return admins.length;
}

async function claimAction(ticket, field, eventName, details = {}, claimValue = new Date().toISOString()) {
  const now = new Date().toISOString();
  const names = { "#field": field, "#version": "version" };
  const values = { ":claimValue": claimValue, ":zero": 0, ":one": 1 };
  let condition = "attribute_not_exists(#field)";
  if (Number.isSafeInteger(ticket.version)) {
    condition += " AND #version = :expectedVersion";
    values[":expectedVersion"] = ticket.version;
  } else {
    condition += " AND attribute_not_exists(#version)";
  }

  try {
    await dynamoDB.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { id: ticket.id },
      UpdateExpression: "SET #field = :claimValue, #version = if_not_exists(#version, :zero) + :one",
      ConditionExpression: condition,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values
    }));
    console.info(JSON.stringify({ component: "sla-scheduler", event: eventName, mode: SHADOW_MODE ? "shadow" : "live", ticketId: ticket.id, ...details, at: now }));
    return true;
  } catch (error) {
    if (error.name === "ConditionalCheckFailedException") return false;
    throw error;
  }
}

async function runAction(ticket, { field, eventName, type, title, message, target, claimValue }) {
  if (SHADOW_MODE) {
    console.info(JSON.stringify({ component: "sla-scheduler", event: `would_${eventName}`, mode: "shadow", ticketId: ticket.id, target, at: new Date().toISOString() }));
    return { claimed: false, shadow: true };
  }

  const effectiveClaimValue = claimValue ?? new Date().toISOString();
  const claimed = await claimAction(ticket, field, eventName, { target }, effectiveClaimValue);
  if (!claimed) return { claimed: false };
  ticket.version = (Number(ticket.version) || 0) + 1;
  ticket[field] = effectiveClaimValue;

  try {
    const payload = { type, title, message };
    if (target === "engineer") {
      const deliveredToEngineer = await notifyAssignedEngineer(ticket, payload);
      if (!deliveredToEngineer) await notifyAdmins(ticket, payload);
    } else {
      await notifyAdmins(ticket, payload);
    }
    return { claimed: true };
  } catch (error) {
    // The claim remains as an audit marker: do not send duplicate alerts on
    // every scheduler retry. Failed delivery is visible in logs for operator action.
    console.error("SLA notification delivery failed after claim", { ticketId: ticket.id, eventName, message: error.message });
    return { claimed: true, deliveryFailed: true };
  }
}

async function updateIndexProjection(ticket) {
  const nextDeadlineAt = getNextSlaActionAt(ticket);
  if (nextDeadlineAt) {
    await dynamoDB.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { id: ticket.id },
      UpdateExpression: "SET #pk = :active, #next = :next",
      ExpressionAttributeNames: { "#pk": "openSlaPk", "#next": "nextDeadlineAt" },
      ExpressionAttributeValues: { ":active": "ACTIVE", ":next": nextDeadlineAt }
    }));
  } else {
    await dynamoDB.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { id: ticket.id },
      UpdateExpression: "REMOVE #pk, #next",
      ExpressionAttributeNames: { "#pk": "openSlaPk", "#next": "nextDeadlineAt" }
    }));
  }
}

async function processTicket(ticket, nowMs) {
  const result = { warnings: 0, breaches: 0, escalations: 0, unassignedReminders: 0 };
  if (!isTicket(ticket) || ticket.status === "Resolved" || ticket.status === "Waiting for User") return result;

  const responseDue = validTime(ticket.slaResponseDueAt);
  const resolutionDue = validTime(ticket.slaResolutionDueAt);
  const responseDuration = durationMs(ticket, "response");
  const resolutionDuration = durationMs(ticket, "resolution");

  if (!ticket.firstResponseAt && responseDue && responseDuration && !ticket.slaResponseWarnedAt && nowMs >= responseDue - responseDuration * 0.25) {
    const action = await runAction(ticket, {
      field: "slaResponseWarnedAt", eventName: "response_warning", type: "SLA_RESPONSE_WARNING",
      title: "First response SLA is at risk", message: `Ticket #${ticket.id} is approaching its first response deadline.`, target: ticket.assignedTo ? "engineer" : "admin"
    });
    if (action.claimed || action.shadow) result.warnings++;
  }

  if (resolutionDue && resolutionDuration && !ticket.slaResolutionWarnedAt && nowMs >= resolutionDue - resolutionDuration * 0.25) {
    const action = await runAction(ticket, {
      field: "slaResolutionWarnedAt", eventName: "resolution_warning", type: "SLA_RESOLUTION_WARNING",
      title: "Resolution SLA is at risk", message: `Ticket #${ticket.id} is approaching its resolution deadline.`, target: ticket.assignedTo ? "engineer" : "admin"
    });
    if (action.claimed || action.shadow) result.warnings++;
  }

  if (resolutionDue && nowMs >= resolutionDue && Number(ticket.slaBreachLevel || 0) < 1) {
    const action = await runAction(ticket, {
      field: "slaBreachLevel", claimValue: 1, eventName: "resolution_breached", type: "SLA_BREACHED",
      title: "Ticket resolution SLA breached", message: `Ticket #${ticket.id} has exceeded its resolution deadline.`, target: "admin"
    });
    if (action.claimed || action.shadow) result.breaches++;
  }

  if (resolutionDue && nowMs >= resolutionDue + 60 * MINUTE && Number(ticket.slaBreachLevel || 0) === 1 && !ticket.slaEscalatedAt) {
    const action = await runAction(ticket, {
      field: "slaEscalatedAt", eventName: "level_two_escalation", type: "SLA_ESCALATED",
      title: "Level 2 SLA escalation", message: `Ticket #${ticket.id} remains unresolved more than one hour after its SLA breach.`, target: "admin"
    });
    if (action.claimed || action.shadow) result.escalations++;
  }

  const unassignedAt = validTime(ticket.unassignedAt || ticket.createdAt);
  const isUnassigned = !ticket.assignedTo && ticket.assignmentStatus !== "Assigned";
  if (isUnassigned && unassignedAt && nowMs >= unassignedAt + 30 * MINUTE && !ticket.slaUnassignedRemindedAt) {
    const action = await runAction(ticket, {
      field: "slaUnassignedRemindedAt", eventName: "unassigned_reminder", type: "SLA_UNASSIGNED_REMINDER",
      title: "Ticket requires assignment", message: `Ticket #${ticket.id} has been unassigned for at least 30 minutes.`, target: "admin"
    });
    if (action.claimed || action.shadow) result.unassignedReminders++;
  }

  if (!SHADOW_MODE && (result.warnings || result.breaches || result.escalations || result.unassignedReminders)) {
    await updateIndexProjection(ticket);
  }
  return result;
}

export async function runSlaSweep() {
  const now = Date.now();
  const horizon = new Date(now + HORIZON_MINUTES * MINUTE).toISOString();
  let lastEvaluatedKey;
  let checked = 0;
  const totals = { warnings: 0, breaches: 0, escalations: 0, unassignedReminders: 0 };

  do {
    const response = await dynamoDB.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: INDEX_NAME,
      KeyConditionExpression: "#pk = :active AND #next <= :horizon",
      ExpressionAttributeNames: { "#pk": "openSlaPk", "#next": "nextDeadlineAt" },
      ExpressionAttributeValues: { ":active": "ACTIVE", ":horizon": horizon },
      Limit: Math.min(50, MAX_TICKETS_PER_RUN - checked),
      ...(lastEvaluatedKey ? { ExclusiveStartKey: lastEvaluatedKey } : {})
    }));

    for (const ticket of response.Items || []) {
      const counts = await processTicket(ticket, now);
      checked++;
      for (const key of Object.keys(totals)) totals[key] += counts[key];
      if (checked >= MAX_TICKETS_PER_RUN) break;
    }
    lastEvaluatedKey = checked >= MAX_TICKETS_PER_RUN ? undefined : response.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  const summary = { checked, ...totals, mode: SHADOW_MODE ? "shadow" : "live", completedAt: new Date().toISOString() };
  console.info(JSON.stringify({ component: "sla-scheduler", event: "sweep_completed", ...summary }));
  return summary;
}

export const slaSchedulerConfig = {
  shadowMode: SHADOW_MODE,
  indexName: INDEX_NAME,
  maxTicketsPerRun: MAX_TICKETS_PER_RUN
};
