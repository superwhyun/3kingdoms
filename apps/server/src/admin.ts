import { DEFAULT_RULES, applyRulesPatch, diffRules, validateRulesPatch, type Rules } from '@ch/engine';
import type { DB } from './db';
import { GameError } from './games';

const RULES_KEY = 'rules_overrides';

export interface AdminUser {
  id: number;
  name: string;
  isAdmin: boolean;
  createdAt: number;
}

/** 전역 기본 규칙(새 게임에 적용)과 사용자 권한 관리 */
export class AdminService {
  constructor(private db: DB) {}

  /** 기본값 대비 바뀐 항목만 저장된 overrides */
  overrides(): Record<string, unknown> {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(RULES_KEY) as { value: string } | undefined;
    if (!row) return {};
    try {
      const parsed = JSON.parse(row.value);
      // 엔진 기본값 구조가 바뀌어 더 이상 유효하지 않은 항목이 있으면 무시
      return validateRulesPatch(parsed) === null ? parsed : {};
    } catch {
      return {};
    }
  }

  /** 새 게임에 적용될 규칙 */
  effectiveRules(): Rules {
    return applyRulesPatch(DEFAULT_RULES, this.overrides());
  }

  /** 전역 규칙 overrides를 통째로 교체한다 */
  setOverrides(patch: unknown): Record<string, unknown> {
    const err = validateRulesPatch(patch);
    if (err) throw new GameError(err);
    // 기본값과 같은 항목은 저장하지 않는다
    const clean = diffRules(DEFAULT_RULES, applyRulesPatch(DEFAULT_RULES, patch));
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(RULES_KEY, JSON.stringify(clean));
    return clean;
  }

  users(): AdminUser[] {
    return (
      this.db.prepare('SELECT id, name, is_admin, created_at FROM users ORDER BY id').all() as {
        id: number;
        name: string;
        is_admin: number;
        created_at: number;
      }[]
    ).map((r) => ({ id: r.id, name: r.name, isAdmin: !!r.is_admin, createdAt: r.created_at }));
  }

  setAdmin(actorId: number, userId: number, isAdmin: boolean): AdminUser[] {
    const exists = this.db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!exists) throw new GameError('사용자가 없다', 404);
    if (!isAdmin) {
      const admins = this.users().filter((u) => u.isAdmin);
      if (admins.length === 1 && admins[0].id === userId) throw new GameError('마지막 admin의 권한은 해제할 수 없다');
    }
    this.db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(isAdmin ? 1 : 0, userId);
    void actorId;
    return this.users();
  }
}
