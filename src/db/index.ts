import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '../../data/openassist.db');

// Initialize database
const db = new Database(dbPath);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    settings TEXT DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    message TEXT NOT NULL,
    schedule TEXT NOT NULL,
    next_run TEXT,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS tool_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    used_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// User management functions

/**
 * Creates or updates a user
 */
export function createUser(userId: string, name?: string): { id: string; name: string | null; created_at: string; settings: object } {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  
  if (existing) {
    if (name) {
      db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, userId);
    }
    return getUser(userId)!;
  }
  
  db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run(userId, name || null);
  return getUser(userId)!;
}

/**
 * Gets user data by ID
 */
export function getUser(userId: string): { id: string; name: string | null; created_at: string; settings: object } | undefined {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as any;
  if (!row) return undefined;
  
  return {
    id: row.id,
    name: row.name,
    created_at: row.created_at,
    settings: JSON.parse(row.settings || '{}'),
  };
}

/**
 * Updates user settings
 */
export function updateUserSettings(userId: string, settings: object): { id: string; name: string | null; created_at: string; settings: object } | undefined {
  const settingsJson = JSON.stringify(settings);
  db.prepare('UPDATE users SET settings = ? WHERE id = ?').run(settingsJson, userId);
  return getUser(userId);
}

// Export the db singleton for other modules
export { db };

export default db;
