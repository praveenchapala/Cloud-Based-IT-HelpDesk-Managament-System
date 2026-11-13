import { pathToFileURL } from "node:url";
import { createChatRouter } from "./routes/chatRoutes.js";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { randomUUID } from "crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

import { dynamoDB, TABLE_NAME } from "./dynamodb.js";

import {
  findUserByEmail,
  findUserByUserId,
  findActiveStaff,
  findActiveSupportEngineer,
  createUser,
  toPublicUser
} from "./userRepository.js";

import {
  createNotification,
  getNotificationsByUserId,
  markNotificationAsRead,
  markAllNotificationsAsRead
} from "./notificationRepository.js";


import {
  ScanCommand,
  GetCommand,
  PutCommand,
  DeleteCommand
} from "@aws-sdk/lib-dynamodb";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

const allowedOrigins = (
  process.env.FRONTEND_URL || "http://localhost:5173"
)
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests without an Origin header, such as server-to-server calls.
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true
  })
);

app.use(express.json());

const validPriorities = ["Low", "Medium", "High", "Critical"];
const validStatuses = ["Open", "In Progress", "Resolved"];

const SLA_POLICIES = {
  Critical: {
    responseMinutes: 15,
    resolutionMinutes: 240
  },
  High: {
    responseMinutes: 60,
    resolutionMinutes: 480
  },
  Medium: {
    responseMinutes: 240,
    resolutionMinutes: 1440
  },
  Low: {
    responseMinutes: 480,
    resolutionMinutes: 4320
  }
};

const calculateSlaDeadlines = (priority, createdAt) => {
  const policy = SLA_POLICIES[priority];

  if (!policy) {
    throw new Error("Invalid priority for SLA calculation");
  }

  const startTime = new Date(createdAt).getTime();

  if (!Number.isFinite(startTime)) {
    throw new Error("Invalid ticket creation timestamp");
  }

  return {
    slaResponseDueAt: new Date(
      startTime + policy.responseMinutes * 60 * 1000
    ).toISOString(),

    slaResolutionDueAt: new Date(
      startTime + policy.resolutionMinutes * 60 * 1000
    ).toISOString(),

    slaPolicy: { ...policy }
  };
};


// --------------------------------------------------
// CALCULATE CURRENT SLA STATUS
// --------------------------------------------------

const getSlaStatus = (ticket, currentTime = Date.now()) => {
  if (
    !ticket.slaResponseDueAt ||
    !ticket.slaResolutionDueAt ||
    !ticket.slaPolicy
  ) {
    return {
      overall: "NO_SLA",
      response: "NO_SLA",
      resolution: "NO_SLA"
    };
  }

  const calculateStatus = (completedAt, deadline, allowedMinutes) => {
    const deadlineTime = new Date(deadline).getTime();

    if (!Number.isFinite(deadlineTime)) {
      return "NO_SLA";
    }

    // An already completed action is evaluated against its deadline.
    if (completedAt) {
      const completedTime = new Date(completedAt).getTime();

      if (!Number.isFinite(completedTime)) {
        return "NO_SLA";
      }

      return completedTime <= deadlineTime ? "MET" : "BREACHED";
    }

    const remainingTime = deadlineTime - currentTime;

    if (remainingTime < 0) {
      return "BREACHED";
    }

    // Mark as at risk when 20% or less of the SLA duration remains.
    const atRiskThreshold =
      allowedMinutes * 60 * 1000 * 0.2;

    if (remainingTime <= atRiskThreshold) {
      return "AT_RISK";
    }

    return "ON_TRACK";
  };

  const responseStatus = calculateStatus(
    ticket.firstResponseAt,
    ticket.slaResponseDueAt,
    ticket.slaPolicy.responseMinutes
  );

  // SLA resolution measures the first successful resolution. Reopening is
  // tracked separately in resolutionHistory and does not erase that historical
  // first-resolution result or restart the original SLA clock.
  const resolutionHistory = Array.isArray(ticket.resolutionHistory)
    ? ticket.resolutionHistory
    : [];

  const firstResolution = resolutionHistory.find(
    entry => entry.resolvedAt
  );

  const resolutionCompletedAt =
    firstResolution?.resolvedAt || ticket.resolvedAt || null;

  const resolutionStatus = calculateStatus(
    resolutionCompletedAt,
    ticket.slaResolutionDueAt,
    ticket.slaPolicy.resolutionMinutes
  );

  let overall = "ON_TRACK";

  if (
    responseStatus === "BREACHED" ||
    resolutionStatus === "BREACHED"
  ) {
    overall = "BREACHED";
  } else if (
    responseStatus === "AT_RISK" ||
    resolutionStatus === "AT_RISK"
  ) {
    overall = "AT_RISK";
  } else if (
    responseStatus === "NO_SLA" ||
    resolutionStatus === "NO_SLA"
  ) {
    overall = "NO_SLA";
  } else if (
    responseStatus === "MET" &&
    resolutionStatus === "MET"
  ) {
    overall = "MET";
  }

  return {
    overall,
    response: responseStatus,
    resolution: resolutionStatus
  };
};

