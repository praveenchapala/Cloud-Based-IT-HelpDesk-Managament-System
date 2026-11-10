
import {
  test,
  before,
  beforeEach,
  after
} from "node:test";

import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { once } from "node:events";

import {
  mkdtempSync,
  rmSync
} from "node:fs";

import path from "node:path";
import os from "node:os";

// --------------------------------------------------
// TEST ENVIRONMENT
// --------------------------------------------------

const testDirectory = mkdtempSync(
  path.join(os.tmpdir(), "resolveit-tests-")
);

process.env.RESOLVEIT_DB_PATH = path.join(
  testDirectory,
  "resolveit-test.db"
);

process.env.JWT_SECRET = "resolveit-test-secret";
process.env.AWS_REGION = "ap-southeast-2";
process.env.DYNAMODB_TABLE = "ResolveITTestTable";
process.env.AWS_ACCESS_KEY_ID = "test-access-key";
process.env.AWS_SECRET_ACCESS_KEY = "test-secret-key";
process.env.AWS_EC2_METADATA_DISABLED = "true";

// Import after setting test environment variables.
const [
  { default: app },
  { default: db },
  { dynamoDB }
] = await Promise.all([
  import("../src/server.js"),
  import("../src/database.js"),
  import("../src/dynamodb.js")
]);

// --------------------------------------------------
// TEST USERS
// --------------------------------------------------

const users = {
  employeeA: {
    id: "test-employee-a",
    name: "Employee A",
    email: "employee-a@test.com",
    role: "EMPLOYEE"
  },

  employeeB: {
    id: "test-employee-b",
    name: "Employee B",
    email: "employee-b@test.com",
    role: "EMPLOYEE"
  },

  supportA: {
    id: "test-support-a",
    name: "Support Engineer A",
    email: "support-a@test.com",
    role: "SUPPORT_ENGINEER"
  },

  supportB: {
    id: "test-support-b",
    name: "Support Engineer B",
    email: "support-b@test.com",
    role: "SUPPORT_ENGINEER"
  },

  admin: {
    id: "test-admin",
    name: "Test Admin",
    email: "admin@test.com",
    role: "ADMIN"
  }
};

// --------------------------------------------------
// TEST TICKET
// --------------------------------------------------

const ticketId = 1001;

const originalTicket = {
  id: ticketId,
  title: "Test access control ticket",
  employee: "Employee B",
  createdByUserId: users.employeeB.id,
  createdByEmail: users.employeeB.email,
  department: "IT",
  priority: "Medium",
  status: "Open",
  description: "Automated security test ticket",
  assignedTo: users.supportB.email,
  assignedAt: null,
  assignmentStatus: "Assigned",
  activityHistory: []
};

let tickets = new Map();

// --------------------------------------------------
// MOCK DYNAMODB
// --------------------------------------------------

// Save the original AWS SDK method.
const originalSend = dynamoDB.send;

// Replace AWS requests with an in-memory mock.
// No request reaches AWS.

dynamoDB.send = async (command) => {
  const commandName = command.constructor.name;
  const input = command.input;

  switch (commandName) {
    case "GetCommand": {
      const ticket = tickets.get(input.Key.id);

      return {
        Item: ticket ? structuredClone(ticket) : undefined
      };
    }

    case "ScanCommand": {
      return {
        Items: Array.from(tickets.values()).map(
          ticket => structuredClone(ticket)
        )
      };
    }

    case "PutCommand": {
      tickets.set(
        input.Item.id,
        structuredClone(input.Item)
      );

      return {};
    }

    case "DeleteCommand": {
      tickets.delete(input.Key.id);
      return {};
    }

    default:
      throw new Error(
        `Unexpected DynamoDB command: ${commandName}`
      );
  }
};

// --------------------------------------------------
// AUTHENTICATION HELPERS
// --------------------------------------------------

function createToken(user) {
  return jwt.sign(
    { role: user.role },
    process.env.JWT_SECRET,
    {
      subject: user.id,
      expiresIn: "1h",
      algorithm: "HS256"
    }
  );
}

const tokens = {};

for (const [key, user] of Object.entries(users)) {
  tokens[key] = createToken(user);
}

async function apiRequest(
  method,
  endpoint,
  token,
  body
) {
  const options = {
    method,
    headers: {}
  };

  if (token) {
    options.headers.Authorization = `Bearer ${token}`;
  }

  if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  return fetch(`${baseUrl}${endpoint}`, options);
}

// --------------------------------------------------
// SERVER AND DATABASE SETUP
// --------------------------------------------------

let server;
let baseUrl;

before(async () => {
  // Insert test users into isolated SQLite database.
  const insertUser = db.prepare(`
    INSERT INTO users (
      id,
      name,
      email,
      password_hash,
      role,
      is_active
    )
    VALUES (?, ?, ?, ?, ?, 1)
  `);

  for (const user of Object.values(users)) {
    insertUser.run(
      user.id,
      user.name,
      user.email,
      "test-password-hash",
      user.role
    );
  }

  // Start Express on a temporary port.
  server = app.listen(0);

  await once(server, "listening");

  const address = server.address();

  baseUrl = `http://127.0.0.1:${address.port}`;
});

// Reset test data before each test.
beforeEach(() => {
  tickets.clear();

  tickets.set(
    ticketId,
    structuredClone(originalTicket)
  );
});

// --------------------------------------------------
// SECURITY TEST 1
// EMPLOYEE CANNOT ACCESS ANOTHER EMPLOYEE'S TICKET
// --------------------------------------------------

test(
  "Employee cannot access another employee's ticket",
  async () => {
    const response = await apiRequest(
      "GET",
      `/api/tickets/${ticketId}`,
      tokens.employeeA
    );

    const result = await response.json();

    assert.equal(response.status, 403);

    assert.equal(
      result.message,
      "You do not have permission to access this ticket."
    );
  }
);

// --------------------------------------------------
// SECURITY TEST 2
// ENGINEER CANNOT ACCESS ANOTHER ENGINEER'S TICKET
// --------------------------------------------------

