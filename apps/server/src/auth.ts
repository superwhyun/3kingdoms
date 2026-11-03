import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { DB } from './db';

export interface User {
  id: number;
  name: string;
  isAdmin: boolean;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(expected, actual);
}

export class AuthError extends Error {}

export function register(db: DB, name: string, password: string): { token: string; user: User } {
  const exists = db.prepare('SELECT id FROM users WHERE name = ?').get(name);
  if (exists) throw new AuthError('이미 사용 중인 이름이다');
  // 최초 가입자는 admin
  const first = !db.prepare('SELECT id FROM users LIMIT 1').get();
  const r = db
    .prepare('INSERT INTO users (name, pass_hash, created_at, is_admin) VALUES (?, ?, ?, ?)')
    .run(name, hashPassword(password), Date.now(), first ? 1 : 0);
  const user = { id: Number(r.lastInsertRowid), name, isAdmin: first };
  return { token: createSession(db, user.id), user };
}

export function login(db: DB, name: string, password: string): { token: string; user: User } {
  const row = db.prepare('SELECT id, name, pass_hash, is_admin FROM users WHERE name = ?').get(name) as
    | { id: number; name: string; pass_hash: string; is_admin: number }
    | undefined;
  if (!row || !verifyPassword(password, row.pass_hash)) throw new AuthError('이름 또는 비밀번호가 틀렸다');
  return { token: createSession(db, row.id), user: { id: row.id, name: row.name, isAdmin: !!row.is_admin } };
}

function createSession(db: DB, userId: number): string {
  const token = randomBytes(24).toString('base64url');
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(token, userId, Date.now());
  return token;
}

export function userByToken(db: DB, token: string | undefined): User | null {
  if (!token) return null;
  const row = db
    .prepare('SELECT u.id, u.name, u.is_admin FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?')
    .get(token) as { id: number; name: string; is_admin: number } | undefined;
  return row ? { id: row.id, name: row.name, isAdmin: !!row.is_admin } : null;
}

export function logout(db: DB, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}
