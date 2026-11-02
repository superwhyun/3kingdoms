import { randomInt } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { getScenario } from '@ch/data';
import {
  createGame as createState,
  resolveTurn,
  validateOrders,
  viewFor,
  type Command,
  type GameState,
  type Orders,
} from '@ch/engine';
import { tx, type DB } from './db';
import type { User } from './auth';

export type GameStatus = 'lobby' | 'running' | 'finished';

/** 현재 엔진이 다루는 상태 버전 */
export const STATE_VERSION = 2;

function loadState(r: { state_json: string }): GameState {
  const s = JSON.parse(r.state_json) as GameState;
  if (s.version !== STATE_VERSION) throw new GameError('이전 버전에서 만든 게임이라 열 수 없다', 410);
  return s;
}

export class GameError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

interface GameRow {
  id: number;
  name: string;
  scenario_id: string;
  owner_id: number;
  status: GameStatus;
  turn_minutes: number;
  deadline: number | null;
  state_json: string;
  created_at: number;
}

interface SeatRow {
  game_id: number;
  faction_id: string;
  user_id: number;
  ready: number;
  user_name: string;
}

export interface GameSummary {
  id: number;
  name: string;
  scenarioId: string;
  ownerId: number;
  status: GameStatus;
  turnMinutes: number;
  deadline: number | null;
  year: number;
  month: number;
  turn: number;
  winner: string | null;
  seats: { factionId: string; userId: number; userName: string; ready: boolean; alive: boolean }[];
  factions: { id: string; name: string; color: string; alive: boolean }[];
}

/** WebSocket 등으로 전달할 이벤트 */
export type GameEvent =
  | { type: 'lobby' }
  | { type: 'game'; gameId: number }
  | { type: 'turn'; gameId: number; turn: number }
  | { type: 'chat'; gameId: number; message: ChatMessage; recipients: number[] | null };

export interface ChatMessage {
  id: number;
  userName: string;
  fromFaction: string | null;
  toFaction: string | null;
  text: string;
  createdAt: number;
}

export class GameService {
  readonly events = new EventEmitter();

  constructor(
    private db: DB,
    private now: () => number = Date.now,
  ) {
    // 구버전 상태의 게임은 종료 처리해 스케줄러가 건드리지 않게 한다
    const rows = this.db.prepare("SELECT id, state_json FROM games WHERE status != 'finished'").all() as { id: number; state_json: string }[];
    for (const r of rows) {
      if ((JSON.parse(r.state_json) as { version?: number }).version !== STATE_VERSION) {
        this.db.prepare("UPDATE games SET status = 'finished', deadline = NULL WHERE id = ?").run(r.id);
      }
    }
  }

  private emit(e: GameEvent) {
    this.events.emit('event', e);
  }

  private row(id: number): GameRow {
    const r = this.db.prepare('SELECT * FROM games WHERE id = ?').get(id) as GameRow | undefined;
    if (!r) throw new GameError('게임이 없다', 404);
    return r;
  }

  private seats(id: number): SeatRow[] {
    return this.db
      .prepare('SELECT s.*, u.name AS user_name FROM seats s JOIN users u ON u.id = s.user_id WHERE s.game_id = ? ORDER BY s.faction_id')
      .all(id) as unknown as SeatRow[];
  }

  private summary(r: GameRow, state?: GameState): GameSummary {
    const s = state ?? (JSON.parse(r.state_json) as GameState);
    return {
      id: r.id,
      name: r.name,
      scenarioId: r.scenario_id,
      ownerId: r.owner_id,
      status: r.status,
      turnMinutes: r.turn_minutes,
      deadline: r.deadline,
      year: s.year,
      month: s.month,
      turn: s.turn,
      winner: s.winner,
      seats: this.seats(r.id).map((x) => ({
        factionId: x.faction_id,
        userId: x.user_id,
        userName: x.user_name,
        ready: !!x.ready,
        alive: s.factions[x.faction_id]?.alive ?? false,
      })),
      factions: Object.values(s.factions).map((f) => ({ id: f.id, name: f.name, color: f.color, alive: f.alive })),
    };
  }

  list(): GameSummary[] {
    const rows = this.db.prepare('SELECT * FROM games ORDER BY id DESC LIMIT 100').all() as unknown as GameRow[];
    return rows.map((r) => this.summary(r));
  }

  get(id: number): GameSummary {
    return this.summary(this.row(id));
  }

  create(user: User, opts: { name: string; scenarioId: string; turnMinutes: number; endYear?: number }): GameSummary {
    let scenario;
    try {
      scenario = getScenario(opts.scenarioId);
    } catch {
      throw new GameError('알 수 없는 시나리오');
    }
    const state = createState(scenario, { seed: randomInt(0, 2 ** 31), endYear: opts.endYear });
    const r = this.db
      .prepare(
        'INSERT INTO games (name, scenario_id, owner_id, status, turn_minutes, deadline, state_json, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)',
      )
      .run(opts.name, scenario.id, user.id, 'lobby', opts.turnMinutes, JSON.stringify(state), this.now());
    this.emit({ type: 'lobby' });
    return this.get(Number(r.lastInsertRowid));
  }

