import { createHash, randomUUID } from "node:crypto";
import { GetCommand, PutCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { dynamoDB, TABLE_NAME } from "./dynamodb.js";

const INCIDENT_TYPE = "INCIDENT";
const ACTIVE_STATUSES = new Set(["DETECTED", "INVESTIGATING", "IDENTIFIED", "MONITORING"]);

function numericId(seed) {
  return createHash("sha256").update(seed).digest().readUIntBE(0, 6) + 1;
}

export async function scanIncidents() {
  const items = [];
  let lastEvaluatedKey;

  do {
    const result = await dynamoDB.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: "#recordType = :incident",
      ExpressionAttributeNames: { "#recordType": "recordType" },
      ExpressionAttributeValues: { ":incident": INCIDENT_TYPE },
      ...(lastEvaluatedKey ? { ExclusiveStartKey: lastEvaluatedKey } : {})
    }));

    items.push(...(result.Items || []));
    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return items.sort((a, b) =>
    String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt))
  );
}

export async function getIncidentById(id) {
  const numeric = Number(id);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) return null;

  const result = await dynamoDB.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { id: numeric }
  }));

  return result.Item?.recordType === INCIDENT_TYPE ? result.Item : null;
}

export async function createOrGetDetectedIncident({
  detectionKey,
  service,
  serviceLabel,
  title,
  description,
  ticketCount,
  detectedAt
}) {
  const id = numericId(`INCIDENT:${detectionKey}`);
  const existing = await getIncidentById(id);

  if (existing) {
    if (existing.detectionKey !== detectionKey) {
      throw new Error("Incident ID hash collision detected.");
    }
    return existing;
  }

  const incidentId = randomUUID();
  const incidentNumber = `INC-${String(id).padStart(10, "0")}`;

  const item = {
    id,
    recordType: INCIDENT_TYPE,
    incidentId,
    incidentNumber,
    detectionKey,
    source: "RULE_ENGINE",
    service,
    serviceLabel,
    title,
    description,
    severity: "P2",
    status: "DETECTED",
    affectedTicketCount: ticketCount,
    commanderUserId: null,
    commanderEmail: null,
    rootCause: null,
    resolutionSummary: null,
    version: 1,
    createdAt: detectedAt,
    updatedAt: detectedAt,
    activityHistory: [{
      activityId: randomUUID(),
      action: "INCIDENT_DETECTED",
      description: `Automatically detected from ${ticketCount} related tickets. Awaiting administrator confirmation.`,
      performedBy: "SYSTEM",
      createdAt: detectedAt
    }]
  };

  try {
    await dynamoDB.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: item,
      ConditionExpression: "attribute_not_exists(id)"
    }));

    return { ...item, createdNow: true };
  } catch (error) {
    if (error.name !== "ConditionalCheckFailedException") throw error;

    const raced = await getIncidentById(id);
    if (raced?.detectionKey === detectionKey) return raced;

    throw error;
  }
}

export async function linkTicketToIncident(ticket, incident) {
  if (!ticket?.id || !incident?.incidentId) return false;

  try {
    await dynamoDB.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { id: Number(ticket.id) },
      UpdateExpression: "SET #incidentId = :incidentId, #incidentNumber = :incidentNumber, #linkedAt = :linkedAt",
      ConditionExpression: "attribute_exists(id) AND (attribute_not_exists(#incidentId) OR #incidentId = :incidentId)",
      ExpressionAttributeNames: {
        "#incidentId": "incidentId",
        "#incidentNumber": "incidentNumber",
        "#linkedAt": "incidentLinkedAt"
      },
      ExpressionAttributeValues: {
        ":incidentId": incident.incidentId,
        ":incidentNumber": incident.incidentNumber,
        ":linkedAt": new Date().toISOString()
      }
    }));

    return true;
  } catch (error) {
    if (error.name === "ConditionalCheckFailedException") return false;
    throw error;
  }
}

export async function updateIncident(id, changes, actor) {
  const current = await getIncidentById(id);
  if (!current) return null;

  const now = new Date().toISOString();
  const allowed = {};

  for (const key of [
    "status",
    "severity",
    "commanderUserId",
    "commanderEmail",
    "rootCause",
    "resolutionSummary"
  ]) {
    if (Object.hasOwn(changes, key)) allowed[key] = changes[key];
  }

  if (!Object.keys(allowed).length) return current;

  const history = Array.isArray(current.activityHistory)
    ? [...current.activityHistory]
    : [];

  history.push({
    activityId: randomUUID(),
    action: "INCIDENT_UPDATED",
    description: `Incident updated: ${Object.keys(allowed).join(", ")}`,
    performedBy: actor?.email || "UNKNOWN",
    createdAt: now
  });

  const expectedVersion = Number(current.version || 0);
  const names = {
    "#version": "version",
    "#updatedAt": "updatedAt",
    "#activityHistory": "activityHistory"
  };

  const values = {
    ":expectedVersion": expectedVersion,
    ":nextVersion": expectedVersion + 1,
    ":updatedAt": now,
    ":history": history
  };

  const sets = [
    "#version = :nextVersion",
    "#updatedAt = :updatedAt",
    "#activityHistory = :history"
  ];

  Object.entries(allowed).forEach(([key, value], index) => {
    names[`#field${index}`] = key;
    values[`:value${index}`] = value;
    sets.push(`#field${index} = :value${index}`);
  });

  await dynamoDB.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { id: current.id },
    UpdateExpression: `SET ${sets.join(", ")}`,
    ConditionExpression: "#version = :expectedVersion",
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values
  }));

  return getIncidentById(id);
}

export function isActiveIncidentStatus(status) {
  return ACTIVE_STATUSES.has(status);
}

export async function setIncidentAffectedTicketCount(id, count) {
  const numericCount = Number(count);

  if (!Number.isSafeInteger(numericCount) || numericCount < 0) {
    throw new Error("Affected ticket count must be a non-negative integer.");
  }

  const current = await getIncidentById(id);
  if (!current) return null;

  const currentCount = Number(current.affectedTicketCount) || 0;

  if (numericCount <= currentCount) {
    return current;
  }

  try {
    await dynamoDB.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { id: current.id },
      UpdateExpression: "SET #affected = :count, #updatedAt = :updatedAt",
      ConditionExpression:
        "#recordType = :incident AND (attribute_not_exists(#affected) OR #affected < :count)",
      ExpressionAttributeNames: {
        "#affected": "affectedTicketCount",
        "#updatedAt": "updatedAt",
        "#recordType": "recordType"
      },
      ExpressionAttributeValues: {
        ":count": numericCount,
        ":updatedAt": new Date().toISOString(),
        ":incident": INCIDENT_TYPE
      }
    }));
  } catch (error) {
    if (error.name !== "ConditionalCheckFailedException") throw error;
    // A concurrent request has already written an equal or higher count.
  }

  return getIncidentById(id);
}
