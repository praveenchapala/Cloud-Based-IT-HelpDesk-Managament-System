
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { randomUUID } from "crypto";

import { dynamoDB, TABLE_NAME } from "./dynamodb.js";

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
  newValue = null
}) => {
  return {
    activityId: randomUUID(),
    action,
    description,
    performedBy: "System",
    timestamp: new Date().toISOString(),
    oldValue,
    newValue
  };
};

// --------------------------------------------------
// HEALTH CHECK
// --------------------------------------------------

app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Helpdesk backend is running",
    timestamp: new Date().toISOString()
  });
});

// --------------------------------------------------
// GET ALL TICKETS
// --------------------------------------------------

app.get("/api/tickets", async (req, res, next) => {
  try {
    const result = await dynamoDB.send(
      new ScanCommand({
        TableName: TABLE_NAME
      })
    );

    const tickets = result.Items || [];

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

app.get("/api/tickets/:id/activities", async (req, res, next) => {
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
});

// --------------------------------------------------
// GET TICKET BY ID
// --------------------------------------------------

app.get("/api/tickets/:id", async (req, res, next) => {
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

    res.status(200).json({
      success: true,
      data: result.Item
    });
  } catch (error) {
    next(error);
  }
});

// --------------------------------------------------
// CREATE A NEW TICKET
// --------------------------------------------------

app.post("/api/tickets", async (req, res, next) => {
  try {
    const {
      title,
      employee,
      department,
      priority,
      description
    } = req.body;

    if (
      typeof title !== "string" || !title.trim() ||
      typeof employee !== "string" || !employee.trim() ||
      typeof department !== "string" || !department.trim() ||
      typeof description !== "string" || !description.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Title, employee, department and description are required"
      });
    }

    if (
      title.length > 100 ||
      employee.length > 80 ||
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
      }
    });

    const newTicket = {
      id: ticketId,
      title: title.trim(),
      employee: employee.trim(),
      department: department.trim(),
      priority: selectedPriority,
      status: "Open",
      description: description.trim(),
      date: new Date().toISOString().slice(0, 10),

      // Ticket assignment defaults
      assignedTo: null,
      assignedAt: null,
      assignmentStatus: "Unassigned",

      // Activity history
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
});

// --------------------------------------------------
// UPDATE AN EXISTING TICKET
// --------------------------------------------------

app.put("/api/tickets/:id", async (req, res, next) => {
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

    const allowedFields = [
      "title",
      "employee",
      "department",
      "priority",
      "status",
      "description"
    ];

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

    const stringLimits = {
      title: 100,
      employee: 80,
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

    // Preserve existing activity history
    const activityHistory = Array.isArray(currentTicket.activityHistory)
      ? [...currentTicket.activityHistory]
      : [];

    // Record only fields that actually changed
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
          newValue
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
});

// --------------------------------------------------
// ASSIGN OR REASSIGN A TICKET
// --------------------------------------------------

app.put("/api/tickets/:id/assign", async (req, res, next) => {
  try {
    const ticketId = Number(req.params.id);
    const { assignedTo } = req.body;

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
    const previousEngineer = currentTicket.assignedTo ?? null;
    const newEngineer = assignedTo.trim();

    const isReassignment = Boolean(previousEngineer);

    const activity = createActivity({
      action: isReassignment ? "TICKET_REASSIGNED" : "TICKET_ASSIGNED",
      description: isReassignment
        ? `Ticket reassigned from ${previousEngineer} to ${newEngineer}`
        : `Ticket assigned to ${newEngineer}`,
      oldValue: previousEngineer,
      newValue: newEngineer
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
});

// --------------------------------------------------
// DELETE AN EXISTING TICKET
// --------------------------------------------------

app.delete("/api/tickets/:id", async (req, res, next) => {
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
});

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
