import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { dynamoDB, TABLE_NAME } from "./dynamodb.js";
import { createOrGetDetectedIncident, linkTicketToIncident, scanIncidents, setIncidentAffectedTicketCount, isActiveIncidentStatus } from "./incidentRepository.js";
import { findActiveAdmins } from "./userRepository.js";
import { createNotification } from "./notificationRepository.js";

export const INCIDENT_WINDOW_MINUTES = 30;
export const INCIDENT_THRESHOLD = 5;

import { classifyTicket } from "./incidentRules.js";

function isEligibleTicket(ticket, cutoff) {
  if (!ticket || (ticket.recordType && ticket.recordType !== "TICKET")) return false;
  const status = String(ticket.status || "").toLowerCase();
  if (!new Set(["open", "in progress"]).has(status)) return false;
  const created = new Date(ticket.createdAt || ticket.created_at || ticket.date || 0).getTime();
  return Number.isFinite(created) && created >= cutoff;
}

async function scanRecentTickets(cutoff) {
  const records = [];
  let lastEvaluatedKey;
  do {
    const result = await dynamoDB.send(new ScanCommand({
      TableName: TABLE_NAME,
      ...(lastEvaluatedKey ? { ExclusiveStartKey: lastEvaluatedKey } : {})
    }));
    records.push(...(result.Items || []).filter((item) => isEligibleTicket(item, cutoff)));
    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);
  return records;
}

async function notifyAdmins(incident) {
  const admins = await findActiveAdmins();
  const results = await Promise.allSettled(admins.map((admin) => createNotification({
    userId: admin.userId,
    incidentId: incident.incidentId,
    ticketId: incident.id,
    type: "INCIDENT_DETECTED",
    title: `Potential major incident: ${incident.incidentNumber}`,
    message: `${incident.affectedTicketCount} related tickets detected for ${incident.serviceLabel}. Administrator review required.`
  })));
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) console.error("Some incident notifications could not be created:", failures.length);
}

/**
 * Re-evaluates the rolling 30-minute window after each ticket is persisted.
 * A deterministic category/window key makes concurrent requests converge on
 * one incident record. This is a first-pass correlation rule, not root-cause AI.
 */
export async function evaluateTicketForIncident(ticket) {
  const now = Date.now();
  const cutoff = now - INCIDENT_WINDOW_MINUTES * 60 * 1000;
  if (!isEligibleTicket(ticket, cutoff)) return null;

  const classification = classifyTicket(ticket);
  if (classification.category === "OTHER") return null;

  const recentTickets = await scanRecentTickets(cutoff);
  const matchingTickets = recentTickets.filter((candidate) =>
    classifyTicket(candidate).category === classification.category
  );

  if (matchingTickets.length < INCIDENT_THRESHOLD) return null;

  // 30-minute epoch buckets provide a deterministic idempotency key. A scan
  // may still link a ticket into a recent active incident across bucket edges.
  const detectedAt = new Date(now).toISOString();
  const recentIncidents = await scanIncidents();
  const reusableIncident = recentIncidents.find((candidate) =>
    candidate.service === classification.category &&
    isActiveIncidentStatus(candidate.status) &&
    new Date(candidate.createdAt).getTime() >= cutoff
  );
  const bucket = Math.floor(now / (INCIDENT_WINDOW_MINUTES * 60 * 1000));
  const detectionKey = `${classification.category}:${bucket}`;
  const incident = reusableIncident || await createOrGetDetectedIncident({
    detectionKey,
    service: classification.category,
    serviceLabel: classification.label,
    title: `${classification.label} service disruption`,
    description: `${matchingTickets.length} open or in-progress tickets with matching service indicators were created within ${INCIDENT_WINDOW_MINUTES} minutes. Administrator confirmation is required.`,
    ticketCount: matchingTickets.length,
    detectedAt
  });

  // A dismissed detection is intentionally not reopened by later tickets in
  // the same deterministic window; a new window can generate a fresh review.
  if (incident.status === "DISMISSED") return null;

  let linkedCount = 0;
  for (const candidate of matchingTickets) {
    const linked = await linkTicketToIncident(candidate, incident);
    if (linked) linkedCount++;
  }

  const persistedIncident = await setIncidentAffectedTicketCount(incident.id, matchingTickets.length);
  const updatedIncident = { ...persistedIncident, affectedTicketCount: Math.max(persistedIncident?.affectedTicketCount || 0, matchingTickets.length) };
  if (incident.createdNow) {
    try {
      await notifyAdmins(updatedIncident);
    } catch (error) {
      console.error("Incident administrator notification failed:", error);
    }
  }

  return { incident: updatedIncident, linkedCount };
}