  seatOf(gameId: number, userId: number): string | null {
    const r = this.db.prepare('SELECT faction_id FROM seats WHERE game_id = ? AND user_id = ?').get(gameId, userId) as
      | { faction_id: string }
      | undefined;
    return r?.faction_id ?? null;
  }

  takeSeat(user: User, gameId: number, factionId: string): GameSummary {
    const g = this.row(gameId);
    if (g.status === 'finished') throw new GameError('끝난 게임이다');
    const state = loadState(g);
    const f = state.factions[factionId];
    if (!f) throw new GameError('알 수 없는 세력');
    if (!f.alive) throw new GameError('멸망한 세력이다');
    tx(this.db, () => {
      const taken = this.db.prepare('SELECT user_id FROM seats WHERE game_id = ? AND faction_id = ?').get(gameId, factionId) as
        | { user_id: number }
        | undefined;
      if (taken && taken.user_id !== user.id) throw new GameError('이미 다른 플레이어가 선택한 세력이다', 409);
      this.db.prepare('DELETE FROM seats WHERE game_id = ? AND user_id = ?').run(gameId, user.id);
      this.db.prepare('INSERT INTO seats (game_id, faction_id, user_id, ready) VALUES (?, ?, ?, 0)').run(gameId, factionId, user.id);
    });
    this.emit({ type: 'game', gameId });
    this.emit({ type: 'lobby' });
    return this.get(gameId);
  }

  leaveSeat(user: User, gameId: number): GameSummary {
    this.row(gameId);
    this.db.prepare('DELETE FROM seats WHERE game_id = ? AND user_id = ?').run(gameId, user.id);
    this.emit({ type: 'game', gameId });
    this.emit({ type: 'lobby' });
    this.maybeResolve(gameId);
    return this.get(gameId);
  }

  start(user: User, gameId: number): GameSummary {
    const g = this.row(gameId);
    if (g.owner_id !== user.id) throw new GameError('방장만 시작할 수 있다', 403);
    if (g.status !== 'lobby') throw new GameError('이미 시작된 게임이다');
    if (this.seats(gameId).length === 0) throw new GameError('최소 한 명은 세력을 선택해야 한다');
    this.db
      .prepare("UPDATE games SET status = 'running', deadline = ? WHERE id = ?")
      .run(this.now() + g.turn_minutes * 60_000, gameId);
    this.emit({ type: 'game', gameId });
    this.emit({ type: 'lobby' });
    return this.get(gameId);
  }

  /** 플레이어 시점 상태 + 내가 제출한 명령 */
  view(user: User | null, gameId: number) {
    const g = this.row(gameId);
    const state = loadState(g);
    const me = user ? this.seatOf(gameId, user.id) : null;
    const orders = me
      ? ((this.db
          .prepare('SELECT commands_json FROM orders WHERE game_id = ? AND turn = ? AND faction_id = ?')
          .get(gameId, state.turn, me) as { commands_json: string } | undefined)?.commands_json ?? null)
      : null;
    return {
      game: this.summary(g, state),
      view: viewFor(state, me),
      orders: orders ? (JSON.parse(orders) as Command[]) : [],
    };
  }

  submitOrders(user: User, gameId: number, turn: number, commands: Command[]) {
    const g = this.row(gameId);
    if (g.status !== 'running') throw new GameError('진행 중인 게임이 아니다');
    const me = this.seatOf(gameId, user.id);
    if (!me) throw new GameError('세력을 선택하지 않았다', 403);
    const state = loadState(g);
    if (turn !== state.turn) throw new GameError('이미 지나간 턴이다', 409);
    if (!state.factions[me]?.alive) throw new GameError('멸망한 세력이다');
    const v = validateOrders(state, me, commands);
    if (!v.ok) return v;
    this.db
      .prepare(
        'INSERT INTO orders (game_id, turn, faction_id, commands_json) VALUES (?, ?, ?, ?) ON CONFLICT(game_id, turn, faction_id) DO UPDATE SET commands_json = excluded.commands_json',
      )
      .run(gameId, turn, me, JSON.stringify(commands));
    return v;
  }

  setReady(user: User, gameId: number, turn: number, ready: boolean): GameSummary {
    const g = this.row(gameId);
    if (g.status !== 'running') throw new GameError('진행 중인 게임이 아니다');
    const me = this.seatOf(gameId, user.id);
    if (!me) throw new GameError('세력을 선택하지 않았다', 403);
    const state = loadState(g);
    if (turn !== state.turn) throw new GameError('이미 지나간 턴이다', 409);
    this.db.prepare('UPDATE seats SET ready = ? WHERE game_id = ? AND faction_id = ?').run(ready ? 1 : 0, gameId, me);
    this.emit({ type: 'game', gameId });
    this.maybeResolve(gameId);
    return this.get(gameId);
  }

