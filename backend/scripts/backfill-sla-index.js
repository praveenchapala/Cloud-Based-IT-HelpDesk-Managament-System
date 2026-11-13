import "dotenv/config";
import { ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { dynamoDB, TABLE_NAME } from "../src/dynamodb.js";
import { getNextSlaActionAt } from "../src/slaSchedulerService.js";

const policies = {
  Critical: { responseMinutes: 15, resolutionMinutes: 240 },
  High: { responseMinutes: 60, resolutionMinutes: 480 },
  Medium: { responseMinutes: 240, resolutionMinutes: 1440 },
  Low: { responseMinutes: 480, resolutionMinutes: 4320 }
};

const PAGE_SIZE = Math.max(1, Number(process.env.SLA_BACKFILL_PAGE_SIZE || 10));
const BASE_DELAY_MS = Math.max(100, Number(process.env.SLA_BACKFILL_DELAY_MS || 500));
const MAX_RETRIES = Math.max(1, Number(process.env.SLA_BACKFILL_MAX_RETRIES || 8));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isThrottleError(error) {
  return [
    "ProvisionedThroughputExceededException",
    "ThrottlingException",
    "RequestLimitExceeded",
    "InternalServerError"
  ].includes(error?.name) ||
    error?.$metadata?.httpStatusCode === 429 ||
    error?.$metadata?.httpStatusCode >= 500;
}

async function sendWithRetry(command, label) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await dynamoDB.send(command);
    } catch (error) {
      if (!isThrottleError(error) || attempt >= MAX_RETRIES) {
        error.message = `${label} failed after ${attempt + 1} attempt(s): ${error.message}`;
        throw error;
      }
      const exponential = Math.min(BASE_DELAY_MS * (2 ** attempt), 15000);
      const jitter = Math.floor(Math.random() * Math.max(100, exponential * 0.25));
      const waitMs = exponential + jitter;
      console.warn(JSON.stringify({
        event: "sla_backfill_throttled_retry",
        operation: label,
        attempt: attempt + 1,
        waitMs,
        errorName: error.name
      }));
      await sleep(waitMs);
    }
  }
}

function isTicket(item) {
  if (!item || item.recordType === "USER" || item.recordType === "NOTIFICATION") return false;
  return item.recordType === "TICKET" || (
    typeof item.title === "string" && typeof item.description === "string" &&
    typeof item.status === "string" && typeof item.priority === "string"
  );
}

function normalizeTicket(ticket) {
  const createdAt = ticket.createdAt || (ticket.date ? `${ticket.date}T00:00:00.000Z` : null);
  const policy = ticket.slaPolicy || policies[ticket.priority];
  if (!createdAt || !policy) return ticket;
  const createdMs = new Date(createdAt).getTime();
  if (!Number.isFinite(createdMs)) return ticket;
  const pauseMs = Number(ticket.slaPausedTotalMs || 0);
  const pausedAt = ticket.status === "Waiting for User" && ticket.slaPausedAt
    ? new Date(ticket.slaPausedAt).getTime() - createdMs
    : 0;
  return {
    ...ticket,
    createdAt,
    slaPolicy: policy,
    slaResponseDueAt: ticket.slaResponseDueAt || new Date(createdMs + policy.responseMinutes * 60000 + pauseMs + Math.max(0, pausedAt)).toISOString(),
    slaResolutionDueAt: ticket.slaResolutionDueAt || new Date(createdMs + policy.resolutionMinutes * 60000 + pauseMs + Math.max(0, pausedAt)).toISOString()
  };
}

let lastEvaluatedKey;
let scanned = 0;
let updated = 0;
let skipped = 0;
let pages = 0;

console.log(JSON.stringify({
  event: "sla_index_backfill_started",
  table: TABLE_NAME,
  pageSize: PAGE_SIZE,
  delayBetweenWritesMs: BASE_DELAY_MS,
  maxRetries: MAX_RETRIES
}));

do {
  const page = await sendWithRetry(new ScanCommand({
    TableName: TABLE_NAME,
    Limit: PAGE_SIZE,
    ...(lastEvaluatedKey ? { ExclusiveStartKey: lastEvaluatedKey } : {})
  }), "scan");
  pages++;

  for (const item of page.Items || []) {
    scanned++;
    if (!isTicket(item)) { skipped++; continue; }

    const ticket = normalizeTicket(item);
    if (!ticket.createdAt || !ticket.slaPolicy || !ticket.slaResponseDueAt || !ticket.slaResolutionDueAt) {
      skipped++;
      continue;
    }

    const nextDeadlineAt = getNextSlaActionAt(ticket);
    const names = {
      "#pk": "openSlaPk",
      "#next": "nextDeadlineAt",
      "#createdAt": "createdAt",
      "#responseDue": "slaResponseDueAt",
      "#resolutionDue": "slaResolutionDueAt",
      "#policy": "slaPolicy"
    };
    const values = {
      ":createdAt": ticket.createdAt,
      ":responseDue": ticket.slaResponseDueAt,
      ":resolutionDue": ticket.slaResolutionDueAt,
      ":policy": ticket.slaPolicy
    };

    let updateExpression;
    if (nextDeadlineAt) {
      values[":active"] = "ACTIVE";
      values[":nextAt"] = nextDeadlineAt;
      updateExpression = "SET #pk = :active, #next = :nextAt, #createdAt = if_not_exists(#createdAt, :createdAt), #responseDue = if_not_exists(#responseDue, :responseDue), #resolutionDue = if_not_exists(#resolutionDue, :resolutionDue), #policy = if_not_exists(#policy, :policy)";
    } else {
      updateExpression = "SET #createdAt = if_not_exists(#createdAt, :createdAt), #responseDue = if_not_exists(#responseDue, :responseDue), #resolutionDue = if_not_exists(#resolutionDue, :resolutionDue), #policy = if_not_exists(#policy, :policy) REMOVE #pk, #next";
    }

    await sendWithRetry(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { id: item.id },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ConditionExpression: "attribute_exists(#id)",
      ExpressionAttributeNames: { ...names, "#id": "id" }
    }), "update-ticket");

    updated++;
    await sleep(BASE_DELAY_MS);
  }

  console.log(JSON.stringify({ event: "sla_index_backfill_progress", pages, scanned, updated, skipped }));
  lastEvaluatedKey = page.LastEvaluatedKey;
} while (lastEvaluatedKey);

console.log(JSON.stringify({ event: "sla_index_backfill_complete", scanned, updated, skipped, pages }));