// --------------------------------------------------
// NORMALIZE SLA DATA FOR LEGACY TICKETS
// --------------------------------------------------

// Older tickets were created before SLA tracking was introduced. Those
// records have a date field (YYYY-MM-DD), but may not have createdAt or
// stored SLA deadlines. Use the beginning of that recorded date as the
// best available timestamp; do not use the current time because that
// would incorrectly reset the ticket's SLA clock.
const getTicketWithSla = (ticket) => {
  const legacyCreatedAt = ticket.createdAt ||
    (typeof ticket.date === "string" && ticket.date.trim()
      ? `${ticket.date.trim()}T00:00:00.000Z`
      : null);

  if (
    ticket.slaResponseDueAt &&
    ticket.slaResolutionDueAt &&
    ticket.slaPolicy
  ) {
    return {
      ...ticket,
      slaStatus: getSlaStatus(ticket)
    };
  }

  if (legacyCreatedAt && SLA_POLICIES[ticket.priority]) {
    try {
      const slaDeadlines = calculateSlaDeadlines(
        ticket.priority,
        legacyCreatedAt
      );
      const normalizedTicket = {
        ...ticket,
        createdAt: ticket.createdAt || legacyCreatedAt,
        ...slaDeadlines
      };

      return {
        ...normalizedTicket,
        slaStatus: getSlaStatus(normalizedTicket)
      };
    } catch (error) {
      console.error(`Could not calculate SLA for ticket ${ticket.id}:`, error);
    }
  }

  return {
    ...ticket,
    slaStatus: getSlaStatus(ticket)
  };
};

// --------------------------------------------------
// ACTIVITY HISTORY HELPER
// --------------------------------------------------

const createActivity = ({
  action,
  description,
  oldValue = null,
  newValue = null,
  performedBy = "System"
}) => ({
  activityId: randomUUID(),
  action,
  description,
  performedBy,
  timestamp: new Date().toISOString(),
  oldValue,
  newValue
});

// --------------------------------------------------
// USER REGISTRATION
// --------------------------------------------------

app.post("/api/auth/register", async (req, res, next) => {
  try {
    const { name, email, password } = req.body ?? {};

    if (
      typeof name !== "string" ||
      typeof email !== "string" ||
      typeof password !== "string" ||
      !name.trim() ||
      !email.trim() ||
      !password
    ) {
      return res.status(400).json({
        success: false,
        message: "Name, email and password are required"
      });
    }

    const normalizedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (normalizedName.length > 80) {
      return res.status(400).json({
        success: false,
        message: "Name must not exceed 80 characters"
      });
    }

    if (
      normalizedEmail.length > 254 ||
      !emailPattern.test(normalizedEmail)
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address"
      });
    }

    const passwordBytes = Buffer.byteLength(password, "utf8");

    if (password.length < 8 || passwordBytes > 72) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters and no more than 72 bytes"
      });
    }

    // Public registration always creates an EMPLOYEE. Never accept a role
    // supplied by the client.
    const existingUser = await findUserByEmail(normalizedEmail);

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists"
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const createdUser = await createUser({
      name: normalizedName,
      email: normalizedEmail,
      passwordHash,
      role: "EMPLOYEE"
    });

    return res.status(201).json({
      success: true,
      message: "Account registered successfully",
      data: toPublicUser(createdUser)
    });
  } catch (error) {
    if (error.code === "USER_EMAIL_EXISTS") {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists"
      });
    }

    next(error);
  }
});

// --------------------------------------------------
// USER LOGIN WITH JWT
// --------------------------------------------------

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};

    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !email.trim() ||
      !password
    ) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required"
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = await findUserByEmail(normalizedEmail);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    if (Number(user.is_active) !== 1) {
      return res.status(403).json({
        success: false,
        message: "Your account is inactive. Contact the administrator."
      });
    }

    const isPasswordValid = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET is not configured.");

      return res.status(500).json({
        success: false,
        message: "Authentication service is not configured"
      });
    }

    const token = jwt.sign(
      { role: user.role },
      process.env.JWT_SECRET,
      {
        // The UUID is the stable application identity; the numeric id is
        // only the DynamoDB partition key.
        subject: user.userId,
        expiresIn: process.env.JWT_EXPIRES_IN || "1d",
        algorithm: "HS256"
      }
    );

    return res.status(200).json({
      success: true,
      message: "Login successful",
      data: {
        token,
        user: {
          id: user.userId,
          name: user.name,
          email: user.email,
          role: user.role
        }
      }
    });

  } catch (error) {
    next(error);
  }
});

// --------------------------------------------------
// JWT AUTHENTICATION MIDDLEWARE
// --------------------------------------------------