  /** 살아있는 모든 인간 플레이어가 준비되면 턴을 해결한다 */
  private maybeResolve(gameId: number): boolean {
    const g = this.row(gameId);
    if (g.status !== 'running') return false;
    const state = loadState(g);
    const humans = this.seats(gameId).filter((s) => state.factions[s.faction_id]?.alive);
    if (humans.length > 0 && humans.every((s) => s.ready)) {
      this.resolve(gameId, false);
      return true;
    }
    return false;
  }

  /**
   * 턴 해결. byDeadline이면 명령을 제출하지 않은 플레이어 세력은 AI가 대행한다.
   */
  resolve(gameId: number, byDeadline: boolean): void {
    let newTurn = -1;
    tx(this.db, () => {
      const g = this.row(gameId);
      if (g.status !== 'running') return;
      const state = loadState(g);
      const seats = this.seats(gameId);
      const rows = this.db
        .prepare('SELECT faction_id, commands_json FROM orders WHERE game_id = ? AND turn = ?')
        .all(gameId, state.turn) as { faction_id: string; commands_json: string }[];
      const orders: Orders = {};
      for (const r of rows) orders[r.faction_id] = JSON.parse(r.commands_json);
      const human = new Set(seats.map((s) => s.faction_id));
      const ai = Object.keys(state.factions).filter(
        (f) => !human.has(f) || (byDeadline && !orders[f] && !seats.find((s) => s.faction_id === f)?.ready),
      );
      const next = resolveTurn(state, orders, { ai });
      this.db.prepare('INSERT OR REPLACE INTO snapshots (game_id, turn, state_json) VALUES (?, ?, ?)').run(gameId, state.turn, g.state_json);
      const status: GameStatus = next.finished ? 'finished' : 'running';
      this.db
        .prepare('UPDATE games SET state_json = ?, status = ?, deadline = ? WHERE id = ?')
        .run(JSON.stringify(next), status, next.finished ? null : this.now() + g.turn_minutes * 60_000, gameId);
      this.db.prepare('UPDATE seats SET ready = 0 WHERE game_id = ?').run(gameId);
      newTurn = next.turn;
    });
    if (newTurn >= 0) {
      this.emit({ type: 'turn', gameId, turn: newTurn });
      this.emit({ type: 'lobby' });
    }
  }

  /** 마감 시각이 지난 게임을 해결한다. 해결한 게임 수를 반환. */
  tick(): number {
    const due = this.db
      .prepare("SELECT id FROM games WHERE status = 'running' AND deadline IS NOT NULL AND deadline <= ?")
      .all(this.now()) as { id: number }[];
    for (const { id } of due) this.resolve(id, true);
    return due.length;
  }

  postMessage(user: User, gameId: number, text: string, toFaction: string | null): ChatMessage {
    const g = this.row(gameId);
    const state = loadState(g);
    const me = this.seatOf(gameId, user.id);
    if (toFaction !== null) {
      if (!state.factions[toFaction]) throw new GameError('알 수 없는 세력');
      if (!me) throw new GameError('귓속말은 세력을 선택한 뒤에 보낼 수 있다', 403);
    }
    const createdAt = this.now();
    const r = this.db
      .prepare('INSERT INTO messages (game_id, user_id, from_faction, to_faction, text, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(gameId, user.id, me, toFaction, text, createdAt);
    const message: ChatMessage = { id: Number(r.lastInsertRowid), userName: user.name, fromFaction: me, toFaction, text, createdAt };
    let recipients: number[] | null = null;
    if (toFaction) {
      recipients = [user.id];
      const target = this.seats(gameId).find((s) => s.faction_id === toFaction);
      if (target) recipients.push(target.user_id);
    }
    this.emit({ type: 'chat', gameId, message, recipients });
    return message;
  }

  messages(user: User | null, gameId: number): ChatMessage[] {
    this.row(gameId);
    const me = user ? this.seatOf(gameId, user.id) : null;
    const rows = this.db
      .prepare(
        `SELECT m.id, u.name AS user_name, m.user_id, m.from_faction, m.to_faction, m.text, m.created_at
         FROM messages m JOIN users u ON u.id = m.user_id
         WHERE m.game_id = ? AND (m.to_faction IS NULL OR m.user_id = ? OR m.to_faction = ?)
         ORDER BY m.id DESC LIMIT 200`,
      )
      .all(gameId, user?.id ?? -1, me ?? '') as {
      id: number;
      user_name: string;
      from_faction: string | null;
      to_faction: string | null;
      text: string;
      created_at: number;
    }[];
    return rows.reverse().map((r) => ({
      id: r.id,
      userName: r.user_name,
      fromFaction: r.from_faction,
      toFaction: r.to_faction,
      text: r.text,
      createdAt: r.created_at,
    }));
  }
}
