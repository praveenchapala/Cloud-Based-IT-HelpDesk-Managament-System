import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import {
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";

process.env.AWS_REGION ||= "ap-southeast-2";
process.env.DYNAMODB_TABLE ||= "ResolveITIncidentTests";
process.env.AWS_ACCESS_KEY_ID ||= "test-access-key";
process.env.AWS_SECRET_ACCESS_KEY ||= "test-secret-key";
process.env.AWS_EC2_METADATA_DISABLED = "true";

const [{ dynamoDB }, repository, correlation, { createIncidentRouter }] =
  await Promise.all([
    import("../src/dynamodb.js"),
    import("../src/incidentRepository.js"),
    import("../src/incidentCorrelationService.js"),
    import("../src/routes/incidentRoutes.js")
  ]);

const records = new Map();
const originalSend = dynamoDB.send;

function conditionalFailure() {
  const error = new Error("The conditional request failed.");
  error.name = "ConditionalCheckFailedException";
  return error;
}

function resolveExpression(expression, names, values) {
  const result = {};
  const assignments = expression.replace(/^SET\s+/i, "").split(/\s*,\s*/);
  for (const assignment of assignments) {
    const match = assignment.match(/^([#A-Za-z0-9_]+)\s*=\s*(:[A-Za-z0-9_]+)$/);
    if (!match) continue;
    const field = names[match[1]] || match[1];
    result[field] = structuredClone(values[match[2]]);
  }
  return result;
}

dynamoDB.send = async (command) => {
  const { input } = command;
  const name = command.constructor.name;

  if (name === "GetCommand") {
    const item = records.get(Number(input.Key.id));
    return { Item: item ? structuredClone(item) : undefined };
  }

  if (name === "ScanCommand") {
    let items = [...records.values()];
    const values = input.ExpressionAttributeValues || {};
    const names = input.ExpressionAttributeNames || {};
    if (values[":userType"] === "USER") {
      items = items.filter((item) => item.recordType === "USER");
      if (values[":active"] !== undefined) {
        items = items.filter((item) => item.is_active === values[":active"]);
      }
      if (values[":admin"] !== undefined) {
        items = items.filter((item) => item.role === values[":admin"]);
      }
    } else if (values[":incident"] === "INCIDENT") {
      items = items.filter((item) => item.recordType === "INCIDENT");
    } else if (values[":recordType"] === "NOTIFICATION") {
      items = items.filter((item) =>
        item.recordType === "NOTIFICATION" &&
        item.userId === values[":userId"]
      );
    }
    return { Items: items.map((item) => structuredClone(item)) };
  }

  if (name === "PutCommand") {
    const item = structuredClone(input.Item);
    if (input.ConditionExpression === "attribute_not_exists(id)" && records.has(Number(item.id))) {
      throw conditionalFailure();
    }
    records.set(Number(item.id), item);
    return {};
  }

  if (name === "UpdateCommand") {
    const key = Number(input.Key.id);
    const current = records.get(key);
    if (!current) throw conditionalFailure();

    const values = input.ExpressionAttributeValues || {};
    const names = input.ExpressionAttributeNames || {};
    const condition = input.ConditionExpression || "";

    if (condition.includes("#version = :expectedVersion") &&
        Number(current.version || 0) !== Number(values[":expectedVersion"])) {
      throw conditionalFailure();
    }
    if (condition.includes("attribute_exists(id)") && !records.has(key)) {
      throw conditionalFailure();
    }
    if (condition.includes("attribute_not_exists(#incidentId)") &&
        current.incidentId && current.incidentId !== values[":incidentId"]) {
      throw conditionalFailure();
    }
    if (condition.includes("#recordType = :incident") && current.recordType !== "INCIDENT") {
      throw conditionalFailure();
    }
    if (condition.includes("#userId = :userId") &&
        current.userId !== values[":userId"]) {
      throw conditionalFailure();
    }

    Object.assign(current, resolveExpression(input.UpdateExpression, names, values));
    records.set(key, current);
    return { Attributes: structuredClone(current) };
  }

  throw new Error(`Unexpected DynamoDB command in incident tests: ${name}`);
};

function addTicket(id, {
  title = "VPN network connection unavailable",
  description = "Unable to connect to corporate VPN",
  department = "IT",
  status = "Open",
  createdAt = new Date().toISOString()
} = {}) {
  const item = {
    id,
    recordType: "TICKET",
    title,
    description,
    department,
    status,
    createdAt
  };
  records.set(id, item);
  return item;
}

function addAdmin() {
  records.set(900001, {
    id: 900001,
    recordType: "USER",
    userId: "incident-admin",
    name: "Incident Admin",
    email: "incident-admin@example.test",
    role: "ADMIN",
    is_active: 1
  });
}

function createHttpApp(user) {
  const app = express();
  app.use(express.json());
  app.use("/api/incidents", createIncidentRouter({
    authenticateToken: (req, res, next) => {
      req.user = user;
      next();
    }
  }));
  return app;
}

async function startHttp(user) {
  const app = createHttpApp(user);
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}/api/incidents`
  };
}

beforeEach(() => {
  records.clear();
});

after(() => {
  dynamoDB.send = originalSend;
});

test("four matching open tickets do not create an incident", async () => {
  for (let id = 1; id <= 4; id++) addTicket(id);
  const result = await correlation.evaluateTicketForIncident(records.get(4));
  assert.equal(result, null);
  assert.equal((await repository.scanIncidents()).length, 0);
});

test("five matching tickets within 30 minutes create one detected incident, link tickets, and notify active admins", async () => {
  addAdmin();
  let result;
  for (let id = 1; id <= 5; id++) {
    const ticket = addTicket(id);
    result = await correlation.evaluateTicketForIncident(ticket);
  }

  const incidents = await repository.scanIncidents();
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].status, "DETECTED");
  assert.equal(incidents[0].source, "RULE_ENGINE");
  assert.equal(incidents[0].affectedTicketCount, 5);
  assert.equal(incidents[0].commanderUserId, null);
  assert.ok([...records.values()].filter((item) =>
    item.recordType === "TICKET" && item.incidentId === incidents[0].incidentId
  ).length === 5);
  assert.equal([...records.values()].filter((item) =>
    item.recordType === "NOTIFICATION" &&
    item.userId === "incident-admin" &&
    item.type === "INCIDENT_DETECTED"
  ).length, 1);
  assert.equal(result.incident.incidentId, incidents[0].incidentId);
});

test("resolved and stale tickets do not contribute to the correlation threshold", async () => {
  const stale = new Date(Date.now() - 31 * 60 * 1000).toISOString();
  addTicket(1, { createdAt: stale });
  addTicket(2, { status: "Resolved" });
  addTicket(3, { status: "Closed" });
  addTicket(4);
  addTicket(5);
  const result = await correlation.evaluateTicketForIncident(records.get(5));
  assert.equal(result, null);
  assert.equal((await repository.scanIncidents()).length, 0);
});

test("unrelated categories do not combine to reach the threshold", async () => {
  addTicket(1, { title: "VPN unavailable" });
  addTicket(2, { title: "Outlook email unavailable", description: "Mailbox not loading" });
  addTicket(3, { title: "Laptop hardware failure", description: "Computer will not start" });
  addTicket(4, { title: "Printer queue stuck", description: "Printer cannot print" });
  addTicket(5, { title: "Password login failure", description: "Account locked" });
  const result = await correlation.evaluateTicketForIncident(records.get(5));
  assert.equal(result, null);
  assert.equal((await repository.scanIncidents()).length, 0);
});

test("additional matching tickets reuse the active incident and increase affected count without duplicate notifications", async () => {
  addAdmin();
  for (let id = 1; id <= 5; id++) {
    await correlation.evaluateTicketForIncident(addTicket(id));
  }
  const first = (await repository.scanIncidents())[0];
  await correlation.evaluateTicketForIncident(addTicket(6));
  const incidents = await repository.scanIncidents();
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].incidentId, first.incidentId);
  assert.equal(incidents[0].affectedTicketCount, 6);
  assert.equal([...records.values()].filter((item) =>
    item.recordType === "NOTIFICATION" && item.type === "INCIDENT_DETECTED"
  ).length, 1);
});

test("createOrGetDetectedIncident is idempotent for the same detection key", async () => {
  const payload = {
    detectionKey: "NETWORK_VPN:test-bucket",
    service: "NETWORK_VPN",
    serviceLabel: "Network / VPN",
    title: "Network disruption",
    description: "Five related tickets",
    ticketCount: 5,
    detectedAt: new Date().toISOString()
  };
  const first = await repository.createOrGetDetectedIncident(payload);
  const second = await repository.createOrGetDetectedIncident(payload);
  assert.equal(first.id, second.id);
  assert.equal(first.incidentId, second.incidentId);
  assert.equal(first.status, "DETECTED");
  assert.equal((await repository.scanIncidents()).length, 1);
});

test("invalid incident IDs return null", async () => {
  assert.equal(await repository.getIncidentById("not-a-number"), null);
  assert.equal(await repository.getIncidentById("-1"), null);
});

test("only an administrator can confirm or dismiss a detected incident", async () => {
  const incident = await repository.createOrGetDetectedIncident({
    detectionKey: "NETWORK_VPN:role-test",
    service: "NETWORK_VPN",
    serviceLabel: "Network / VPN",
    title: "Network disruption",
    description: "Review required",
    ticketCount: 5,
    detectedAt: new Date().toISOString()
  });

  const employeeServer = await startHttp({
    id: "employee-1",
    email: "employee@example.test",
    role: "EMPLOYEE"
  });
  try {
    const response = await fetch(`${employeeServer.baseUrl}/${incident.id}/confirm`, { method: "PATCH" });
    assert.equal(response.status, 403);
  } finally {
    employeeServer.server.close();
  }

  const adminServer = await startHttp({
    id: "incident-admin",
    email: "incident-admin@example.test",
    role: "ADMIN"
  });
  try {
    const response = await fetch(`${adminServer.baseUrl}/${incident.id}/confirm`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ severity: "P1" })
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.data.status, "INVESTIGATING");
    assert.equal(body.data.severity, "P1");
    assert.equal(body.data.commanderUserId, "incident-admin");
  } finally {
    adminServer.server.close();
  }
});

test("administrator can dismiss a detected incident and non-admin cannot dismiss it", async () => {
  const incident = await repository.createOrGetDetectedIncident({
    detectionKey: "EMAIL_OUTLOOK:dismiss-test",
    service: "EMAIL_OUTLOOK",
    serviceLabel: "Email / Outlook",
    title: "Email disruption",
    description: "Review required",
    ticketCount: 5,
    detectedAt: new Date().toISOString()
  });

  const supportServer = await startHttp({
    id: "support-1",
    email: "support@example.test",
    role: "SUPPORT_ENGINEER"
  });
  try {
    const response = await fetch(`${supportServer.baseUrl}/${incident.id}/dismiss`, { method: "PATCH" });
    assert.equal(response.status, 403);
  } finally {
    supportServer.server.close();
  }

  const adminServer = await startHttp({
    id: "incident-admin",
    email: "incident-admin@example.test",
    role: "ADMIN"
  });
  try {
    const response = await fetch(`${adminServer.baseUrl}/${incident.id}/dismiss`, { method: "PATCH" });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.data.status, "DISMISSED");
  } finally {
    adminServer.server.close();
  }
});

test("confirming or dismissing an incident twice is rejected", async () => {
  const incident = await repository.createOrGetDetectedIncident({
    detectionKey: "HARDWARE:repeat-confirm",
    service: "HARDWARE",
    serviceLabel: "Hardware",
    title: "Hardware disruption",
    description: "Review required",
    ticketCount: 5,
    detectedAt: new Date().toISOString()
  });
  const adminServer = await startHttp({
    id: "incident-admin",
    email: "incident-admin@example.test",
    role: "ADMIN"
  });
  try {
    const first = await fetch(`${adminServer.baseUrl}/${incident.id}/confirm`, { method: "PATCH" });
    assert.equal(first.status, 200);
    const second = await fetch(`${adminServer.baseUrl}/${incident.id}/confirm`, { method: "PATCH" });
    assert.equal(second.status, 409);
  } finally {
    adminServer.server.close();
  }
});

async function createIncidentAtStatus(status, {
  commanderUserId = "support-1",
  commanderEmail = "support@example.test"
} = {}) {
  const incident = await repository.createOrGetDetectedIncident({
    detectionKey: `NETWORK_VPN:lifecycle-${status}-${Math.random()}`,
    service: "NETWORK_VPN",
    serviceLabel: "Network / VPN",
    title: "Network disruption",
    description: "Lifecycle test incident",
    ticketCount: 5,
    detectedAt: new Date().toISOString()
  });

  return repository.updateIncident(
    incident.id,
    {
      status,
      commanderUserId,
      commanderEmail
    },
    {
      id: commanderUserId,
      email: commanderEmail,
      role: "ADMIN"
    }
  );
}

test("assigned support engineer can move INVESTIGATING to IDENTIFIED", async () => {
  const incident = await createIncidentAtStatus("INVESTIGATING");

  const server = await startHttp({
    id: "support-1",
    email: "support@example.test",
    role: "SUPPORT_ENGINEER"
  });

  try {
    const response = await fetch(`${server.baseUrl}/${incident.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "IDENTIFIED" })
    });

    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.status, "IDENTIFIED");
  } finally {
    server.server.close();
  }
});

