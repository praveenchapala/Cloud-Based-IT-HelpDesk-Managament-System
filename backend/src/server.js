
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { randomUUID } from "crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

import { dynamoDB, TABLE_NAME } from "./dynamodb.js";
import db from "./database.js";

import {
  ScanCommand,
  GetCommand,
  PutCommand,
  DeleteCommand
} from "@aws-sdk/lib-dynamodb";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(
  cors({
    origin: "http://localhost:5173"
  })
);

app.use(express.json());

const validPriorities = ["Low", "Medium", "High"];
const validStatuses = ["Open", "In Progress", "Resolved"];

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

    // Public registration always creates an EMPLOYEE.
    // Never accept a role from the registration request.
    const existingUser = db.prepare(
      "SELECT id FROM users WHERE email = ?"
    ).get(normalizedEmail);

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists"
      });
    }

    const userId = randomUUID();
    const passwordHash = await bcrypt.hash(password, 12);

    const insertUser = db.prepare(`
      INSERT INTO users (id, name, email, password_hash, role)
      VALUES (?, ?, ?, ?, 'EMPLOYEE')
    `);

    insertUser.run(
      userId,
      normalizedName,
      normalizedEmail,
      passwordHash
    );

    const createdUser = db.prepare(`
      SELECT id, name, email, role, is_active, created_at
      FROM users
      WHERE id = ?
    `).get(userId);

    return res.status(201).json({
      success: true,
      message: "Account registered successfully",
      data: createdUser
    });

  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
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

    const user = db.prepare(`
      SELECT id, name, email, password_hash, role, is_active
      FROM users
      WHERE email = ?
    `).get(normalizedEmail);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    if (user.is_active !== 1) {
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
        subject: user.id,
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
          id: user.id,
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

const authenticateToken = (req, res, next) => {
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
    // Always retrieve the current user and role from SQLite.
    const user = db.prepare(`
      SELECT id, name, email, role, is_active
      FROM users
      WHERE id = ?
    `).get(decoded.sub);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User account not found."
      });
    }

    if (user.is_active !== 1) {
      return res.status(403).json({
        success: false,
        message: "Your account is inactive."
      });
    }

    req.user = user;
    next();

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

const canAccessTicket = (user, ticket) => {
  if (user.role === "ADMIN") {
    return true;
  }

  if (user.role === "EMPLOYEE") {
    return ticket.createdByUserId === user.id;
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

    const allTickets = result.Items || [];

    // Filter tickets on the backend, not in React.
    const tickets = allTickets.filter(ticket =>
      canAccessTicket(req.user, ticket)
    );

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

      if (!result.Item) {
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

      if (!result.Item) {
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
        data: result.Item
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

      res.status(201).json({
        success: true,
        message: "Ticket created successfully",
        data: newTicket
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

      if (!result.Item) {
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
        ...normalizedUpdates
      };

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

      updatedTicket.activityHistory = activityHistory;

      await dynamoDB.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: updatedTicket,
          ConditionExpression: "attribute_exists(id)"
        })
      );

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

      if (!result.Item) {
        return res.status(404).json({
          success: false,
          message: "Ticket not found"
        });
      }

      const currentTicket = result.Item;
      const normalizedAssignedEmail = assignedTo.trim().toLowerCase();

      // Only assign tickets to active support engineers.
      const supportEngineer = db.prepare(`
        SELECT id, name, email
        FROM users
        WHERE email = ?
          AND role = 'SUPPORT_ENGINEER'
          AND is_active = 1
      `).get(normalizedAssignedEmail);

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
        assignedTo: newEngineer,
        assignedAt: new Date().toISOString(),
        assignmentStatus: "Assigned",
        activityHistory
      };

      await dynamoDB.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: updatedTicket,
          ConditionExpression: "attribute_exists(id)"
        })
      );

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

      if (!result.Item) {
        return res.status(404).json({
          success: false,
          message: "Ticket not found"
        });
      }

      await dynamoDB.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: { id: ticketId },
          ConditionExpression: "attribute_exists(id)"
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
  console.error("Backend error:", err);

  res.status(500).json({
    success: false,
    message: "Internal server error"
  });
});

// --------------------------------------------------
// START SERVER
// --------------------------------------------------

app.listen(PORT, () => {
  console.log(`Helpdesk backend running on port ${PORT}`);
  console.log(`DynamoDB table: ${TABLE_NAME}`);
  console.log(`AWS region: ${process.env.AWS_REGION}`);
});
