
import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

// Resolve backend directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDirectory = path.resolve(__dirname, "../data");

// Ensure data directory exists
mkdirSync(dataDirectory, { recursive: true });

// Create or connect to SQLite database
const databasePath =
  process.env.RESOLVEIT_DB_PATH ||
  path.join(dataDirectory, "resolveit.db");

const db = new Database(databasePath);

// Enable foreign key support
db.pragma("foreign_keys = ON");

// Enable WAL mode for better read/write concurrency
db.pragma("journal_mode = WAL");

// Create users table
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'EMPLOYEE'
      CHECK (role IN ('ADMIN', 'SUPPORT_ENGINEER', 'EMPLOYEE')),
    is_active INTEGER NOT NULL DEFAULT 1
      CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

console.log("SQLite database connected successfully.");
console.log("Users table initialized successfully.");

export default db;
// --------------------------------------------------
// NOTIFICATIONS TABLE
// --------------------------------------------------

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
      REFERENCES users(id)
      ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications(user_id, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications(user_id, is_read);
`);

console.log("Notifications table initialized successfully.");