test(
  "Support Engineer A cannot access Engineer B's ticket",
  async () => {
    const response = await apiRequest(
      "GET",
      `/api/tickets/${ticketId}`,
      tokens.supportA
    );

    const result = await response.json();

    assert.equal(response.status, 403);

    assert.equal(
      result.message,
      "You do not have permission to access this ticket."
    );
  }
);

// --------------------------------------------------
// SECURITY TEST 3
// ASSIGNED ENGINEER CAN ACCESS TICKET
// --------------------------------------------------

test(
  "Assigned Support Engineer can access their ticket",
  async () => {
    const response = await apiRequest(
      "GET",
      `/api/tickets/${ticketId}`,
      tokens.supportB
    );

    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.success, true);
    assert.equal(result.data.id, ticketId);
    assert.equal(
      result.data.assignedTo,
      users.supportB.email
    );
  }
);

// --------------------------------------------------
// SECURITY TEST 4
// EMPLOYEE CANNOT UPDATE TICKET STATUS
// --------------------------------------------------

test(
  "Employee cannot update ticket status",
  async () => {
    const response = await apiRequest(
      "PUT",
      `/api/tickets/${ticketId}`,
      tokens.employeeA,
      {
        status: "Resolved"
      }
    );

    const result = await response.json();

    assert.equal(response.status, 403);

    assert.equal(
      result.message,
      "You do not have permission to perform this action."
    );
  }
);

// --------------------------------------------------
// SECURITY TEST 5
// SUPPORT ENGINEER CANNOT CHANGE TITLE
// --------------------------------------------------

test(
  "Support Engineer cannot update ticket title",
  async () => {
    const response = await apiRequest(
      "PUT",
      `/api/tickets/${ticketId}`,
      tokens.supportB,
      {
        title: "Unauthorized title change"
      }
    );

    const result = await response.json();

    assert.equal(response.status, 400);

    assert.equal(
      result.message,
      "Field 'title' cannot be updated"
    );
  }
);

// --------------------------------------------------
// SECURITY TEST 6
// ONLY ADMIN CAN ASSIGN TICKETS
// --------------------------------------------------

test(
  "Support Engineer cannot assign a ticket",
  async () => {
    const response = await apiRequest(
      "PUT",
      `/api/tickets/${ticketId}/assign`,
      tokens.supportB,
      {
        assignedTo: users.supportA.email
      }
    );

    const result = await response.json();

    assert.equal(response.status, 403);

    assert.equal(
      result.message,
      "You do not have permission to perform this action."
    );
  }
);

// --------------------------------------------------
// SECURITY TEST 7
// ONLY ADMIN CAN DELETE TICKETS
// --------------------------------------------------

test(
  "Support Engineer cannot delete a ticket",
  async () => {
    const response = await apiRequest(
      "DELETE",
      `/api/tickets/${ticketId}`,
      tokens.supportB
    );

    const result = await response.json();

    assert.equal(response.status, 403);

    assert.equal(
      result.message,
      "You do not have permission to perform this action."
    );

    // Verify the ticket still exists.
    assert.equal(tickets.has(ticketId), true);
  }
);

// --------------------------------------------------
// SECURITY TEST 8
// USERS CANNOT MODIFY ANOTHER USER'S NOTIFICATIONS
// --------------------------------------------------

