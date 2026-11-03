import { DatabaseSync } from 'node:sqlite';

export type DB = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  scenario_id TEXT NOT NULL,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL,
  turn_minutes INTEGER NOT NULL,
  deadline INTEGER,
  state_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS seats (
  game_id INTEGER NOT NULL REFERENCES games(id),
  faction_id TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  ready INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (game_id, faction_id),
  UNIQUE (game_id, user_id)
);
CREATE TABLE IF NOT EXISTS orders (
  game_id INTEGER NOT NULL REFERENCES games(id),
  turn INTEGER NOT NULL,
  faction_id TEXT NOT NULL,
  commands_json TEXT NOT NULL,
  PRIMARY KEY (game_id, turn, faction_id)
);
CREATE TABLE IF NOT EXISTS snapshots (
  game_id INTEGER NOT NULL REFERENCES games(id),
  turn INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  PRIMARY KEY (game_id, turn)
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  from_faction TEXT,
  to_faction TEXT,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_game ON messages(game_id, id);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function openDb(path: string): DB {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  // 마이그레이션: users.is_admin
  const cols = db.prepare('PRAGMA table_info(users)').all() as { name: string }[];
  if (!cols.some((c) => c.name === 'is_admin')) db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
  return db;
}

export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