test("INVESTIGATING cannot jump directly to CLOSED", async () => {
  const incident = await createIncidentAtStatus("INVESTIGATING");

  const server = await startHttp({
    id: "support-1",
    email: "support@example.test",
    role: "SUPPORT_ENGINEER"
  });

  try {
    const response = await fetch(`${server.baseUrl}/${incident.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "CLOSED" })
    });

    assert.equal(response.status, 409);

    const updated = await repository.getIncidentById(incident.id);
    assert.equal(updated.status, "INVESTIGATING");
  } finally {
    server.server.close();
  }
});

test("DETECTED cannot bypass administrator confirmation through generic PATCH", async () => {
  const incident = await createIncidentAtStatus("DETECTED");

  const server = await startHttp({
    id: "incident-admin",
    email: "incident-admin@example.test",
    role: "ADMIN"
  });

  try {
    const response = await fetch(`${server.baseUrl}/${incident.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "IDENTIFIED" })
    });

    assert.equal(response.status, 409);

    const updated = await repository.getIncidentById(incident.id);
    assert.equal(updated.status, "DETECTED");
  } finally {
    server.server.close();
  }
});

test("DISMISSED incidents cannot be modified", async () => {
  const incident = await createIncidentAtStatus("DISMISSED");

  const server = await startHttp({
    id: "incident-admin",
    email: "incident-admin@example.test",
    role: "ADMIN"
  });

  try {
    const response = await fetch(`${server.baseUrl}/${incident.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rootCause: "False positive" })
    });

    assert.equal(response.status, 409);
  } finally {
    server.server.close();
  }
});

test("CLOSED incidents cannot be modified", async () => {
  const incident = await createIncidentAtStatus("CLOSED");

  const server = await startHttp({
    id: "incident-admin",
    email: "incident-admin@example.test",
    role: "ADMIN"
  });

  try {
    const response = await fetch(`${server.baseUrl}/${incident.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rootCause: "Completed investigation" })
    });

    assert.equal(response.status, 409);
  } finally {
    server.server.close();
  }
});