test(
  "Employee cannot mark another employee's notification as read",
  async () => {
    const notificationId = "test-notification-b";

    db.prepare(`
      INSERT INTO notifications (
        id,
        user_id,
        ticket_id,
        type,
        title,
        message
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      notificationId,
      users.employeeB.id,
      String(ticketId),
      "STATUS_CHANGED",
      "Ticket updated",
      "Your ticket status was changed."
    );

    const response = await apiRequest(
      "PATCH",
      `/api/notifications/${notificationId}/read`,
      tokens.employeeA
    );

    const result = await response.json();

    assert.equal(response.status, 404);

    assert.equal(
      result.message,
      "Notification not found"
    );

    // Confirm the other user's notification remains unread.
    const notification = db.prepare(`
      SELECT is_read
      FROM notifications
      WHERE id = ?
    `).get(notificationId);

    assert.equal(notification.is_read, 0);
  }
);

// --------------------------------------------------
// AUTHENTICATION AND TICKET LIFECYCLE TESTS
// --------------------------------------------------

const registeredEmail = "new-employee@test.com";
const registeredPassword = "TestPassword123";

// TEST 9: Registration rejects invalid email.

test(
  "Registration rejects an invalid email address",
  async () => {
    const response = await apiRequest(
      "POST",
      "/api/auth/register",
      null,
      {
        name: "New Employee",
        email: "invalid-email",
        password: registeredPassword
      }
    );

    const result = await response.json();

    assert.equal(response.status, 400);
    assert.equal(
      result.message,
      "Please provide a valid email address"
    );
  }
);

// TEST 10: Public registration cannot create an Admin.

test(
  "Public registration always creates an Employee",
  async () => {
    const response = await apiRequest(
      "POST",
      "/api/auth/register",
      null,
      {
        name: "New Employee",
        email: registeredEmail,
        password: registeredPassword,
        role: "ADMIN"
      }
    );

    const result = await response.json();

    assert.equal(response.status, 201);
    assert.equal(result.success, true);
    assert.equal(result.data.role, "EMPLOYEE");
    assert.equal(result.data.email, registeredEmail);
  }
);

// TEST 11: Duplicate registration is rejected.

test(
  "Registration rejects an existing email address",
  async () => {
    const response = await apiRequest(
      "POST",
      "/api/auth/register",
      null,
      {
        name: "Duplicate Employee",
        email: registeredEmail,
        password: registeredPassword
      }
    );

    const result = await response.json();

    assert.equal(response.status, 409);
    assert.equal(
      result.message,
      "An account with this email already exists"
    );
  }
);

// TEST 12: Login succeeds with valid credentials.

test(
  "Login succeeds with valid credentials",
  async () => {
    const response = await apiRequest(
      "POST",
      "/api/auth/login",
      null,
      {
        email: registeredEmail.toUpperCase(),
        password: registeredPassword
      }
    );

    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.success, true);
    assert.ok(result.data.token);
    assert.equal(result.data.user.email, registeredEmail);
    assert.equal(result.data.user.role, "EMPLOYEE");
  }
);

// TEST 13: Login rejects an incorrect password.

test(
  "Login rejects an incorrect password",
  async () => {
    const response = await apiRequest(
      "POST",
      "/api/auth/login",
      null,
      {
        email: registeredEmail,
        password: "WrongPassword123"
      }
    );

    const result = await response.json();

    assert.equal(response.status, 401);
    assert.equal(
      result.message,
      "Invalid email or password"
    );
  }
);

// TEST 14: Protected routes reject missing and invalid JWTs.

test(
  "Protected ticket routes reject missing and invalid tokens",
  async () => {
    const missingTokenResponse = await apiRequest(
      "GET",
      "/api/tickets",
      null
    );

    const missingTokenResult =
      await missingTokenResponse.json();

    assert.equal(missingTokenResponse.status, 401);
    assert.equal(
      missingTokenResult.message,
      "Access denied. Please provide an authentication token."
    );

    const invalidTokenResponse = await apiRequest(
      "GET",
      "/api/tickets",
      "invalid.jwt.token"
    );

    const invalidTokenResult =
      await invalidTokenResponse.json();

    assert.equal(invalidTokenResponse.status, 401);
    assert.equal(
      invalidTokenResult.message,
      "Invalid authentication token."
    );
  }
);

// TEST 15: Ticket creation uses authenticated user identity.

test(
  "Ticket creation ignores forged requester identity",
  async () => {
    const response = await apiRequest(
      "POST",
      "/api/tickets",
      tokens.employeeA,
      {
        title: "Laptop not working",
        department: "IT",
        priority: "High",
        description: "Laptop does not start.",

        // These values must not override the logged-in user.
        employee: "Fake Admin",
        createdByUserId: users.admin.id,
        createdByEmail: users.admin.email,
        assignedTo: users.supportA.email
      }
    );

    const result = await response.json();

    assert.equal(response.status, 201);
    assert.equal(result.success, true);

    assert.equal(
      result.data.createdByUserId,
      users.employeeA.id
    );

    assert.equal(
      result.data.createdByEmail,
      users.employeeA.email
    );

    assert.equal(
      result.data.employee,
      users.employeeA.name
    );

    assert.equal(result.data.assignedTo, null);

    // Confirm the ticket was stored in mocked DynamoDB.
    assert.equal(
      tickets.has(result.data.id),
      true
    );
  }
);

// TEST 16: Assigned engineer can update ticket status.

test(
  "Assigned Support Engineer can update ticket status",
  async () => {
    const response = await apiRequest(
      "PUT",
      `/api/tickets/${ticketId}`,
      tokens.supportB,
      {
        status: "In Progress"
      }
    );

    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.success, true);
    assert.equal(result.data.status, "In Progress");

    // Verify the updated ticket in mocked DynamoDB.
    const savedTicket = tickets.get(ticketId);

    assert.equal(savedTicket.status, "In Progress");

    // Verify that the requester received a notification.
    const notification = db.prepare(`
      SELECT *
      FROM notifications
      WHERE user_id = ?
        AND ticket_id = ?
        AND type = 'STATUS_CHANGED'
        AND title = 'Ticket status updated'
    `).get(
      users.employeeB.id,
      String(ticketId)
    );

    assert.ok(notification);
  }
);

// --------------------------------------------------
// NOTIFICATION API TESTS
// --------------------------------------------------

function insertTestNotification({
  id,
  userId,
  ticketId = "1001",
  isRead = 0
}) {
  db.prepare(`
    INSERT INTO notifications (
      id,
      user_id,
      ticket_id,
      type,
      title,
      message,
      is_read
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    userId,
    String(ticketId),
    "TEST_NOTIFICATION",
    "Test notification",
    "Notification API automated test",
    isRead
  );
}

// TEST 17: Users can retrieve only their own notifications.

test(
  "User can retrieve only their own notifications",
  async () => {
    const employeeANotification = "notification-get-employee-a";
    const employeeBNotification = "notification-get-employee-b";

    insertTestNotification({
      id: employeeANotification,
      userId: users.employeeA.id
    });

    insertTestNotification({
      id: employeeBNotification,
      userId: users.employeeB.id
    });

    const response = await apiRequest(
      "GET",
      "/api/notifications",
      tokens.employeeA
    );

    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.success, true);

    const returnedIds = result.data.map(item => item.id);

    assert.ok(returnedIds.includes(employeeANotification));

    assert.ok(
      !returnedIds.includes(employeeBNotification)
    );

    assert.equal(result.count, result.data.length);

    const expectedUnreadCount = db.prepare(`
      SELECT COUNT(*) AS count
      FROM notifications
      WHERE user_id = ?
        AND is_read = 0
    `).get(users.employeeA.id).count;

    assert.equal(
      result.unreadCount,
      expectedUnreadCount
    );
  }
);

// TEST 18: User can mark their own notification as read.

test(
  "User can mark their own notification as read",
  async () => {
    const notificationId = "notification-mark-own-read";

    insertTestNotification({
      id: notificationId,
      userId: users.employeeA.id
    });

    const response = await apiRequest(
      "PATCH",
      `/api/notifications/${notificationId}/read`,
      tokens.employeeA
    );

    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.success, true);

    assert.equal(
      result.message,
      "Notification marked as read"
    );

    const savedNotification = db.prepare(`
      SELECT is_read
      FROM notifications
      WHERE id = ?
    `).get(notificationId);

    assert.equal(savedNotification.is_read, 1);
  }
);

// TEST 19: User can mark all their notifications as read.

