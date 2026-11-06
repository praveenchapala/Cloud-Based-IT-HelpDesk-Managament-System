
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

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

app.use(cors({
  origin: "http://localhost:5173"
}));

app.use(express.json());

const validPriorities = ["Low", "Medium", "High"];
const validStatuses = ["Open", "In Progress", "Resolved"];

// GET: Health check
app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Helpdesk backend is running",
    timestamp: new Date().toISOString()
  });
});

// GET: Retrieve all tickets
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

// GET: Retrieve ticket by ID
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

// POST: Create a new ticket
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

    const newTicket = {
      id: Date.now(),
      title: title.trim(),
      employee: employee.trim(),
      department: department.trim(),
      priority: selectedPriority,
      status: "Open",
      description: description.trim(),
      date: new Date().toISOString().slice(0, 10)
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

// PUT: Update an existing ticket
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

    const updatedTicket = {
      ...currentTicket,
      ...updates
    };

    for (const field of Object.keys(stringLimits)) {
      if (field in updates) {
        updatedTicket[field] = updates[field].trim();
      }
    }

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

// DELETE: Delete an existing ticket
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

// Handle invalid routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "API endpoint not found"
  });
});

// Handle unexpected errors
app.use((err, req, res, next) => {
  console.error("Backend error:", err);

  res.status(500).json({
    success: false,
    message: "Internal server error"
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Helpdesk backend running on port ${PORT}`);
  console.log(`DynamoDB table: ${TABLE_NAME}`);
  console.log(`AWS region: ${process.env.AWS_REGION}`);
});
