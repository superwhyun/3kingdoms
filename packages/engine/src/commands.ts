import { checkPlan, normalizePlan, resolveBattle } from './battle';
import type { Rng } from './rng';
import type { Command, FactionId, GameState, GeneralState } from './types';
import { BATTLE_ROUNDS, UNIT_LABEL, UNIT_TYPES, draftCost, isUnitType, parseUnits, sumUnits } from './units';
import { clamp, factionName, getRelation, isAdjacent, isHostile, josa, pushLog, totalTroops } from './util';

export const DEVELOP_COST = 50;
export const MAX_DEV = 999;
export const MAX_ATTACK_GENERALS = 5;
export const MIN_DRAFT = 100;

/** 거래 시세: 상업이 높을수록 유리. buy=금 1당 군량, sell=금 1을 얻는 데 드는 군량 */
export function tradeRate(commerce: number): { buy: number; sell: number } {
  const t = Math.min(commerce, 999) / 999;
  return { buy: 6 + 4 * t, sell: 14 - 4 * t };
}

export interface ExecContext {
  rng: Rng;
  /** 이번 턴에 이미 행동한 장수 */
  acted: Set<string>;
  /** true면 검증용 실행: 전투는 일어나지 않는다 */
  dry: boolean;
}

export function commandPhase(cmd: Command): number {
  switch (cmd?.type) {
    case 'propose':
    case 'respond':
    case 'break':
    case 'tribute':
      return 0;
    case 'move':
    case 'transport':
      return 2;
    case 'attack':
      return 3;
    default:
      return 1;
  }
}

const DEV_LABEL: Record<string, string> = {
  agriculture: '농업',
  commerce: '상업',
  defense: '성벽',
  loyalty: '민심',
};

function isInt(n: unknown, min = 0): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= min;
}

function actor(state: GameState, faction: FactionId, id: string, ctx: ExecContext): GeneralState | string {
  const g = state.generals[id];
  if (!g) return `알 수 없는 장수: ${id}`;
  if (g.status !== 'active' || g.faction !== faction) return `${g.name}: 아군 장수가 아니다`;
  if (ctx.acted.has(id)) return `${g.name}: 이번 달 이미 행동했다`;
  const city = state.cities[g.city];
  if (city.owner !== faction) return `${g.name}: 아군 도시에 있지 않다`;
  return g;
}

/**
 * 명령 하나를 실행한다. 성공 시 null, 실패 시 오류 메시지를 반환하며 실패 시 상태는 변하지 않는다.
 */