test(
  "Mark all notifications as read updates only the current user's records",
  async () => {
    const employeeANotification1 = "notification-read-all-a1";
    const employeeANotification2 = "notification-read-all-a2";
    const employeeBNotification = "notification-read-all-b1";

    insertTestNotification({
      id: employeeANotification1,
      userId: users.employeeA.id
    });

    insertTestNotification({
      id: employeeANotification2,
      userId: users.employeeA.id
    });

    insertTestNotification({
      id: employeeBNotification,
      userId: users.employeeB.id
    });

    const expectedUpdatedCount = db.prepare(`
      SELECT COUNT(*) AS count
      FROM notifications
      WHERE user_id = ?
        AND is_read = 0
    `).get(users.employeeA.id).count;

    const response = await apiRequest(
      "PATCH",
      "/api/notifications/read-all",
      tokens.employeeA
    );

    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.success, true);

    assert.equal(
      result.message,
      "All notifications marked as read"
    );

    assert.equal(
      result.updatedCount,
      expectedUpdatedCount
    );

    // Employee A's notifications must now be read.
    const employeeAUnreadCount = db.prepare(`
      SELECT COUNT(*) AS count
      FROM notifications
      WHERE user_id = ?
        AND is_read = 0
    `).get(users.employeeA.id).count;

    assert.equal(employeeAUnreadCount, 0);

    // Employee B's notification must remain unread.
    const employeeBNotificationRecord = db.prepare(`
      SELECT is_read
      FROM notifications
      WHERE id = ?
    `).get(employeeBNotification);

    assert.equal(
      employeeBNotificationRecord.is_read,
      0
    );
  }
);

// TEST 20: Unauthenticated users cannot access notifications.

test(
  "Unauthenticated user cannot access notifications",
  async () => {
    const response = await apiRequest(
      "GET",
      "/api/notifications",
      null
    );

    const result = await response.json();

    assert.equal(response.status, 401);
    assert.equal(
      result.message,
      "Access denied. Please provide an authentication token."
    );
  }
);

// --------------------------------------------------
// TICKET ASSIGNMENT VALIDATION TESTS
// --------------------------------------------------

// TEST 27: Admin can assign a ticket to an active Support Engineer.

test(
  "Admin can assign a ticket to an active Support Engineer",
  async () => {
        // Simulate a ticket that has not been assigned yet.
    tickets.set(1001, {
      ...tickets.get(1001),
      assignedTo: null,
      assignedAt: null,
      assignmentStatus: "Unassigned"
    });
    const response = await apiRequest(
      "PUT",
      "/api/tickets/1001/assign",
      tokens.admin,
      {
        assignedTo: users.supportA.email
      }
    );

    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.success, true);
    assert.equal(result.data.assignedTo, users.supportA.email);
    assert.equal(result.data.assignmentStatus, "Assigned");

    const savedTicket = tickets.get(1001);

    assert.equal(savedTicket.assignedTo, users.supportA.email);

    const notification = db.prepare(`
      SELECT *
      FROM notifications
      WHERE user_id = ?
        AND ticket_id = ?
        AND type = 'TICKET_ASSIGNED'
    `).get(users.supportA.id, "1001");

    assert.ok(notification);
  }
);

// TEST 28: Admin cannot assign a ticket to an Employee.

test(
  "Admin cannot assign a ticket to an Employee",
  async () => {
    const response = await apiRequest(
      "PUT",
      "/api/tickets/1001/assign",
      tokens.admin,
      {
        assignedTo: users.employeeA.email
      }
    );

    const result = await response.json();

    assert.equal(response.status, 400);
    assert.equal(result.success, false);

    assert.equal(
      result.message,
      "The selected active support engineer does not exist."
    );

    assert.equal(
      tickets.get(1001).assignedTo,
      users.supportB.email
    );
  }
);

// TEST 29: Admin cannot assign a ticket to an inactive Support Engineer.

test(
  "Admin cannot assign a ticket to an inactive Support Engineer",
  async () => {
    const inactiveEngineer = {
      id: "inactive-support-engineer",
      name: "Inactive Engineer",
      email: "inactive.engineer@test.com"
    };

    db.prepare(`
      INSERT INTO users (
        id,
        name,
        email,
        password_hash,
        role,
        is_active
      )
      VALUES (?, ?, ?, ?, 'SUPPORT_ENGINEER', 0)
    `).run(
      inactiveEngineer.id,
      inactiveEngineer.name,
      inactiveEngineer.email,
      "test-password-hash"
    );

    try {
      const response = await apiRequest(
        "PUT",
        "/api/tickets/1001/assign",
        tokens.admin,
        {
          assignedTo: inactiveEngineer.email
        }
      );

      const result = await response.json();

      assert.equal(response.status, 400);
      assert.equal(result.success, false);

      assert.equal(
        result.message,
        "The selected active support engineer does not exist."
      );

      assert.equal(
        tickets.get(1001).assignedTo,
        users.supportB.email
      );
    } finally {
      db.prepare(`
        DELETE FROM users WHERE id = ?
      `).run(inactiveEngineer.id);
    }
  }
);

// TEST 30: Admin cannot assign a ticket to a nonexistent engineer.

test(
  "Admin cannot assign a ticket to a nonexistent engineer",
  async () => {
    const response = await apiRequest(
      "PUT",
      "/api/tickets/1001/assign",
      tokens.admin,
      {
        assignedTo: "unknown.engineer@test.com"
      }
    );

    const result = await response.json();

    assert.equal(response.status, 400);
    assert.equal(result.success, false);

    assert.equal(
      result.message,
      "The selected active support engineer does not exist."
    );
  }
);

// TEST 31: Admin cannot assign a ticket using an unrecognized identifier.

test(
  "Admin cannot assign a ticket using an unrecognized identifier",
  async () => {
    const response = await apiRequest(
      "PUT",
      "/api/tickets/1001/assign",
      tokens.admin,
      {
        assignedTo: "not-a-valid-engineer"
      }
    );

    const result = await response.json();

    assert.equal(response.status, 400);
    assert.equal(result.success, false);
  }
);

// TEST 32: Admin cannot assign a nonexistent ticket.