test("employee cannot update an incident", async () => {
  const incident = await createIncidentAtStatus("INVESTIGATING");

  const server = await startHttp({
    id: "employee-1",
    email: "employee@example.test",
    role: "EMPLOYEE"
  });

  try {
    const response = await fetch(`${server.baseUrl}/${incident.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "IDENTIFIED" })
    });

    assert.equal(response.status, 403);
  } finally {
    server.server.close();
  }
});

test("invalid severity returns HTTP 400", async () => {
  const incident = await createIncidentAtStatus("INVESTIGATING");

  const server = await startHttp({
    id: "incident-admin",
    email: "incident-admin@example.test",
    role: "ADMIN"
  });

  try {
    const response = await fetch(`${server.baseUrl}/${incident.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ severity: "P0" })
    });

    assert.equal(response.status, 400);
  } finally {
    server.server.close();
  }
});

test("root cause exceeding 2000 characters returns HTTP 400", async () => {
  const incident = await createIncidentAtStatus("INVESTIGATING");

  const server = await startHttp({
    id: "incident-admin",
    email: "incident-admin@example.test",
    role: "ADMIN"
  });

  try {
    const response = await fetch(`${server.baseUrl}/${incident.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rootCause: "A".repeat(2001) })
    });

    assert.equal(response.status, 400);
  } finally {
    server.server.close();
  }
});