const authenticateToken = async (req, res, next) => {
  if (!process.env.JWT_SECRET) {
    return res.status(500).json({
      success: false,
      message: "Authentication configuration error"
    });
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Access denied. Please provide an authentication token."
    });
  }

  let decoded;

  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"]
    });
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Token expired. Please log in again."
      });
    }

    return res.status(401).json({
      success: false,
      message: "Invalid authentication token."
    });
  }

  if (!decoded.sub) {
    return res.status(401).json({
      success: false,
      message: "Invalid authentication token."
    });
  }

  try {
    // Always load the current user and role from DynamoDB. Do not trust
    // the role embedded in an old JWT.
    const storedUser = await findUserByUserId(decoded.sub);

    if (!storedUser) {
      return res.status(401).json({
        success: false,
        message: "User account not found."
      });
    }

    if (Number(storedUser.is_active) !== 1) {
      return res.status(403).json({
        success: false,
        message: "Your account is inactive."
      });
    }

    req.user = toPublicUser(storedUser);
    return next();
  } catch (error) {
    console.error("Authentication error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal authentication error."
    });
  }
};

// --------------------------------------------------
// ROLE-BASED AUTHORIZATION
// --------------------------------------------------

const authorizeRoles = (...allowedRoles) => (req, res, next) => {
  if (!req.user || !allowedRoles.includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: "You do not have permission to perform this action."
    });
  }

  next();
};

// --------------------------------------------------
// TICKET ACCESS CONTROL
// --------------------------------------------------

// The table is shared by tickets, users, and notifications. Older tickets
// predate recordType, so identify them by their ticket-specific attributes.
// New tickets are explicitly stored with recordType: "TICKET".
const isTicketRecord = (item) => {
  if (!item || typeof item !== "object") return false;

  if (item.recordType === "TICKET") return true;
  if (item.recordType) return false;

  // Backward compatibility for the existing legacy ticket records.
  return (
    typeof item.title === "string" &&
    typeof item.description === "string" &&
    typeof item.department === "string" &&
    typeof item.status === "string" &&
    typeof item.priority === "string"
  );
};

const canAccessTicket = (user, ticket) => {
  if (!isTicketRecord(ticket)) return false;

  if (user.role === "ADMIN") {
    return true;
  }

  if (user.role === "EMPLOYEE") {
    // Legacy tickets do not contain a stable owner ID or email. Do not infer
    // ownership from the employee display name because names may not be unique.
    // Those tickets remain accessible to admins and their assigned engineers
    // until an explicit, verified owner mapping is added.
    return ticket.createdByUserId === user.id ||
      (ticket.createdByEmail &&
       ticket.createdByEmail.toLowerCase() === user.email.toLowerCase());
  }

  if (user.role === "SUPPORT_ENGINEER") {
    return (
      typeof ticket.assignedTo === "string" &&
      ticket.assignedTo.trim().toLowerCase() ===
        user.email.toLowerCase()
    );
  }

  return false;
};

const denyTicketAccess = (res) => {
  return res.status(403).json({
    success: false,
    message: "You do not have permission to access this ticket."
  });

};


// --------------------------------------------------
// DYNAMODB OPTIMISTIC CONCURRENCY CONTROL
// --------------------------------------------------

// Older tickets do not have a version attribute. Treat those records as
// version 0; the first successful update writes version 1.
const getTicketVersion = (ticket) => {
  if (ticket.version === undefined || ticket.version === null) {
    return 0;
  }

  if (!Number.isSafeInteger(ticket.version) || ticket.version < 0) {
    throw new Error(`Ticket ${ticket.id} has an invalid version value`);
  }

  return ticket.version;
};

// Every ticket mutation must use this condition together with a version
// increment. If another request updates the item after our GetCommand,
// DynamoDB rejects this write instead of silently overwriting that update.
const buildTicketWriteCondition = (ticket) => ({
  ConditionExpression:
    "attribute_exists(id) AND (attribute_not_exists(#version) OR #version = :expectedVersion)",
  ExpressionAttributeNames: {
    "#version": "version"
  },
  ExpressionAttributeValues: {
    ":expectedVersion": getTicketVersion(ticket)
  }
});


// --------------------------------------------------
// NOTIFICATION CREATION HELPERS
// --------------------------------------------------

const safeCreateNotification = async (payload) => {
  if (!payload?.userId || !payload?.ticketId) return null;

  try {
    return await createNotification(payload);
  } catch (error) {
    // A notification failure must not undo a ticket operation that has
    // already been successfully persisted.
    console.error("Notification creation failed:", error);
    return null;
  }
};

const notifyActiveStaff = async ({ ticket, type, title, message }) => {
  try {
    const staff = await findActiveStaff(ticket.createdByUserId || "");

    const results = await Promise.allSettled(
      staff.map((recipient) =>
        safeCreateNotification({
          userId: recipient.userId,
          ticketId: ticket.id,
          type,
          title,
          message
        })
      )
    );

    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length) {
      console.error("Some staff notifications could not be created:", failures);
    }
  } catch (error) {
    console.error("Staff notification lookup failed:", error);
  }
};