test(
  "Admin cannot assign a nonexistent ticket",
  async () => {
    const response = await apiRequest(
      "PUT",
      "/api/tickets/9999/assign",
      tokens.admin,
      {
        assignedTo: users.supportA.email
      }
    );

    const result = await response.json();

    assert.equal(response.status, 404);
    assert.equal(result.success, false);
    assert.equal(result.message, "Ticket not found");
  }
);

// TEST 33: Reassignment transfers ticket access to the new engineer.

test(
  "Reassignment gives access to the new engineer and removes old engineer access",
  async () => {
    // Initially, ticket 1001 belongs to Support Engineer B.
    assert.equal(
      tickets.get(1001).assignedTo,
      users.supportB.email
    );

    const assignmentResponse = await apiRequest(
      "PUT",
      "/api/tickets/1001/assign",
      tokens.admin,
      {
        assignedTo: users.supportA.email
      }
    );

    const assignmentResult =
      await assignmentResponse.json();

    assert.equal(assignmentResponse.status, 200);
    assert.equal(assignmentResult.success, true);
    assert.equal(
      assignmentResult.data.assignedTo,
      users.supportA.email
    );

    // New engineer should now access the ticket.
    const newEngineerResponse = await apiRequest(
      "GET",
      "/api/tickets/1001",
      tokens.supportA
    );

    assert.equal(newEngineerResponse.status, 200);

    // Previous engineer should lose access.
    const previousEngineerResponse = await apiRequest(
      "GET",
      "/api/tickets/1001",
      tokens.supportB
    );

    assert.equal(previousEngineerResponse.status, 403);

    // Verify reassignment notification.
    const notification = db.prepare(`
      SELECT *
      FROM notifications
      WHERE user_id = ?
        AND ticket_id = ?
        AND type = 'TICKET_REASSIGNED'
    `).get(users.supportA.id, "1001");

    assert.ok(notification);
  }
);


// --------------------------------------------------
// CLEANUP
// --------------------------------------------------

// --------------------------------------------------
// TICKET API EDGE-CASE TESTS
// --------------------------------------------------

// TEST 21: Ticket creation rejects missing required fields.

test(
  "Ticket creation rejects missing required fields",
  async () => {
    const response = await apiRequest(
      "POST",
      "/api/tickets",
      tokens.employeeA,
      {
        title: "Laptop issue"
      }
    );

    const result = await response.json();

    assert.equal(response.status, 400);
    assert.equal(result.success, false);
    assert.equal(
      result.message,
      "Title, department and description are required"
    );
  }
);

// TEST 22: Ticket creation rejects a title exceeding 100 characters.

test(
  "Ticket creation rejects a title exceeding the allowed length",
  async () => {
    const response = await apiRequest(
      "POST",
      "/api/tickets",
      tokens.employeeA,
      {
        title: "T".repeat(101),
        department: "IT",
        description: "Laptop is not working",
        priority: "High"
      }
    );

    const result = await response.json();

    assert.equal(response.status, 400);
    assert.equal(result.success, false);
    assert.equal(
      result.message,
      "One or more fields exceed the allowed length"
    );
  }
);

// TEST 23: Ticket creation rejects invalid priority.

test(
  "Ticket creation rejects an invalid priority",
  async () => {
    const response = await apiRequest(
      "POST",
      "/api/tickets",
      tokens.employeeA,
      {
        title: "Laptop issue",
        department: "IT",
        description: "Laptop is not working",
        priority: "Urgent"
      }
    );

    const result = await response.json();

    assert.equal(response.status, 400);
    assert.equal(result.success, false);
    assert.equal(result.message, "Invalid priority");
  }
);

// TEST 24: Ticket retrieval rejects an invalid ticket ID.

test(
  "Ticket retrieval rejects an invalid ticket ID",
  async () => {
    const response = await apiRequest(
      "GET",
      "/api/tickets/abc",
      tokens.employeeA
    );

    const result = await response.json();

    assert.equal(response.status, 400);
    assert.equal(result.success, false);
    assert.equal(result.message, "Invalid ticket ID");
  }
);

// TEST 25: Ticket update rejects an empty request body.

test(
  "Ticket update rejects an empty request body",
  async () => {
    const response = await apiRequest(
      "PUT",
      "/api/tickets/1001",
      tokens.admin,
      {}
    );

    const result = await response.json();

    assert.equal(response.status, 400);
    assert.equal(result.success, false);
    assert.equal(
      result.message,
      "Provide at least one field to update"
    );
  }
);

// TEST 26: Ticket update rejects invalid status and priority values.

test(
  "Ticket update rejects invalid status and priority values",
  async () => {
    const invalidStatusResponse = await apiRequest(
      "PUT",
      "/api/tickets/1001",
      tokens.admin,
      {
        status: "Completed"
      }
    );

    const invalidStatusResult =
      await invalidStatusResponse.json();

    assert.equal(invalidStatusResponse.status, 400);
    assert.equal(invalidStatusResult.success, false);
    assert.equal(
      invalidStatusResult.message,
      "Invalid status"
    );

    const invalidPriorityResponse = await apiRequest(
      "PUT",
      "/api/tickets/1001",
      tokens.admin,
      {
        priority: "Urgent"
      }
    );

    const invalidPriorityResult =
      await invalidPriorityResponse.json();

    assert.equal(invalidPriorityResponse.status, 400);
    assert.equal(invalidPriorityResult.success, false);
    assert.equal(
      invalidPriorityResult.message,
      "Invalid priority"
    );
  }
);

after(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close(error => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  // Restore original AWS SDK method.
  dynamoDB.send = originalSend;

  db.close();

  rmSync(testDirectory, {
    recursive: true,
    force: true
  });
});

test("Registration rejects missing required fields", async () => {
  const response = await apiRequest(
    "POST",
    "/api/auth/register",
    null,
    {
      name: "Test User",
      email: "missingpassword@example.com"
    }
  );

  assert.equal(response.status, 400);
});

test("Registration rejects a name exceeding 80 characters", async () => {
  const response = await apiRequest(
    "POST",
    "/api/auth/register",
    null,
    {
      name: "A".repeat(81),
      email: "longname@example.com",
      password: "Password123"
    }
  );

  assert.equal(response.status, 400);
});