export function executeCommand(state: GameState, faction: FactionId, cmd: Command, ctx: ExecContext): string | null {
  const f = state.factions[faction];
  if (!f || !f.alive) return '세력이 존재하지 않는다';
  const rng = ctx.rng;
  const own = [faction];

  switch (cmd.type) {
    case 'develop': {
      const g = actor(state, faction, cmd.general, ctx);
      if (typeof g === 'string') return g;
      if (!(cmd.field in DEV_LABEL)) return '잘못된 개발 항목';
      const city = state.cities[g.city];
      if (city.gold < DEVELOP_COST) return `${city.name}: 금이 부족하다 (${DEVELOP_COST} 필요)`;
      if (cmd.field === 'loyalty' ? city.loyalty >= 100 : city[cmd.field] >= MAX_DEV) return `${city.name}: 이미 최대치다`;
      city.gold -= DEVELOP_COST;
      ctx.acted.add(g.id);
      let gain: number;
      if (cmd.field === 'loyalty') {
        gain = Math.max(1, Math.floor(g.cha / 12) + rng.int(0, 3));
        city.loyalty = clamp(city.loyalty + gain, 0, 100);
      } else {
        const stat = cmd.field === 'defense' ? Math.round((g.pol + g.war) / 2) : g.pol;
        gain = Math.max(1, Math.floor(stat / 5) + rng.int(0, 6));
        city[cmd.field] = clamp(city[cmd.field] + gain, 0, MAX_DEV);
      }
      pushLog(state, 'domestic', `${city.name}: ${josa(g.name, '이', '가')} ${DEV_LABEL[cmd.field]} +${gain}`, own, city.id);
      return null;
    }

    case 'draft': {
      const g = actor(state, faction, cmd.general, ctx);
      if (typeof g === 'string') return g;
      if (!isInt(cmd.amount, MIN_DRAFT)) return `징병 수는 ${MIN_DRAFT} 이상의 정수`;
      if (!isUnitType(cmd.unit)) return '알 수 없는 병종';
      const city = state.cities[g.city];
      if (cmd.unit === 'navy' && !(state.rivers[city.id]?.length > 0)) return `${city.name}: 강을 끼지 않은 도시는 수군을 징병할 수 없다`;
      const cost = draftCost(cmd.unit, cmd.amount);
      if (city.gold < cost) return `${city.name}: 금이 부족하다 (${cost} 필요)`;
      const limit = Math.floor(city.population / 20);
      if (cmd.amount > limit) return `${city.name}: 징병 가능 인원 초과 (최대 ${limit})`;
      city.gold -= cost;
      city.population -= cmd.amount;
      const cur = totalTroops(city);
      city.training = Math.round((cur * city.training + cmd.amount * 20) / (cur + cmd.amount));
      city.units[cmd.unit] += cmd.amount;
      city.loyalty = clamp(city.loyalty - Math.ceil(cmd.amount / 1000), 0, 100);
      ctx.acted.add(g.id);
      pushLog(state, 'domestic', `${city.name}: ${josa(g.name, '이', '가')} ${UNIT_LABEL[cmd.unit]} ${cmd.amount}명을 징병했다`, own, city.id);
      return null;
    }

    case 'train': {
      const g = actor(state, faction, cmd.general, ctx);
      if (typeof g === 'string') return g;
      const city = state.cities[g.city];
      if (totalTroops(city) <= 0) return `${city.name}: 훈련할 병사가 없다`;
      if (city.training >= 100) return `${city.name}: 훈련도가 이미 최대다`;
      const gain = 3 + Math.floor(g.war / 10) + rng.int(0, 3);
      city.training = clamp(city.training + gain, 0, 100);
      ctx.acted.add(g.id);
      pushLog(state, 'domestic', `${city.name}: ${josa(g.name, '이', '가')} 병사를 훈련했다 (훈련도 +${gain})`, own, city.id);
      return null;
    }

    case 'trade': {
      const g = actor(state, faction, cmd.general, ctx);
      if (typeof g === 'string') return g;
      if (cmd.action !== 'buy' && cmd.action !== 'sell') return '잘못된 거래 종류';
      if (!isInt(cmd.gold, 10)) return '거래 금액은 10 이상의 정수';
      const city = state.cities[g.city];
      const rate = tradeRate(city.commerce);
      if (cmd.action === 'buy') {
        if (city.gold < cmd.gold) return `${city.name}: 금이 부족하다`;
        const food = Math.floor(cmd.gold * rate.buy);
        city.gold -= cmd.gold;
        city.food += food;
        pushLog(state, 'domestic', `${city.name}: ${josa(g.name, '이', '가')} 금 ${cmd.gold}으로 군량 ${food}을 사들였다`, own, city.id);
      } else {
        const food = Math.ceil(cmd.gold * rate.sell);
        if (city.food < food) return `${city.name}: 군량이 부족하다 (${food} 필요)`;
        city.food -= food;
        city.gold += cmd.gold;
        pushLog(state, 'domestic', `${city.name}: ${josa(g.name, '이', '가')} 군량 ${food}을 팔아 금 ${cmd.gold}을 얻었다`, own, city.id);
      }
      ctx.acted.add(g.id);
      return null;
    }

    case 'search': {
      const g = actor(state, faction, cmd.general, ctx);
      if (typeof g === 'string') return g;
      const city = state.cities[g.city];
      ctx.acted.add(g.id);
      if (ctx.dry) return null;
      const hidden = Object.values(state.generals).filter((x) => x.status === 'hidden' && x.city === city.id);
      if (hidden.length && rng.chance((g.int + 30) / 160)) {
        const found = hidden[rng.int(0, hidden.length - 1)];
        found.status = 'free';
        pushLog(state, 'personnel', `${city.name}: ${josa(g.name, '이', '가')} 재야의 인재 ${josa(found.name, '을', '를')} 발견했다`, own, city.id);
      } else if (rng.chance(0.35)) {
        const gold = rng.int(20, 60 + g.int);
        city.gold += gold;
        pushLog(state, 'domestic', `${city.name}: ${josa(g.name, '이', '가')} 탐색 중 금 ${gold}을 얻었다`, own, city.id);
      } else {
        pushLog(state, 'domestic', `${city.name}: ${josa(g.name, '이', '가')} 탐색했으나 성과가 없었다`, own, city.id);
      }
      return null;
    }

    case 'recruit': {
      const g = actor(state, faction, cmd.general, ctx);
      if (typeof g === 'string') return g;
      const t = state.generals[cmd.target];
      if (!t) return '알 수 없는 대상';
      if (t.city !== g.city) return `${t.name}: 같은 도시에 있지 않다`;
      if (t.status === 'captive') {
        if (t.captor !== faction) return `${t.name}: 아군이 억류한 포로가 아니다`;
        if (Object.values(state.factions).some((x) => x.alive && x.ruler === t.id)) return `${t.name}: 군주는 등용할 수 없다`;
      } else if (t.status !== 'free') {
        return `${t.name}: 등용 가능한 상태가 아니다`;
      }
      ctx.acted.add(g.id);
      if (ctx.dry) return null;
      const base = t.status === 'captive' ? 20 : 35;
      const p = clamp(base + (g.cha - 50) * 0.9 - (t.war + t.int - 120) * 0.15, 5, 95) / 100;
      if (rng.chance(p)) {
        t.status = 'active';
        t.faction = faction;
        t.captor = null;
        t.formerFaction = null;
        t.loyalty = rng.int(55, 75);
        pushLog(state, 'personnel', `${josa(t.name, '이', '가')} ${josa(g.name, '의', '의')} 설득으로 ${f.name} 세력에 합류했다`, own, t.city);
      } else {
        pushLog(state, 'personnel', `${josa(g.name, '이', '가')} ${josa(t.name, '을', '를')} 설득했으나 거절당했다`, own, t.city);
      }
      return null;
    }

    case 'reward': {
      const t = state.generals[cmd.target];
      if (!t || t.status !== 'active' || t.faction !== faction) return '아군 장수가 아니다';
      if (f.ruler === t.id) return '군주에게는 포상할 수 없다';
      if (!isInt(cmd.gold, 10)) return '포상금은 10 이상의 정수';
      const city = state.cities[t.city];
      if (city.gold < cmd.gold) return `${city.name}: 금이 부족하다`;
      if (t.loyalty >= 100) return `${t.name}: 충성도가 이미 최대다`;
      city.gold -= cmd.gold;
      const gain = Math.max(1, Math.floor(cmd.gold / 10));
      t.loyalty = clamp(t.loyalty + gain, 0, 100);
      pushLog(state, 'personnel', `${t.name}에게 금 ${cmd.gold}을 하사했다 (충성 +${gain})`, own, city.id);
      return null;
    }

    case 'release': {
      const t = state.generals[cmd.target];
      if (!t || t.status !== 'captive' || t.captor !== faction) return '아군이 억류한 포로가 아니다';
      const former = t.formerFaction ? state.factions[t.formerFaction] : null;
      if (former?.alive) {
        const home = Object.values(state.cities).find((c) => c.owner === former.id);
        if (home) {
          t.status = 'active';
          t.faction = former.id;
          t.city = home.id;
          t.captor = null;
          t.formerFaction = null;
          getRelation(state, faction, former.id).friendship = clamp(getRelation(state, faction, former.id).friendship + 10, 0, 100);
          pushLog(state, 'personnel', `포로 ${josa(t.name, '을', '를')} ${former.name}에게 돌려보냈다`, [faction, former.id]);
          return null;
        }
      }
      t.status = 'free';
      t.captor = null;
      t.formerFaction = null;
      pushLog(state, 'personnel', `포로 ${josa(t.name, '을', '를')} 풀어주었다`, own, t.city);
      return null;
    }

    case 'move': {
      const g = actor(state, faction, cmd.general, ctx);
      if (typeof g === 'string') return g;
      const to = state.cities[cmd.to];
      if (!to) return '알 수 없는 도시';
      if (!isAdjacent(state, g.city, to.id)) return `${to.name}: 인접한 도시가 아니다`;
      if (to.owner !== faction) return `${to.name}: 아군 도시가 아니다`;
      const from = state.cities[g.city];
      g.city = to.id;
      ctx.acted.add(g.id);
      pushLog(state, 'domestic', `${josa(g.name, '이', '가')} ${from.name}에서 ${to.name}(으)로 이동했다`, own, to.id);
      return null;
    }

    case 'transport': {
      const g = actor(state, faction, cmd.general, ctx);
      if (typeof g === 'string') return g;
      const to = state.cities[cmd.to];
      if (!to) return '알 수 없는 도시';
      if (!isAdjacent(state, g.city, to.id)) return `${to.name}: 인접한 도시가 아니다`;
      if (to.owner !== faction) return `${to.name}: 아군 도시가 아니다`;
      const units = parseUnits(cmd.units ?? {});
      if (!units) return '병력 형식이 잘못되었다';
      if (!isInt(cmd.gold) || !isInt(cmd.food)) return '수송량은 0 이상의 정수';
      const moved = sumUnits(units);
      if (cmd.gold + cmd.food + moved === 0) return '수송할 것이 없다';
      const from = state.cities[g.city];
      if (from.gold < cmd.gold || from.food < cmd.food || UNIT_TYPES.some((t) => from.units[t] < units[t])) {
        return `${from.name}: 수송량이 보유량을 초과한다`;
      }
      from.gold -= cmd.gold;
      from.food -= cmd.food;
      to.gold += cmd.gold;
      to.food += cmd.food;
      if (moved > 0) {
        const cur = totalTroops(to);
        to.training = Math.round((cur * to.training + moved * from.training) / (cur + moved));
        for (const t of UNIT_TYPES) {
          from.units[t] -= units[t];
          to.units[t] += units[t];
        }
      }
      g.city = to.id;
      ctx.acted.add(g.id);
      pushLog(
        state,
        'domestic',
        `${josa(g.name, '이', '가')} ${from.name}→${to.name} 수송 (금 ${cmd.gold}, 군량 ${cmd.food}, 병사 ${moved})`,
        own,
        to.id,
      );
      return null;
    }

    case 'attack': {
      if (!Array.isArray(cmd.generals) || cmd.generals.length < 1 || cmd.generals.length > MAX_ATTACK_GENERALS) {
        return `출진 장수는 1~${MAX_ATTACK_GENERALS}명`;
      }
      if (new Set(cmd.generals).size !== cmd.generals.length) return '중복된 장수';
      const gens: GeneralState[] = [];
      for (const id of cmd.generals) {
        const g = actor(state, faction, id, ctx);
        if (typeof g === 'string') return g;
        gens.push(g);
      }
      const originId = gens[0].city;
      if (gens.some((g) => g.city !== originId)) return '출진 장수는 같은 도시에 있어야 한다';
      const origin = state.cities[originId];
      const target = state.cities[cmd.to];
      if (!target) return '알 수 없는 도시';
      if (!isAdjacent(state, originId, target.id)) return `${target.name}: 인접한 도시가 아니다`;
      if (target.owner === faction) return `${target.name}: 아군 도시다`;
      if (!isHostile(state, faction, target.owner)) return `${target.name}: 동맹·정전 중인 세력이다`;
      const units = parseUnits(cmd.units);
      if (!units) return '병력 형식이 잘못되었다';
      if (sumUnits(units) < 1) return '출진 병력이 없다';
      if (!isInt(cmd.food)) return '군량은 0 이상의 정수';
      for (const t of UNIT_TYPES) {
        if (origin.units[t] < units[t]) return `${origin.name}: ${UNIT_LABEL[t]}이 부족하다`;
      }
      if (origin.food < cmd.food) return `${origin.name}: 군량이 부족하다`;
      const planErr = checkPlan(cmd.plan);
      if (planErr) return planErr;
      if (cmd.plan.length < 1) return '전략을 1라운드 이상 정해야 한다';
      for (const [i, r] of cmd.plan.entries()) {
        if (r.general && !cmd.generals.includes(r.general)) return `${i + 1}라운드: 출진하지 않는 장수다`;
        if (r.count > 0 && units[r.unit] <= 0) return `${i + 1}라운드: ${UNIT_LABEL[r.unit]}을 출진시키지 않았다`;
      }
      for (const t of UNIT_TYPES) origin.units[t] -= units[t];
      origin.food -= cmd.food;
      for (const g of gens) ctx.acted.add(g.id);
      if (ctx.dry) return null;
      // 장수 순서: 무력 최상위가 대표
      const sorted = [...gens].sort((a, b) => b.war - a.war);
      resolveBattle(
        state,
        {
          faction,
          origin: originId,
          generals: sorted,
          units,
          food: cmd.food,
          training: origin.training,
          plan: normalizePlan(cmd.plan),
        },
        target.id,
        rng,
      );
      return null;
    }

    case 'setDefense': {
      const city = state.cities[cmd.city];
      if (!city || city.owner !== faction) return '아군 도시가 아니다';
      if (cmd.plan === null) {
        city.defensePlan = null;
        pushLog(state, 'military', `${city.name}: 수비 전략을 자동으로 되돌렸다`, own, city.id);
        return null;
      }
      const err = checkPlan(cmd.plan, BATTLE_ROUNDS);
      if (err) return err;
      for (const [i, r] of cmd.plan.entries()) {
        if (r.general) {
          const g = state.generals[r.general];
          if (!g || g.status !== 'active' || g.faction !== faction) return `${i + 1}라운드: 아군 장수가 아니다`;
        }
      }
      city.defensePlan = normalizePlan(cmd.plan);
      pushLog(state, 'military', `${city.name}: 수비 전략을 갱신했다 (${cmd.plan.length}라운드)`, own, city.id);
      return null;
    }

    case 'propose': {
      const other = state.factions[cmd.to];
      if (!other || !other.alive || other.id === faction) return '대상 세력이 올바르지 않다';
      if (cmd.kind !== 'alliance' && cmd.kind !== 'truce') return '잘못된 제안 종류';
      const rel = getRelation(state, faction, other.id);
      if (rel.status === cmd.kind) return `이미 ${cmd.kind === 'alliance' ? '동맹' : '정전'} 중이다`;
      if (cmd.kind === 'truce' && rel.status === 'alliance') return '이미 동맹 중이다';
      if (state.proposals.some((p) => p.from === faction && p.to === other.id)) return '이미 보낸 제안이 대기 중이다';
      state.proposals.push({ id: state.nextProposalId++, from: faction, to: other.id, kind: cmd.kind, turn: state.turn });
      pushLog(state, 'diplomacy', `${f.name} → ${other.name}: ${cmd.kind === 'alliance' ? '동맹' : '정전'} 제안`, [faction, other.id]);
      return null;
    }

    case 'respond': {
      const idx = state.proposals.findIndex((p) => p.id === cmd.proposal && p.to === faction);
      if (idx < 0) return '해당 제안이 없다';
      const p = state.proposals[idx];
      state.proposals.splice(idx, 1);
      applyProposalAnswer(state, p.from, p.to, p.kind, !!cmd.accept);
      return null;
    }

    case 'break': {
      const other = state.factions[cmd.to];
      if (!other || other.id === faction) return '대상 세력이 올바르지 않다';
      const rel = getRelation(state, faction, other.id);
      if (rel.status === 'neutral') return '파기할 협정이 없다';
      const was = rel.status === 'alliance' ? '동맹' : '정전';
      rel.status = 'neutral';
      rel.truceUntil = null;
      rel.friendship = clamp(rel.friendship - 40, 0, 100);
      pushLog(state, 'diplomacy', `${josa(f.name, '이', '가')} ${josa(other.name, '과', '와')}의 ${josa(was, '을', '를')} 파기했다`);
      return null;
    }

    case 'tribute': {
      const other = state.factions[cmd.to];
      if (!other || !other.alive || other.id === faction) return '대상 세력이 올바르지 않다';
      const from = state.cities[cmd.from];
      if (!from || from.owner !== faction) return '아군 도시가 아니다';
      if (!isInt(cmd.gold, 50)) return '공물은 50 이상의 정수';
      if (from.gold < cmd.gold) return `${from.name}: 금이 부족하다`;
      const dest =
        Object.values(state.cities).find((c) => c.owner === other.id && c.id === state.generals[other.ruler]?.city) ??
        Object.values(state.cities).find((c) => c.owner === other.id);
      if (!dest) return '대상 세력에 도시가 없다';
      from.gold -= cmd.gold;
      dest.gold += cmd.gold;
      const rel = getRelation(state, faction, other.id);
      const gain = Math.max(1, Math.floor(cmd.gold / 20));
      rel.friendship = clamp(rel.friendship + gain, 0, 100);
      pushLog(state, 'diplomacy', `${josa(f.name, '이', '가')} ${other.name}에게 금 ${cmd.gold}을 보냈다 (우호 +${gain})`, [faction, other.id]);
      return null;
    }
  }
  return '알 수 없는 명령';
}

export function applyProposalAnswer(
  state: GameState,
  from: FactionId,
  to: FactionId,
  kind: 'alliance' | 'truce',
  accept: boolean,
): void {
  const label = kind === 'alliance' ? '동맹' : '정전';
  const a = factionName(state, from);
  const b = factionName(state, to);
  const rel = getRelation(state, from, to);
  if (!accept) {
    rel.friendship = clamp(rel.friendship - 5, 0, 100);
    pushLog(state, 'diplomacy', `${josa(b, '이', '가')} ${a}의 ${label} 제안을 거절했다`, [from, to]);
    return;
  }
  rel.status = kind;
  rel.truceUntil = kind === 'truce' ? state.turn + 12 : null;
  rel.friendship = clamp(rel.friendship + 10, 0, 100);
  pushLog(state, 'diplomacy', `${josa(a, '과', '와')} ${josa(b, '이', '가')} ${josa(label, '을', '를')} 맺었다`);
}