// --------------------------------------------------
// HEALTH CHECK (PUBLIC)
// --------------------------------------------------

app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Helpdesk backend is running",
    timestamp: new Date().toISOString()
  });
});

// --------------------------------------------------
// GET TICKETS BASED ON USER ROLE
// --------------------------------------------------

app.get("/api/tickets", authenticateToken, async (req, res, next) => {
  try {
    const result = await dynamoDB.send(
      new ScanCommand({
        TableName: TABLE_NAME
      })
    );

    const allRecords = result.Items || [];

    // Never return USER or NOTIFICATION records from the ticket endpoint.
    // isTicketRecord also keeps compatibility with legacy tickets that have
    // no recordType attribute.
    const tickets = allRecords
      .filter(isTicketRecord)
      .filter(ticket => canAccessTicket(req.user, ticket))
      .map(ticket => getTicketWithSla(ticket));

    res.status(200).json({
      success: true,
      count: tickets.length,
      data: tickets
    });

  } catch (error) {
    next(error);
  }
});

// --------------------------------------------------
// GET ACTIVITY HISTORY FOR A TICKET
// --------------------------------------------------

app.get(
  "/api/tickets/:id/activities",
  authenticateToken,
  async (req, res, next) => {
    try {
      const ticketId = Number(req.params.id);

      if (!Number.isSafeInteger(ticketId) || ticketId <= 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid ticket ID"
        });
      }

      const result = await dynamoDB.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { id: ticketId }
        })
      );

      if (!result.Item || !isTicketRecord(result.Item)) {
        return res.status(404).json({
          success: false,
          message: "Ticket not found"
        });
      }

      if (!canAccessTicket(req.user, result.Item)) {
        return denyTicketAccess(res);
      }

      const activities = Array.isArray(result.Item.activityHistory)
        ? result.Item.activityHistory
        : [];

      res.status(200).json({
        success: true,
        ticketId,
        count: activities.length,
        data: activities
      });

    } catch (error) {
      next(error);
    }
  }
);

// --------------------------------------------------
// ADD A REPLY TO A TICKET
// --------------------------------------------------

app.post(
  "/api/tickets/:id/replies",
  authenticateToken,
  async (req, res, next) => {
    try {
      const ticketId = Number(req.params.id);
      const { message } = req.body ?? {};

      if (!Number.isSafeInteger(ticketId) || ticketId <= 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid ticket ID"
        });
      }

      if (
        typeof message !== "string" ||
        !message.trim() ||
        message.trim().length > 2000
      ) {
        return res.status(400).json({
          success: false,
          message: "Reply must contain 1 to 2000 characters"
        });
      }

      const result = await dynamoDB.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { id: ticketId }
        })
      );

      if (!result.Item || !isTicketRecord(result.Item)) {
        return res.status(404).json({
          success: false,
          message: "Ticket not found"
        });
      }

      const currentTicket = result.Item;

      if (!canAccessTicket(req.user, currentTicket)) {
        return denyTicketAccess(res);
      }

      if (currentTicket.status === "Resolved") {
        return res.status(400).json({
          success: false,
          message: "Cannot reply to a resolved ticket"
        });
      }

      const now = new Date().toISOString();

      const reply = {
        replyId: randomUUID(),
        message: message.trim(),
        senderId: req.user.id,
        senderName: req.user.name,
        senderEmail: req.user.email,
        senderRole: req.user.role,
        createdAt: now
      };

      const replies = Array.isArray(currentTicket.replies)
        ? [...currentTicket.replies]
        : [];

      replies.push(reply);

      const activityHistory = Array.isArray(currentTicket.activityHistory)
        ? [...currentTicket.activityHistory]
        : [];

      activityHistory.push(
        createActivity({
          action: "TICKET_REPLY_ADDED",
          description: `Reply added by ${req.user.email}`,
          newValue: {
            replyId: reply.replyId
          },
          performedBy: req.user.email
        })
      );

      const updatedTicket = {
        ...currentTicket,
        version: getTicketVersion(currentTicket) + 1,
        replies,
        activityHistory
      };

      // Only the first staff reply counts as the first response.
      const isStaffReply =
        req.user.role === "ADMIN" ||
        req.user.role === "SUPPORT_ENGINEER";

      if (isStaffReply && !currentTicket.firstResponseAt) {
        updatedTicket.firstResponseAt = now;
        updatedTicket.firstResponseBy = req.user.email;
      }

      await dynamoDB.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: updatedTicket,
          ...buildTicketWriteCondition(currentTicket)
        })
      );

      // Notify the other participant.
      if (isStaffReply) {
        if (currentTicket.createdByUserId !== req.user.id) {
          await safeCreateNotification({
            userId: currentTicket.createdByUserId,
            ticketId,
            type: "TICKET_REPLY",
            title: "New reply on your ticket",
            message: `A support representative replied to ticket #${ticketId}.`
          });
        }
      } else if (currentTicket.assignedTo) {
        const assignedEngineer = await findActiveSupportEngineer(
          currentTicket.assignedTo
        );

        if (assignedEngineer) {
          await safeCreateNotification({
            userId: assignedEngineer.userId,
            ticketId,
            type: "TICKET_REPLY",
            title: "New employee reply",
            message: `The requester replied to ticket #${ticketId}.`
          });
        }
      }

      res.status(201).json({
        success: true,
        message: "Reply added successfully",
        data: reply
      });

    } catch (error) {
      next(error);
    }
  }
);

