import { Router } from "express";
import {
  getIncidentById,
  scanIncidents,
  updateIncident
} from "../incidentRepository.js";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { dynamoDB, TABLE_NAME } from "../dynamodb.js";

const ALLOWED_SEVERITIES = ["P1", "P2", "P3", "P4"];

const ALLOWED_TRANSITIONS = {
  INVESTIGATING: ["IDENTIFIED"],
  IDENTIFIED: ["MONITORING"],
  MONITORING: ["RESOLVED"],
  RESOLVED: ["CLOSED"]
};

const TERMINAL_STATUSES = ["CLOSED", "DISMISSED"];

function isTicket(item) {
  if (!item || (item.recordType && item.recordType !== "TICKET")) {
    return false;
  }

  return (
    typeof item.title === "string" &&
    typeof item.description === "string"
  );
}

function isAssignedToIncident(user, incident) {
  return (
    incident.commanderUserId === user.id ||
    incident.commanderEmail === user.email
  );
}

function handleIncidentError(error, res, next) {
  if (error.name === "ConditionalCheckFailedException") {
    return res.status(409).json({
      success: false,
      message: "This incident was updated by another user. Refresh and try again."
    });
  }

  return next(error);
}

export function createIncidentRouter({ authenticateToken }) {
  const router = Router();

  router.use(authenticateToken);

  // GET all incidents
  router.get("/", async (req, res, next) => {
    try {
      if (!["ADMIN", "SUPPORT_ENGINEER"].includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          message: "Incident access is restricted to IT staff."
        });
      }

      const incidents = await scanIncidents();

      let visible = incidents;

      if (req.user.role === "SUPPORT_ENGINEER") {
        visible = incidents.filter((incident) =>
          isAssignedToIncident(req.user, incident)
        );
      }

      return res.json({
        success: true,
        count: visible.length,
        data: visible
      });
    } catch (error) {
      return next(error);
    }
  });

  // GET incident details and all related tickets
  router.get("/:id", async (req, res, next) => {
    try {
      if (!["ADMIN", "SUPPORT_ENGINEER"].includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          message: "Incident access is restricted to IT staff."
        });
      }

      const incident = await getIncidentById(req.params.id);

      if (!incident) {
        return res.status(404).json({
          success: false,
          message: "Incident not found."
        });
      }

      if (
        req.user.role === "SUPPORT_ENGINEER" &&
        !isAssignedToIncident(req.user, incident)
      ) {
        return res.status(403).json({
          success: false,
          message: "You are not assigned to this incident."
        });
      }

      const tickets = [];
      let lastEvaluatedKey;

      do {
        const result = await dynamoDB.send(new ScanCommand({
          TableName: TABLE_NAME,
          ...(lastEvaluatedKey
            ? { ExclusiveStartKey: lastEvaluatedKey }
            : {})
        }));

        const matchingTickets = (result.Items || []).filter(
          (item) =>
            isTicket(item) &&
            item.incidentId === incident.incidentId
        );

        tickets.push(...matchingTickets);
        lastEvaluatedKey = result.LastEvaluatedKey;
      } while (lastEvaluatedKey);

      return res.json({
        success: true,
        data: {
          ...incident,
          tickets
        }
      });
    } catch (error) {
      return next(error);
    }
  });

  // ADMIN confirms a detected incident
  router.patch("/:id/confirm", async (req, res, next) => {
    try {
      if (req.user.role !== "ADMIN") {
        return res.status(403).json({
          success: false,
          message: "Only administrators can confirm major incidents."
        });
      }

      const incident = await getIncidentById(req.params.id);

      if (!incident) {
        return res.status(404).json({
          success: false,
          message: "Incident not found."
        });
      }

      if (incident.status !== "DETECTED") {
        return res.status(409).json({
          success: false,
          message: "Only detected incidents can be confirmed."
        });
      }

      if (
        req.body?.severity !== undefined &&
        !ALLOWED_SEVERITIES.includes(req.body.severity)
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid severity. Allowed values are P1, P2, P3, and P4."
        });
      }

      const updated = await updateIncident(
        req.params.id,
        {
          status: "INVESTIGATING",
          severity: req.body?.severity ?? incident.severity,
          commanderUserId: req.user.id,
          commanderEmail: req.user.email
        },
        req.user
      );

      return res.json({
        success: true,
        message: "Major incident confirmed.",
        data: updated
      });
    } catch (error) {
      return handleIncidentError(error, res, next);
    }
  });

  // ADMIN dismisses a false positive
  router.patch("/:id/dismiss", async (req, res, next) => {
    try {
      if (req.user.role !== "ADMIN") {
        return res.status(403).json({
          success: false,
          message: "Only administrators can dismiss detected incidents."
        });
      }

      const incident = await getIncidentById(req.params.id);

      if (!incident) {
        return res.status(404).json({
          success: false,
          message: "Incident not found."
        });
      }

      if (incident.status !== "DETECTED") {
        return res.status(409).json({
          success: false,
          message: "Only detected incidents can be dismissed."
        });
      }

      const updated = await updateIncident(
        req.params.id,
        { status: "DISMISSED" },
        req.user
      );

      return res.json({
        success: true,
        message: "Incident dismissed.",
        data: updated
      });
    } catch (error) {
      return handleIncidentError(error, res, next);
    }
  });

  // Update incident details and advance lifecycle
  router.patch("/:id", async (req, res, next) => {
    try {
      if (!["ADMIN", "SUPPORT_ENGINEER"].includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          message: "Incident update access is restricted to IT staff."
        });
      }

      const current = await getIncidentById(req.params.id);

      if (!current) {
        return res.status(404).json({
          success: false,
          message: "Incident not found."
        });
      }

      if (
        req.user.role === "SUPPORT_ENGINEER" &&
        !isAssignedToIncident(req.user, current)
      ) {
        return res.status(403).json({
          success: false,
          message: "You are not assigned to this incident."
        });
      }

      // Dismissed and closed incidents cannot be modified.
      if (TERMINAL_STATUSES.includes(current.status)) {
        return res.status(409).json({
          success: false,
          message: `Incidents with status ${current.status} cannot be modified.`
        });
      }

      const changes = {};

      // Validate lifecycle transitions.
      if (req.body?.status !== undefined) {
        if (typeof req.body.status !== "string") {
          return res.status(400).json({
            success: false,
            message: "Invalid incident status."
          });
        }

        const allowedNextStatuses = ALLOWED_TRANSITIONS[current.status] || [];

        if (!allowedNextStatuses.includes(req.body.status)) {
          return res.status(409).json({
            success: false,
            message: `Invalid incident transition from ${current.status} to ${req.body.status}.`
          });
        }

        changes.status = req.body.status;
      }

      // Validate root cause.
      if (req.body?.rootCause !== undefined) {
        if (
          typeof req.body.rootCause !== "string" ||
          req.body.rootCause.length > 2000
        ) {
          return res.status(400).json({
            success: false,
            message: "Root cause must be a string of at most 2000 characters."
          });
        }

        changes.rootCause = req.body.rootCause.trim();
      }

      // Validate resolution summary.
      if (req.body?.resolutionSummary !== undefined) {
        if (
          typeof req.body.resolutionSummary !== "string" ||
          req.body.resolutionSummary.length > 2000
        ) {
          return res.status(400).json({
            success: false,
            message: "Resolution summary must be a string of at most 2000 characters."
          });
        }

        changes.resolutionSummary = req.body.resolutionSummary.trim();
      }

      // Only administrators can change severity.
      if (req.body?.severity !== undefined) {
        if (
          req.user.role !== "ADMIN" ||
          !ALLOWED_SEVERITIES.includes(req.body.severity)
        ) {
          return res.status(400).json({
            success: false,
            message: "Invalid severity or insufficient permission."
          });
        }

        changes.severity = req.body.severity;
      }

      if (Object.keys(changes).length === 0) {
        return res.status(400).json({
          success: false,
          message: "No valid incident changes were provided."
        });
      }

      const updated = await updateIncident(
        req.params.id,
        changes,
        req.user
      );

      return res.json({
        success: true,
        data: updated
      });
    } catch (error) {
      return handleIncidentError(error, res, next);
    }
  });

  return router;
}