test("Registration rejects a password shorter than 8 characters", async () => {
  const response = await apiRequest(
    "POST",
    "/api/auth/register",
    null,
    {
      name: "Short Password User",
      email: "shortpassword@example.com",
      password: "Abc123"
    }
  );

  assert.equal(response.status, 400);
});

test("Registration rejects a password exceeding 72 UTF-8 bytes", async () => {
  const response = await apiRequest(
    "POST",
    "/api/auth/register",
    null,
    {
      name: "Long Password User",
      email: "longpassword@example.com",
      password: "A".repeat(73)
    }
  );

  assert.equal(response.status, 400);
});

test("Login rejects missing email or password", async () => {
  const response = await apiRequest(
    "POST",
    "/api/auth/login",
    null,
    {
      email: "employee@example.com"
    }
  );

  assert.equal(response.status, 400);
});

test("Login rejects an email that does not exist", async () => {
  const response = await apiRequest(
    "POST",
    "/api/auth/login",
    null,
    {
      email: "unknown-user@example.com",
      password: "Password123"
    }
  );

  assert.equal(response.status, 401);
});

test("Login rejects an inactive account", async () => {
  db.prepare(
    "UPDATE users SET is_active = 0 WHERE id = ?"
  ).run(users.employeeA.id);

  try {
    const response = await apiRequest(
      "POST",
      "/api/auth/login",
      null,
      {
        email: users.employeeA.email,
        password: "Password123"
      }
    );

    assert.equal(response.status, 403);
  } finally {
    db.prepare(
      "UPDATE users SET is_active = 1 WHERE id = ?"
    ).run(users.employeeA.id);
  }
});

test("Ticket owner can retrieve activity history", async () => {
  const response = await apiRequest(
    "GET",
    "/api/tickets/1001/activities",
    tokens.employeeB
  );

  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.ticketId, 1001);
  assert.ok(Array.isArray(body.data));
});

test("Another employee cannot retrieve ticket activity history", async () => {
  const response = await apiRequest(
    "GET",
    "/api/tickets/1001/activities",
    tokens.employeeA
  );

  assert.equal(response.status, 403);
});

test("Activity history rejects an invalid ticket ID", async () => {
  const response = await apiRequest(
    "GET",
    "/api/tickets/invalid/activities",
    tokens.employeeB
  );

  assert.equal(response.status, 400);
});

test("Activity history returns 404 for a nonexistent ticket", async () => {
  tickets.delete(1001);

  const response = await apiRequest(
    "GET",
    "/api/tickets/1001/activities",
    tokens.employeeB
  );

  assert.equal(response.status, 404);
});

test("Admin can delete an existing ticket", async () => {
  const response = await apiRequest(
    "DELETE",
    "/api/tickets/1001",
    tokens.admin
  );

  assert.equal(response.status, 200);
  assert.equal(tickets.has(1001), false);
});

test("Admin cannot delete a nonexistent ticket", async () => {
  tickets.delete(1001);

  const response = await apiRequest(
    "DELETE",
    "/api/tickets/1001",
    tokens.admin
  );

  assert.equal(response.status, 404);
});

test("Employee cannot delete a ticket", async () => {
  const response = await apiRequest(
    "DELETE",
    "/api/tickets/1001",
    tokens.employeeB
  );

  assert.equal(response.status, 403);
  assert.equal(tickets.has(1001), true);
});

test("Employee can retrieve only their own tickets", async () => {
  tickets.set(1002, {
    ...tickets.get(1001),
    ticketId: 1002,
    createdByUserId: users.employeeA.id,
    createdBy: users.employeeA.email
  });

  const response = await apiRequest(
    "GET",
    "/api/tickets",
    tokens.employeeB
  );

  const body = await response.json();

  assert.equal(response.status, 200);
  assert.ok(body.data.every(
    ticket => ticket.createdByUserId === users.employeeB.id
  ));
});

test("Support Engineer can retrieve only assigned tickets", async () => {
  const response = await apiRequest(
    "GET",
    "/api/tickets",
    tokens.supportA
  );

  const body = await response.json();

  assert.equal(response.status, 200);
  assert.ok(body.data.every(
    ticket => ticket.assignedTo?.toLowerCase() ===
      users.supportA.email.toLowerCase()
  ));
});

test("Admin can retrieve all tickets", async () => {
  const response = await apiRequest(
    "GET",
    "/api/tickets",
    tokens.admin
  );

  const body = await response.json();

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body.data));
});

test("Health endpoint returns backend status", async () => {
  const response = await apiRequest(
    "GET",
    "/api/health"
  );

  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.message, "Helpdesk backend is running");

  assert.ok(
    !Number.isNaN(Date.parse(body.timestamp)),
    "Health endpoint should return a valid ISO timestamp"
  );
});