// --------------------------------------------------
// GET TICKET BY ID
// --------------------------------------------------

app.get(
  "/api/tickets/:id",
  authenticateToken,
  async (req, res, next) => {
    try {
      const ticketId = Number(req.params.id);

      if (!Number.isSafeInteger(ticketId) || ticketId <= 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid ticket ID"
        });
      }

      const result = await dynamoDB.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { id: ticketId }
        })
      );

      if (!result.Item || !isTicketRecord(result.Item)) {
        return res.status(404).json({
          success: false,
          message: "Ticket not found"
        });
      }

      if (!canAccessTicket(req.user, result.Item)) {
        return denyTicketAccess(res);
      }

      res.status(200).json({
        success: true,
        data: getTicketWithSla(result.Item)
      });

    } catch (error) {
      next(error);
    }
  }
);

// --------------------------------------------------
// CREATE A NEW TICKET
// --------------------------------------------------

app.post(
  "/api/tickets",
  authenticateToken,
  authorizeRoles("ADMIN", "SUPPORT_ENGINEER", "EMPLOYEE"),
  async (req, res, next) => {
    try {
      const {
        title,
        department,
        priority,
        description
      } = req.body ?? {};

      if (
        typeof title !== "string" || !title.trim() ||
        typeof department !== "string" || !department.trim() ||
        typeof description !== "string" || !description.trim()
      ) {
        return res.status(400).json({
          success: false,
          message: "Title, department and description are required"
        });
      }

      if (
        title.length > 100 ||
        department.length > 50 ||
        description.length > 1000
      ) {
        return res.status(400).json({
          success: false,
          message: "One or more fields exceed the allowed length"
        });
      }

      const selectedPriority = priority ?? "Medium";

      if (!validPriorities.includes(selectedPriority)) {
        return res.status(400).json({
          success: false,
          message: "Invalid priority"
        });
      }

      const ticketId = Date.now();
      const createdAt = new Date().toISOString();
      const slaDeadlines = calculateSlaDeadlines(
        selectedPriority,
        createdAt
      );
      const creationActivity = createActivity({
        action: "TICKET_CREATED",
        description: "Ticket was created",
        newValue: {
          title: title.trim(),
          priority: selectedPriority,
          status: "Open"
        },
        performedBy: req.user.email
      });

      const newTicket = {
        id: ticketId,
        recordType: "TICKET",
        version: 1,
        createdAt,
        ...slaDeadlines,
        title: title.trim(),

        // Identity is derived from the authenticated user.
        // Never trust employee or owner values from the request.
        employee: req.user.name,
        createdByUserId: req.user.id,
        createdByEmail: req.user.email,

        department: department.trim(),
        priority: selectedPriority,
        status: "Open",
        description: description.trim(),
        date: new Date().toISOString().slice(0, 10),

        assignedTo: null,
        assignedAt: null,
        assignmentStatus: "Unassigned",

        activityHistory: [creationActivity]
      };

      await dynamoDB.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: newTicket,
          ConditionExpression: "attribute_not_exists(id)"
        })
      );

      await notifyActiveStaff({
        ticket: newTicket,
        type: "TICKET_CREATED",
        title: "New ticket created",
        message: `${newTicket.employee} created ticket #${newTicket.id}: ${newTicket.title}`
      });

      res.status(201).json({
        success: true,
        message: "Ticket created successfully",
        data: {
          ...newTicket,
          slaStatus: getSlaStatus(newTicket)
        }
      });

    } catch (error) {
      next(error);
    }
  }
);

// --------------------------------------------------
// UPDATE AN EXISTING TICKET
// --------------------------------------------------

