import { aiAcceptsProposal, planAI } from './ai';
import { applyProposalAnswer, commandPhase, executeCommand, type ExecContext } from './commands';
import { runEconomy } from './economy';
import { Rng } from './rng';
import { handleFactionLoss } from './succession';
import type { Command, FactionId, GameState, Orders } from './types';
import { citiesOf, factionName, pushLog } from './util';

export const PROPOSAL_TTL = 3;

export interface ResolveOptions {
  /** AI가 대행할 세력 */
  ai: FactionId[];
}

export interface OrderValidation {
  ok: boolean;
  errors: { index: number; message: string }[];
}

function phased(cmds: Command[]): { cmd: Command; index: number }[] {
  return cmds
    .map((cmd, index) => ({ cmd, index }))
    .sort((a, b) => commandPhase(a.cmd) - commandPhase(b.cmd) || a.index - b.index);
}

/** 한 세력의 명령 목록을 현재 상태 기준으로 검증한다 (자원 누적 소모 포함). */
export function validateOrders(state: GameState, faction: FactionId, cmds: Command[]): OrderValidation {
  if (!Array.isArray(cmds)) return { ok: false, errors: [{ index: -1, message: '명령 목록이 아니다' }] };
  if (cmds.length > 200) return { ok: false, errors: [{ index: -1, message: '명령이 너무 많다' }] };
  const draft = structuredClone(state);
  draft.log = [];
  const ctx: ExecContext = { rng: new Rng(state.rng ^ 0x5bd1e995), acted: new Set(), dry: true };
  const errors: OrderValidation['errors'] = [];
  for (const { cmd, index } of phased(cmds)) {
    if (!cmd || typeof cmd !== 'object' || typeof (cmd as Command).type !== 'string') {
      errors.push({ index, message: '잘못된 명령 형식' });
      continue;
    }
    let err: string | null;
    try {
      err = executeCommand(draft, faction, cmd, ctx);
    } catch {
      err = '잘못된 명령 형식';
    }
    if (err) errors.push({ index, message: err });
  }
  errors.sort((a, b) => a.index - b.index);
  return { ok: errors.length === 0, errors };
}

/** 한 달(1턴)을 해결하고 새 상태를 반환한다. 입력 상태는 변경하지 않는다. */
export function resolveTurn(prev: GameState, orders: Orders, opts: ResolveOptions): GameState {
  if (prev.finished) return prev;
  const state = structuredClone(prev);
  state.log = [];
  const rng = new Rng(state.rng);
  const ai = new Set(opts.ai);
  const alive = Object.values(state.factions).filter((f) => f.alive).map((f) => f.id).sort();

  const all = new Map<FactionId, { cmd: Command; index: number }[]>();
  for (const id of alive) {
    const cmds = ai.has(id) ? planAI(state, id, rng) : orders[id] ?? [];
    all.set(id, phased(Array.isArray(cmds) ? cmds : []));
  }

  const ctx: ExecContext = { rng, acted: new Set(), dry: false };
  for (let phase = 0; phase <= 3; phase++) {
    for (const id of rng.shuffle([...alive])) {
      for (const { cmd } of all.get(id) ?? []) {
        if (!cmd || typeof cmd !== 'object' || commandPhase(cmd) !== phase) continue;
        let err: string | null;
        try {
          err = executeCommand(state, id, cmd, ctx);
        } catch {
          err = '잘못된 명령 형식';
        }
        if (err && !ai.has(id)) pushLog(state, 'system', `명령 실패(${cmd.type}): ${err}`, [id]);
      }
    }
  }

  // AI 세력은 받은 제안에 즉시 응답
  for (const p of [...state.proposals]) {
    if (!ai.has(p.to)) continue;
    state.proposals = state.proposals.filter((x) => x.id !== p.id);
    applyProposalAnswer(state, p.from, p.to, p.kind, aiAcceptsProposal(state, p));
  }
  // 제안 만료
  for (const p of state.proposals.filter((x) => state.turn - x.turn >= PROPOSAL_TTL)) {
    pushLog(state, 'diplomacy', `${factionName(state, p.from)}의 제안이 응답 없이 만료되었다`, [p.from, p.to]);
  }
  state.proposals = state.proposals.filter((x) => state.turn - x.turn < PROPOSAL_TTL);

  runEconomy(state, rng);

  // 정전 만료
  for (const [key, rel] of Object.entries(state.relations)) {
    if (rel.status === 'truce' && rel.truceUntil !== null && state.turn >= rel.truceUntil) {
      rel.status = 'neutral';
      rel.truceUntil = null;
      const [a, b] = key.split('|');
      pushLog(state, 'diplomacy', `${factionName(state, a)}·${factionName(state, b)} 간 정전 기간이 끝났다`);
    }
  }

  for (const id of alive) handleFactionLoss(state, id, rng);

  // 날짜 진행
  state.turn += 1;
  state.month += 1;
  if (state.month > 12) {
    state.month = 1;
    state.year += 1;
  }

  checkVictory(state);
  state.rng = rng.state;
  return state;
}

function checkVictory(state: GameState): void {
  const alive = Object.values(state.factions).filter((f) => f.alive);
  if (alive.length === 1) {
    state.finished = true;
    state.winner = alive[0].id;
    pushLog(state, 'system', `${alive[0].name} 세력이 천하를 통일했다!`);
    return;
  }
  if (alive.length === 0) {
    state.finished = true;
    state.winner = null;
    return;
  }
  if (state.year > state.endYear) {
    const ranked = alive
      .map((f) => ({ f, n: citiesOf(state, f.id).length }))
      .sort((a, b) => b.n - a.n || a.f.id.localeCompare(b.f.id));
    state.finished = true;
    state.winner = ranked[0].f.id;
    pushLog(state, 'system', `기한이 다하였다. 가장 많은 도시를 차지한 ${ranked[0].f.name} 세력의 승리.`);
  }
}