test("Unknown API endpoint returns 404", async () => {
  const response = await apiRequest(
    "GET",
    "/api/this-endpoint-does-not-exist"
  );

  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.success, false);
});
test("Global error handler returns a safe 500 response", async () => {
  const originalMockSend = dynamoDB.send;

  // Simulate an unexpected database failure.
  dynamoDB.send = async () => {
    throw new Error("Simulated DynamoDB failure");
  };

  try {
    const response = await apiRequest(
      "GET",
      `/api/tickets/${ticketId}`,
      tokens.supportB
    );

    const result = await response.json();

    assert.equal(response.status, 500);

    assert.deepEqual(result, {
      success: false,
      message: "Internal server error"
    });
  } finally {
    // Restore the original mock, even if the test fails.
    dynamoDB.send = originalMockSend;
  }
});
test("Delete ticket handles a DynamoDB failure", async () => {
  const originalMockSend = dynamoDB.send;

  dynamoDB.send = async (command) => {
    if (command.constructor.name === "GetCommand") {
      return {
        Item: structuredClone(originalTicket)
      };
    }

    if (command.constructor.name === "DeleteCommand") {
      throw new Error("Simulated DynamoDB delete failure");
    }
  };

  try {
    const response = await apiRequest(
      "DELETE",
      `/api/tickets/${ticketId}`,
      tokens.admin
    );

    const result = await response.json();

    assert.equal(response.status, 500);

    assert.deepEqual(result, {
      success: false,
      message: "Internal server error"
    });
  } finally {
    dynamoDB.send = originalMockSend;
  }
});
test("GET notifications handles a database failure", async () => {
  db.exec("DROP TABLE notifications");

  try {
    const response = await apiRequest(
      "GET",
      "/api/notifications",
      tokens.employeeA
    );

    const result = await response.json();

    assert.equal(response.status, 500);

    assert.deepEqual(result, {
      success: false,
      message: "Internal server error"
    });
  } finally {
    db.exec(`
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        ticket_id TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        is_read INTEGER NOT NULL DEFAULT 0
          CHECK (is_read IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id)
          REFERENCES users(id) ON DELETE CASCADE
      );
    `);
  }
});
test("Mark notification as read handles a database failure", async () => {
  db.pragma("query_only = ON");

  try {
    const response = await apiRequest(
      "PATCH",
      "/api/notifications/notification-1/read",
      tokens.employeeA
    );

    const result = await response.json();

    assert.equal(response.status, 500);
    assert.deepEqual(result, {
      success: false,
      message: "Internal server error"
    });
  } finally {
    db.pragma("query_only = OFF");
  }
});
test("Mark all notifications as read handles a database failure", async () => {
  db.pragma("query_only = ON");

  try {
    const response = await apiRequest(
      "PATCH",
      "/api/notifications/read-all",
      tokens.employeeA
    );

    const result = await response.json();

    assert.equal(response.status, 500);
    assert.deepEqual(result, {
      success: false,
      message: "Internal server error"
    });
  } finally {
    db.pragma("query_only = OFF");
  }
});
test("Ticket status change creates a notification for the requester", async () => {
  const response = await apiRequest(
    "PUT",
    `/api/tickets/${ticketId}`,
    tokens.admin,
    {
      status: "In Progress"
    }
  );

  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.success, true);

  const notification = db.prepare(`
    SELECT *
    FROM notifications
    WHERE user_id = ?
      AND ticket_id = ?
      AND type = ?
  `).get(
    users.employeeB.id,
    String(ticketId),
    "STATUS_CHANGED"
  );

  assert.ok(notification);
  assert.equal(notification.title, "Ticket status updated");
});
test("Ticket priority change creates a notification for the requester", async () => {
  const response = await apiRequest(
    "PUT",
    `/api/tickets/${ticketId}`,
    tokens.admin,
    {
      priority: "High"
    }
  );

  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.success, true);

  const notification = db.prepare(`
    SELECT *
    FROM notifications
    WHERE user_id = ?
      AND ticket_id = ?
      AND type = ?
  `).get(
    users.employeeB.id,
    String(ticketId),
    "PRIORITY_CHANGED"
  );

  assert.ok(notification);
  assert.equal(notification.title, "Ticket priority updated");
});
test("Resolving a ticket creates a resolved notification for the requester", async () => {
  const response = await apiRequest(
    "PUT",
    `/api/tickets/${ticketId}`,
    tokens.admin,
    { status: "Resolved" }
  );

  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.success, true);

  const notification = db.prepare(`
    SELECT *
    FROM notifications
    WHERE user_id = ?
      AND ticket_id = ?
      AND type = ?
  `).get(
    users.employeeB.id,
    String(ticketId),
    "TICKET_RESOLVED"
  );

  assert.ok(notification);
  assert.equal(notification.title, "Your ticket was resolved");
});
test("Admin updating ticket title creates a generic activity entry", async () => {
  const response = await apiRequest(
    "PUT",
    `/api/tickets/${ticketId}`,
    tokens.admin,
    { title: "Updated ticket title" }
  );

  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.success, true);
  assert.equal(result.data.title, "Updated ticket title");

  const activity = result.data.activityHistory.at(-1);

  assert.equal(activity.action, "TICKET_UPDATED");
  assert.equal(activity.description, "title changed");
  assert.equal(activity.oldValue, originalTicket.title);
  assert.equal(activity.newValue, "Updated ticket title");
});
test("Admin cannot assign a ticket using an invalid ticket ID", async () => {
  const response = await apiRequest(
    "PUT",
    "/api/tickets/abc/assign",
    tokens.admin,
    { assignedTo: users.supportA.email }
  );

  const result = await response.json();

  assert.equal(response.status, 400);
  assert.equal(result.success, false);
  assert.equal(result.message, "Invalid ticket ID");
});
test("Admin cannot assign a ticket without a valid support engineer identifier", async () => {
  const response = await apiRequest(
    "PUT",
    `/api/tickets/${ticketId}/assign`,
    tokens.admin,
    { assignedTo: "" }
  );

  const result = await response.json();

  assert.equal(response.status, 400);
  assert.equal(result.success, false);
  assert.equal(
    result.message,
    "A valid support engineer identifier is required"
  );
});
test("Admin cannot delete a ticket using an invalid ticket ID", async () => {
  const response = await apiRequest(
    "DELETE",
    "/api/tickets/abc",
    tokens.admin
  );

  const result = await response.json();

  assert.equal(response.status, 400);
  assert.equal(result.success, false);
  assert.equal(result.message, "Invalid ticket ID");
});
test("Admin cannot update a nonexistent ticket", async () => {
  const response = await apiRequest(
    "PUT",
    "/api/tickets/9999",
    tokens.admin,
    { title: "Updated title" }
  );

  const result = await response.json();

  assert.equal(response.status, 404);
  assert.equal(result.success, false);
  assert.equal(result.message, "Ticket not found");
});
test("Support Engineer cannot update an unassigned ticket", async () => {
  const response = await apiRequest(
    "PUT",
    `/api/tickets/${ticketId}`,
    tokens.supportA,
    { status: "In Progress" }
  );

  const result = await response.json();

  assert.equal(response.status, 403);
  assert.equal(result.success, false);
  assert.equal(
    result.message,
    "You do not have permission to access this ticket."
  );
});
test("Admin cannot update a ticket with an empty title", async () => {
  const response = await apiRequest(
    "PUT",
    `/api/tickets/${ticketId}`,
    tokens.admin,
    { title: "   " }
  );

  const result = await response.json();

  assert.equal(response.status, 400);
  assert.equal(result.success, false);
  assert.equal(result.message, "Invalid title");
});
test("Admin cannot update a ticket with an empty department", async () => {
  const response = await apiRequest(
    "PUT",
    `/api/tickets/${ticketId}`,
    tokens.admin,
    { department: "   " }
  );

  const result = await response.json();

  assert.equal(response.status, 400);
  assert.equal(result.success, false);
  assert.equal(result.message, "Invalid department");
});