app.put(
  "/api/tickets/:id",
  authenticateToken,
  authorizeRoles("ADMIN", "SUPPORT_ENGINEER"),
  async (req, res, next) => {
    try {
      const ticketId = Number(req.params.id);

      if (!Number.isSafeInteger(ticketId) || ticketId <= 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid ticket ID"
        });
      }

      const updates = req.body;

      if (
        !updates ||
        typeof updates !== "object" ||
        Array.isArray(updates) ||
        Object.keys(updates).length === 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Provide at least one field to update"
        });
      }

      // Admin can update ticket details.
      // Support engineers can update only priority and status.
      const allowedFields = req.user.role === "ADMIN"
        ? ["title", "department", "priority", "status", "description"]
        : ["priority", "status"];

      const invalidField = Object.keys(updates).find(
        field => !allowedFields.includes(field)
      );

      if (invalidField) {
        return res.status(400).json({
          success: false,
          message: `Field '${invalidField}' cannot be updated`
        });
      }

      const result = await dynamoDB.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { id: ticketId }
        })
      );

      if (!result.Item || !isTicketRecord(result.Item)) {
        return res.status(404).json({
          success: false,
          message: "Ticket not found"
        });
      }

      const currentTicket = result.Item;

      // A support engineer can update only assigned tickets.
      if (!canAccessTicket(req.user, currentTicket)) {
        return denyTicketAccess(res);
      }

      const stringLimits = {
        title: 100,
        department: 50,
        description: 1000
      };

      for (const [field, maxLength] of Object.entries(stringLimits)) {
        if (
          field in updates &&
          (
            typeof updates[field] !== "string" ||
            !updates[field].trim() ||
            updates[field].length > maxLength
          )
        ) {
          return res.status(400).json({
            success: false,
            message: `Invalid ${field}`
          });
        }
      }

      if (
        "priority" in updates &&
        !validPriorities.includes(updates.priority)
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid priority"
        });
      }

      if (
        "status" in updates &&
        !validStatuses.includes(updates.status)
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid status"
        });
      }

      const normalizedUpdates = { ...updates };

      for (const field of Object.keys(stringLimits)) {
        if (field in normalizedUpdates) {
          normalizedUpdates[field] = normalizedUpdates[field].trim();
        }
      }

      const updatedTicket = {
        ...currentTicket,
        ...normalizedUpdates,
        version: getTicketVersion(currentTicket) + 1
      };

      // --------------------------------------------------
      // UPDATE SLA WHEN TICKET PRIORITY CHANGES
      // --------------------------------------------------

      const priorityChanged =
  normalizedUpdates.priority !== undefined &&
  normalizedUpdates.priority !== currentTicket.priority;

let slaChangeDetails = null;

if (priorityChanged) {
  const slaSourceTicket = getTicketWithSla(currentTicket);

  if (slaSourceTicket.createdAt) {
    // Persist the best available historical creation timestamp for legacy
    // records when their priority is changed.
    updatedTicket.createdAt = slaSourceTicket.createdAt;

    const recalculatedSla = calculateSlaDeadlines(
      normalizedUpdates.priority,
      slaSourceTicket.createdAt
    );

  const oldResponseDeadline = currentTicket.slaResponseDueAt ?? null;
  const oldResolutionDeadline = currentTicket.slaResolutionDueAt ?? null;

  // Preserve the response deadline if a staff response already exists.
  if (!currentTicket.firstResponseAt) {
    updatedTicket.slaResponseDueAt =
      recalculatedSla.slaResponseDueAt;
  }

  // Preserve the resolution deadline for already-resolved tickets.
  if (currentTicket.status !== "Resolved") {
    updatedTicket.slaResolutionDueAt =
      recalculatedSla.slaResolutionDueAt;
  }

  updatedTicket.slaPolicy = recalculatedSla.slaPolicy;
  updatedTicket.slaPolicyUpdatedAt = new Date().toISOString();

  slaChangeDetails = {
    oldResponseDeadline,
    newResponseDeadline: updatedTicket.slaResponseDueAt ?? oldResponseDeadline,
    oldResolutionDeadline,
    newResolutionDeadline: updatedTicket.slaResolutionDueAt ?? oldResolutionDeadline
  };
  }
}

      const activityHistory = Array.isArray(currentTicket.activityHistory)
        ? [...currentTicket.activityHistory]
        : [];

      for (const field of Object.keys(normalizedUpdates)) {
        const oldValue = currentTicket[field] ?? null;
        const newValue = normalizedUpdates[field];

        if (oldValue === newValue) {
          continue;
        }

        let action = "TICKET_UPDATED";
        let description = `${field} was updated`;

        if (field === "status") {
          action = "STATUS_CHANGED";
          description = `Status changed from ${oldValue} to ${newValue}`;
        } else if (field === "priority") {
          action = "PRIORITY_CHANGED";
          description = `Priority changed from ${oldValue} to ${newValue}`;
        } else {
          description = `${field} changed`;
        }

        activityHistory.push(
          createActivity({
            action,
            description,
            oldValue,
            newValue,
            performedBy: req.user.email
          })
        );
      }
      if (slaChangeDetails) {
  activityHistory.push(
    createActivity({
      action: "SLA_POLICY_UPDATED",
      description: `SLA deadlines recalculated after priority changed to ${normalizedUpdates.priority}`,
      oldValue: {
        responseDueAt: slaChangeDetails.oldResponseDeadline,
        resolutionDueAt: slaChangeDetails.oldResolutionDeadline
      },
      newValue: {
        responseDueAt: slaChangeDetails.newResponseDeadline,
        resolutionDueAt: slaChangeDetails.newResolutionDeadline,
        policy: updatedTicket.slaPolicy
      },
      performedBy: req.user.email
    })
  );
}
// --------------------------------------------------
// TRACK TICKET RESOLUTION AND REOPENING
// --------------------------------------------------

