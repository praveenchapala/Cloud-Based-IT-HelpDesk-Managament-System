
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
const databasePath = path.join(dataDirectory, "resolveit.db");

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