test("Admin cannot update a ticket with an empty description", async () => {
  const response = await apiRequest(
    "PUT",
    `/api/tickets/${ticketId}`,
    tokens.admin,
    { description: "   " }
  );

  const result = await response.json();

  assert.equal(response.status, 400);
  assert.equal(result.success, false);
  assert.equal(result.message, "Invalid description");
});
test("Admin cannot update a ticket with a title exceeding 100 characters", async () => {
  const response = await apiRequest(
    "PUT",
    `/api/tickets/${ticketId}`,
    tokens.admin,
    { title: "A".repeat(101) }
  );

  const result = await response.json();

  assert.equal(response.status, 400);
  assert.equal(result.success, false);
  assert.equal(result.message, "Invalid title");
});
test("Admin cannot update a department exceeding 50 characters", async () => {
  const response = await apiRequest(
    "PUT",
    `/api/tickets/${ticketId}`,
    tokens.admin,
    { department: "D".repeat(51) }
  );

  const result = await response.json();

  assert.equal(response.status, 400);
  assert.equal(result.success, false);
  assert.equal(result.message, "Invalid department");
});
test("Admin cannot update a description exceeding 1000 characters", async () => {
  const response = await apiRequest(
    "PUT",
    `/api/tickets/${ticketId}`,
    tokens.admin,
    { description: "D".repeat(1001) }
  );

  const result = await response.json();

  assert.equal(response.status, 400);
  assert.equal(result.success, false);
  assert.equal(result.message, "Invalid description");
});
test("Admin updating a ticket with the same title does not create an activity entry", async () => {
  const response = await apiRequest(
    "PUT",
    `/api/tickets/${ticketId}`,
    tokens.admin,
    { title: originalTicket.title }
  );

  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.success, true);
  assert.equal(result.data.activityHistory.length, 0);
});
test("Admin cannot update department with a non-string value", async () => {
  const response = await apiRequest(
    "PUT",
    `/api/tickets/${ticketId}`,
    tokens.admin,
    { department: 123 }
  );

  const result = await response.json();

  assert.equal(response.status, 400);
  assert.equal(result.success, false);
  assert.equal(result.message, "Invalid department");
});
test("Admin cannot update title with a non-string value", async () => {
  const response = await apiRequest(
    "PUT",
    `/api/tickets/${ticketId}`,
    tokens.admin,
    { title: 123 }
  );

  const result = await response.json();

  assert.equal(response.status, 400);
  assert.equal(result.success, false);
  assert.equal(result.message, "Invalid title");
});
test("Admin cannot update description with a non-string value", async () => {
  const response = await apiRequest(
    "PUT",
    `/api/tickets/${ticketId}`,
    tokens.admin,
    { description: 123 }
  );

  const result = await response.json();

  assert.equal(response.status, 400);
  assert.equal(result.success, false);
  assert.equal(result.message, "Invalid description");
});
test("Ticket retrieval returns 404 for a nonexistent ticket", async () => {
  const response = await apiRequest(
    "GET",
    "/api/tickets/9999",
    tokens.admin
  );

  const result = await response.json();

  assert.equal(response.status, 404);
  assert.equal(result.success, false);
  assert.equal(result.message, "Ticket not found");
});
test("Activity history handles a DynamoDB failure", async () => {
  const originalMockSend = dynamoDB.send;

  // Simulate a DynamoDB failure.
  dynamoDB.send = async () => {
    throw new Error("Simulated activity history failure");
  };

  try {
    const response = await apiRequest(
      "GET",
      `/api/tickets/${ticketId}/activities`,
      tokens.supportB
    );

    const result = await response.json();

    assert.equal(response.status, 500);

    assert.deepEqual(result, {
      success: false,
      message: "Internal server error"
    });
  } finally {
    // Restore the original mock.
    dynamoDB.send = originalMockSend;
  }
});

test("Ticket update handles a DynamoDB failure", async () => {
  const originalMockSend = dynamoDB.send;

  dynamoDB.send = async () => {
    throw new Error("Simulated ticket update failure");
  };

  try {
    const response = await apiRequest(
      "PUT",
      `/api/tickets/${ticketId}`,
      tokens.admin,
      { title: "Updated ticket title" }
    );

    const result = await response.json();

    assert.equal(response.status, 500);
    assert.deepEqual(result, {
      success: false,
      message: "Internal server error"
    });
  } finally {
    dynamoDB.send = originalMockSend;
  }
});

test("Ticket assignment handles a DynamoDB failure", async () => {
  const originalMockSend = dynamoDB.send;

  dynamoDB.send = async (command) => {
    if (command.constructor.name === "GetCommand") {
      return {
        Item: { ...originalTicket }
      };
    }

    if (command.constructor.name === "PutCommand") {
      throw new Error("Simulated ticket assignment failure");
    }

    throw new Error("Unexpected DynamoDB command");
  };

  try {
    const response = await apiRequest(
      "PUT",
      `/api/tickets/${ticketId}/assign`,
      tokens.admin,
      { assignedTo: users.supportA.email }
    );

    const result = await response.json();

    assert.equal(response.status, 500);
    assert.deepEqual(result, {
      success: false,
      message: "Internal server error"
    });
  } finally {
    dynamoDB.send = originalMockSend;
  }
});