const statusChanged =
  normalizedUpdates.status !== undefined &&
  normalizedUpdates.status !== currentTicket.status;

if (statusChanged) {
  const now = new Date().toISOString();

  const resolutionHistory = Array.isArray(currentTicket.resolutionHistory)
    ? [...currentTicket.resolutionHistory]
    : [];

  // Ticket is being resolved.
  if (normalizedUpdates.status === "Resolved") {
    updatedTicket.resolvedAt = now;
    updatedTicket.resolvedBy = req.user.email;

    resolutionHistory.push({
      resolvedAt: now,
      resolvedBy: req.user.email,
      reopenedAt: null,
      reopenedBy: null
    });
  }

  // Previously resolved ticket is being reopened.
  if (
    currentTicket.status === "Resolved" &&
    normalizedUpdates.status !== "Resolved"
  ) {
    const lastResolution = resolutionHistory.length - 1;

    if (lastResolution >= 0) {
      resolutionHistory[lastResolution] = {
        ...resolutionHistory[lastResolution],
        reopenedAt: now,
        reopenedBy: req.user.email
      };
    }

    updatedTicket.resolvedAt = null;
    updatedTicket.resolvedBy = null;
  }

  updatedTicket.resolutionHistory = resolutionHistory;
}

updatedTicket.activityHistory = activityHistory;

      await dynamoDB.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: updatedTicket,
          ...buildTicketWriteCondition(currentTicket)
        })
      );

      const requesterId = currentTicket.createdByUserId;
      if (requesterId && requesterId !== req.user.id) {
        if (normalizedUpdates.status !== undefined && normalizedUpdates.status !== currentTicket.status) {
          await safeCreateNotification({
            userId: requesterId, ticketId,
            type: normalizedUpdates.status === "Resolved" ? "TICKET_RESOLVED" : "STATUS_CHANGED",
            title: normalizedUpdates.status === "Resolved" ? "Your ticket was resolved" : "Ticket status updated",
            message: `Ticket #${ticketId} "${currentTicket.title}" status changed from ${currentTicket.status} to ${normalizedUpdates.status}.`
          });
        }
        if (normalizedUpdates.priority !== undefined && normalizedUpdates.priority !== currentTicket.priority) {
          await safeCreateNotification({
            userId: requesterId, ticketId, type: "PRIORITY_CHANGED",
            title: "Ticket priority updated",
            message: `Ticket #${ticketId} "${currentTicket.title}" priority changed from ${currentTicket.priority} to ${normalizedUpdates.priority}.`
          });
        }
      }

      res.status(200).json({
        success: true,
        message: "Ticket updated successfully",
        data: updatedTicket
      });

    } catch (error) {
      next(error);
    }
  }
);

// --------------------------------------------------
// ASSIGN OR REASSIGN A TICKET (ADMIN ONLY)
// --------------------------------------------------

app.put(
  "/api/tickets/:id/assign",
  authenticateToken,
  authorizeRoles("ADMIN"),
  async (req, res, next) => {
    try {
      const ticketId = Number(req.params.id);
      const { assignedTo } = req.body ?? {};

      if (!Number.isSafeInteger(ticketId) || ticketId <= 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid ticket ID"
        });
      }

      if (
        typeof assignedTo !== "string" ||
        !assignedTo.trim() ||
        assignedTo.trim().length > 120
      ) {
        return res.status(400).json({
          success: false,
          message: "A valid support engineer identifier is required"
        });
      }

      const result = await dynamoDB.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { id: ticketId }
        })
      );

      if (!result.Item || !isTicketRecord(result.Item)) {
        return res.status(404).json({
          success: false,
          message: "Ticket not found"
        });
      }

      const currentTicket = result.Item;
      const normalizedAssignedEmail = assignedTo.trim().toLowerCase();

      // Only assign tickets to active support engineers.
      const supportEngineer = await findActiveSupportEngineer(
        normalizedAssignedEmail
      );

      if (!supportEngineer) {
        return res.status(400).json({
          success: false,
          message: "The selected active support engineer does not exist."
        });
      }

      const previousEngineer = currentTicket.assignedTo ?? null;
      const newEngineer = supportEngineer.email;
      const isReassignment = Boolean(previousEngineer);

      const activity = createActivity({
        action: isReassignment ? "TICKET_REASSIGNED" : "TICKET_ASSIGNED",
        description: isReassignment
          ? `Ticket reassigned from ${previousEngineer} to ${newEngineer}`
          : `Ticket assigned to ${newEngineer}`,
        oldValue: previousEngineer,
        newValue: newEngineer,
        performedBy: req.user.email
      });

      const activityHistory = Array.isArray(currentTicket.activityHistory)
        ? [...currentTicket.activityHistory]
        : [];

      activityHistory.push(activity);

      const updatedTicket = {
        ...currentTicket,
        version: getTicketVersion(currentTicket) + 1,
        assignedTo: newEngineer,
        assignedAt: new Date().toISOString(),
        assignmentStatus: "Assigned",
        activityHistory
      };

      await dynamoDB.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: updatedTicket,
          ...buildTicketWriteCondition(currentTicket)
        })
      );

      if (String(currentTicket.assignedTo || "").toLowerCase() !== supportEngineer.email.toLowerCase()) {
        await safeCreateNotification({
          userId: supportEngineer.userId, ticketId,
          type: isReassignment ? "TICKET_REASSIGNED" : "TICKET_ASSIGNED",
          title: isReassignment ? "Ticket reassigned to you" : "New ticket assigned to you",
          message: `Ticket #${ticketId} "${currentTicket.title}" has been assigned to you.`
        });
      }

      res.status(200).json({
        success: true,
        message: isReassignment
          ? "Ticket reassigned successfully"
          : "Ticket assigned successfully",
        data: updatedTicket
      });

    } catch (error) {
      next(error);
    }
  }
);

