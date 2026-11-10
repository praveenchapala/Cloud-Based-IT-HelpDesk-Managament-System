import "dotenv/config";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

import {
  ScanCommand,
  GetCommand,
  PutCommand
} from "@aws-sdk/lib-dynamodb";

import { dynamoDB, TABLE_NAME } from "../src/dynamodb.js";

const APPLY = process.argv.includes("--apply");
const MAX_ID_ATTEMPTS = 1000;
const WRITE_DELAY_MS = Number(process.env.DYNAMODB_MIGRATION_WRITE_DELAY_MS ?? 0);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const source =
  process.env.RESOLVEIT_DB_PATH ||
  path.resolve(__dirname, "../data/resolveit.db");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function generateNumericId(recordType, sourceId, attempt) {
  const hash = createHash("sha256")
    .update(`${recordType}:${sourceId}:${attempt}`)
    .digest();

  return hash.readUIntBE(0, 6) + 1;
}

function sameLogicalRecord(existing, record) {
  if (!existing || existing.recordType !== record.recordType) return false;

  if (record.recordType === "USER") {
    return existing.sourceId === record.sourceId ||
      existing.userId === record.userId;
  }

  return existing.sourceId === record.sourceId ||
    existing.notificationId === record.notificationId;
}

async function scanExistingRecords() {
  const records = [];
  let lastKey;

  do {
    const result = await dynamoDB.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        ProjectionExpression:
          "#id, #recordType, #sourceId, #userId, #notificationId",
        ExpressionAttributeNames: {
          "#id": "id",
          "#recordType": "recordType",
          "#sourceId": "sourceId",
          "#userId": "userId",
          "#notificationId": "notificationId"
        },
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {})
      })
    );

    records.push(...(result.Items || []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return records;
}

function buildSourceRecords(users, notifications) {
  return [
    ...users.map((user) => ({
      recordType: "USER",
      sourceId: user.id,
      userId: user.id,
      name: user.name,
      email: user.email.trim().toLowerCase(),
      password_hash: user.password_hash,
      role: user.role,
      is_active: Number(user.is_active),
      created_at: user.created_at
    })),
    ...notifications.map((notification) => ({
      recordType: "NOTIFICATION",
      sourceId: notification.id,
      notificationId: notification.id,
      userId: notification.user_id,
      ticketId:
        /^\\d+$/.test(String(notification.ticket_id)) &&
        Number.isSafeInteger(Number(notification.ticket_id))
          ? Number(notification.ticket_id)
          : String(notification.ticket_id),
      type: notification.type,
      title: notification.title,
      message: notification.message,
      is_read: Number(notification.is_read),
      created_at: notification.created_at
    }))
  ];
}

async function verifyMigration(sourceRecords) {
  const currentRecords = await scanExistingRecords();
  const missing = sourceRecords.filter(
    (sourceRecord) =>
      !currentRecords.some((item) => sameLogicalRecord(item, sourceRecord))
  );

  if (missing.length > 0) {
    throw new Error(
      `Post-migration verification failed: ${missing.length} source records are missing.`
    );
  }

  return {
    verified: sourceRecords.length,
    totalRecordsInTable: currentRecords.length
  };
}

async function main() {
  if (!TABLE_NAME) throw new Error("DYNAMODB_TABLE is not configured.");
  if (!process.env.AWS_REGION && !process.env.AWS_DEFAULT_REGION) {
    throw new Error("AWS_REGION is not configured.");
  }
  if (!fs.existsSync(source)) {
    throw new Error(`SQLite database not found: ${source}`);
  }

  const sqlite = new Database(source, {
    readonly: true,
    fileMustExist: true
  });

  try {
    const users = sqlite.prepare(`
      SELECT id, name, email, password_hash, role, is_active, created_at
      FROM users ORDER BY id
    `).all();

    const notifications = sqlite.prepare(`
      SELECT id, user_id, ticket_id, type, title, message, is_read, created_at
      FROM notifications ORDER BY id
    `).all();

    const orphaned = sqlite.prepare(`
      SELECT COUNT(*) AS count
      FROM notifications n
      LEFT JOIN users u ON u.id = n.user_id
      WHERE u.id IS NULL
    `).get().count;

    if (orphaned > 0) {
      throw new Error(
        `Found ${orphaned} notifications without matching users. Migration stopped.`
      );
    }

    const emailSet = new Set();
    for (const user of users) {
      const email = user.email.trim().toLowerCase();
      if (emailSet.has(email)) {
        throw new Error(`Duplicate SQLite email detected: ${email}`);
      }
      emailSet.add(email);
    }

    const sourceUserIds = new Set(users.map((user) => user.id));
    for (const notification of notifications) {
      if (!sourceUserIds.has(notification.user_id)) {
        throw new Error(
          `Notification ${notification.id} references a missing user.`
        );
      }
    }

    console.log("SQLite validation passed.");
    console.log("SQLite source:", source);
    console.log("Users:", users.length);
    console.log("Notifications:", notifications.length);

    const existing = await scanExistingRecords();
    const occupiedIds = new Map(
      existing.map((item) => [String(item.id), item])
    );
    const records = buildSourceRecords(users, notifications);

    let skipped = 0;
    const plans = [];
    const reservedIds = new Set();

    for (const record of records) {
      const alreadyMigrated = existing.find(
        (item) => sameLogicalRecord(item, record)
      );

      if (alreadyMigrated) {
        skipped++;
        continue;
      }

      let selectedId = null;

      for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt++) {
        const candidate = generateNumericId(
          record.recordType,
          record.sourceId,
          attempt
        );
        const candidateKey = String(candidate);
        const occupied = occupiedIds.get(candidateKey);

        if (occupied || reservedIds.has(candidateKey)) continue;

        selectedId = candidate;
        break;
      }

      if (selectedId === null) {
        throw new Error(
          `Could not allocate a numeric id for ${record.recordType} ${record.sourceId}`
        );
      }

      const item = { ...record, id: selectedId };
      reservedIds.add(String(selectedId));
      plans.push(item);
    }

    console.log("\nMigration plan:");
    console.log("Existing DynamoDB records:", existing.length);
    console.log("Records to migrate:", plans.length);
    console.log("Already migrated / skipped:", skipped);
    console.log("Users planned:", plans.filter((item) => item.recordType === "USER").length);
    console.log(
      "Notifications planned:",
      plans.filter((item) => item.recordType === "NOTIFICATION").length
    );

    if (!APPLY) {
      console.log("\nDRY RUN ONLY. No DynamoDB records were written.");
      console.log("After reviewing the plan and backing up the source database, run with --apply.");
      return;
    }

    let migrated = 0;
    let migrationSkipped = 0;

    for (const item of plans) {
      try {
        await dynamoDB.send(
          new PutCommand({
            TableName: TABLE_NAME,
            Item: item,
            ConditionExpression: "attribute_not_exists(id)"
          })
        );

        migrated++;
        console.log(`Migrated ${item.recordType}: ${item.sourceId}`);

        if (WRITE_DELAY_MS > 0 && migrated < plans.length) {
          await sleep(WRITE_DELAY_MS);
        }
      } catch (error) {
        if (error.name === "ConditionalCheckFailedException") {
          const result = await dynamoDB.send(
            new GetCommand({
              TableName: TABLE_NAME,
              Key: { id: item.id }
            })
          );

          if (sameLogicalRecord(result.Item, item)) {
            migrationSkipped++;
            continue;
          }
        }

        throw error;
      }
    }

    const verification = await verifyMigration(records);

    console.log("\nMigration completed.");
    console.log("New records written:", migrated);
    console.log("Records skipped:", skipped + migrationSkipped);
    console.log("Source users:", users.length);
    console.log("Source notifications:", notifications.length);
    console.log("Records verified:", verification.verified);
    console.log("Total records in DynamoDB table:", verification.totalRecordsInTable);
    console.log("Verification passed.");
  } finally {
    sqlite.close();
  }
}

main().catch((error) => {
  console.error("\nMigration failed:", error);
  process.exitCode = 1;
});