// --------------------------------------------------
// DELETE AN EXISTING TICKET (ADMIN ONLY)
// --------------------------------------------------

app.delete(
  "/api/tickets/:id",
  authenticateToken,
  authorizeRoles("ADMIN"),
  async (req, res, next) => {
    try {
      const ticketId = Number(req.params.id);

      if (!Number.isSafeInteger(ticketId) || ticketId <= 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid ticket ID"
        });
      }

      const result = await dynamoDB.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { id: ticketId }
        })
      );

      if (!result.Item || !isTicketRecord(result.Item)) {
        return res.status(404).json({
          success: false,
          message: "Ticket not found"
        });
      }

      await dynamoDB.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: { id: ticketId },
          ...buildTicketWriteCondition(result.Item)
        })
      );

      res.status(200).json({
        success: true,
        message: "Ticket deleted successfully",
        data: result.Item
      });

    } catch (error) {
      next(error);
    }
  }
);
// --------------------------------------------------
// NOTIFICATION APIs
// --------------------------------------------------

// GET USER NOTIFICATIONS
app.get("/api/notifications", authenticateToken, async (req, res, next) => {
  try {
    const result = await getNotificationsByUserId(req.user.id);

    res.status(200).json({
      success: true,
      count: result.notifications.length,
      unreadCount: result.unreadCount,
      data: result.notifications
    });
  } catch (error) {
    next(error);
  }
});

// MARK ONE NOTIFICATION AS READ
app.patch(
  "/api/notifications/:id/read",
  authenticateToken,
  async (req, res, next) => {
    try {
      const updated = await markNotificationAsRead(
        req.params.id,
        req.user.id
      );

      if (!updated) {
        return res.status(404).json({
          success: false,
          message: "Notification not found"
        });
      }

      return res.json({
        success: true,
        message: "Notification marked as read"
      });
    } catch (error) {
      next(error);
    }
  }
);

// MARK ALL NOTIFICATIONS AS READ
app.patch(
  "/api/notifications/read-all",
  authenticateToken,
  async (req, res, next) => {
    try {
      const updatedCount = await markAllNotificationsAsRead(req.user.id);

      return res.json({
        success: true,
        message: "All notifications marked as read",
        updatedCount
      });
    } catch (error) {
      next(error);
    }
  }
);

// --------------------------------------------------
// RESOLVEBOT AI CHAT API
// --------------------------------------------------

app.use("/api/chat", createChatRouter({ authenticateToken }));

// --------------------------------------------------
// HANDLE INVALID ROUTES
// --------------------------------------------------

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "API endpoint not found"
  });
});

// --------------------------------------------------
// GLOBAL ERROR HANDLER
// --------------------------------------------------

app.use((err, req, res, next) => {
  if (err?.name === "ConditionalCheckFailedException") {
    return res.status(409).json({
      success: false,
      message:
        "This ticket was changed by another user or no longer exists. Refresh the ticket and try again."
    });
  }

  console.error("Backend error:", err);

  res.status(500).json({
    success: false,
    message: "Internal server error"
  });
});

// --------------------------------------------------
// EXPORT EXPRESS APP
// --------------------------------------------------

export default app;

// --------------------------------------------------
// START SERVER ONLY WHEN RUN DIRECTLY
// --------------------------------------------------

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  app.listen(PORT, () => {
    console.log(`Helpdesk backend running on port ${PORT}`);
    console.log(`DynamoDB table: ${TABLE_NAME}`);
    console.log(`AWS region: ${process.env.AWS_REGION}`);
  });
}