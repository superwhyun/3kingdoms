import type { Rng } from './rng';
import type {
  BattleOutcome,
  BattleReport,
  BattleRound,
  BattleSide,
  CityState,
  FactionId,
  GameState,
  GeneralState,
  RoundPlan,
} from './types';
import {
  BATTLE_K,
  BATTLE_ROUNDS,
  EMPTY_ROUND_RESERVE_RATE,
  MATCHUP,
  SIEGE_WALL_MUL,
  UNIT_LABEL,
  UNIT_TYPES,
  WALL_DAMAGE_DIV,
  WALL_PER_EXCESS_TROOP,
  aptitude,
  isUnitType,
  removeProportional,
  sumUnits,
  terrainMul,
  type UnitType,
  type Units,
} from './units';
import { citiesOf, clamp, factionName, generalsIn, isAdjacent, isRiver, josa, pushLog, totalTroops } from './util';
import { handleFactionLoss } from './succession';

export interface Army {
  faction: FactionId;
  origin: string;
  generals: GeneralState[];
  units: Units;
  food: number;
  training: number;
  plan: RoundPlan[];
}

// ── 추정용 (AI·UI) ─────────────────────────────────────────

interface Side {
  troops: number;
  training: number;
  war: number;
  int: number;
  support: number;
}

const NEUTRAL_LEADER = { war: 40, int: 40 };

/** 병종을 무시한 대략적 전투력 */
export function sidePower(s: Side, defenseBonus = 1): number {
  const trainingMul = 0.6 + s.training / 250;
  const leaderMul = 1 + (s.war * 0.7 + s.int * 0.3 - 50) / 100;
  const supportMul = 1 + 0.02 * Math.min(4, s.support);
  return s.troops * trainingMul * leaderMul * supportMul * defenseBonus;
}

function leaderOf(generals: GeneralState[]): { war: number; int: number; support: number } {
  if (generals.length === 0) return { ...NEUTRAL_LEADER, support: 0 };
  return {
    war: Math.max(...generals.map((g) => g.war)),
    int: Math.max(...generals.map((g) => g.int)),
    support: generals.length - 1,
  };
}

export function defenseMultiplier(city: Pick<CityState, 'defense'>, vsSiege = false): number {
  return 1 + (city.defense / 1500) * (vsSiege ? 0.5 : 1);
}

/** 공격측 추정 전투력 / 수비측 추정 전투력 (병종 상성 무시) */
export function estimateOdds(
  state: GameState,
  army: { faction: FactionId; generals: GeneralState[]; troops: number; training: number },
  target: CityState,
): number {
  const a = leaderOf(army.generals);
  const defGenerals = target.owner ? generalsIn(state, target.id, target.owner) : [];
  const d = leaderOf(defGenerals);
  const ap = sidePower({ troops: army.troops, training: army.training, ...a });
  const dp = sidePower({ troops: totalTroops(target), training: target.training, ...d }, defenseMultiplier(target));
  return dp <= 0 ? Infinity : ap / dp;
}

// ── 계획 ───────────────────────────────────────────────────

/** 계획 형식 검증. 오류 메시지 또는 null */
export function checkPlan(plan: unknown, maxLen = BATTLE_ROUNDS): string | null {
  if (!Array.isArray(plan)) return '전략은 배열이어야 한다';
  if (plan.length > maxLen) return `전략은 최대 ${maxLen}라운드`;
  for (const [i, r] of plan.entries()) {
    if (!r || typeof r !== 'object') return `${i + 1}라운드: 잘못된 형식`;
    const p = r as Partial<RoundPlan>;
    if (!isUnitType(p.unit)) return `${i + 1}라운드: 알 수 없는 병종`;
    if (typeof p.count !== 'number' || !Number.isInteger(p.count) || p.count < 0) return `${i + 1}라운드: 병력은 0 이상의 정수`;
    if (p.general !== null && p.general !== undefined && typeof p.general !== 'string') return `${i + 1}라운드: 잘못된 장수`;
  }
  return null;
}

export function normalizePlan(plan: RoundPlan[]): RoundPlan[] {
  return plan.map((r) => ({ general: r.general ?? null, unit: r.unit, count: r.count }));
}

/**
 * 자동 계획: 보유 병종 비율대로 10라운드에 배분하고, 각 라운드에 해당 병종의 60%를 투입한다.
 * rng가 주어지면 라운드 순서를 섞는다.
 */
export function autoPlan(units: Units, rng?: Rng): RoundPlan[] {
  const total = sumUnits(units);
  if (total <= 0) return [];
  const types = UNIT_TYPES.filter((t) => units[t] > 0);
  // 최대 잔여 배분
  const quota = types.map((t) => ({ t, q: (units[t] / total) * BATTLE_ROUNDS }));
  const slots: UnitType[] = [];
  for (const { t, q } of quota) for (let i = 0; i < Math.floor(q); i++) slots.push(t);
  const rest = quota.sort((a, b) => (b.q % 1) - (a.q % 1));
  for (let i = 0; slots.length < BATTLE_ROUNDS; i++) slots.push(rest[i % rest.length].t);
  if (rng) rng.shuffle(slots);
  else slots.sort((a, b) => UNIT_TYPES.indexOf(a) - UNIT_TYPES.indexOf(b));
  return slots.map((unit) => ({ general: null, unit, count: Math.max(1, Math.round(units[unit] * 0.6)) }));
}

function pickGeneral(pool: GeneralState[], wanted: string | null, unit: UnitType): GeneralState | null {
  if (wanted) {
    const g = pool.find((x) => x.id === wanted);
    if (g) return g;
  }
  let best: GeneralState | null = null;
  for (const g of pool) if (!best || aptitude(g, unit) > aptitude(best, unit)) best = g;
  return best;
}

/** 라운드 투입 병력의 '질' (병력 1명당 전투력) */
export function unitQuality(opts: {
  unit: UnitType;
  vs: UnitType | null;
  training: number;
  general: GeneralState | null;
  river: boolean;
  wall?: number;
}): number {
  const trainingMul = 0.6 + opts.training / 250;
  const aptMul = 1 + (aptitude(opts.general, opts.unit) - 50) / 100;
  const match = opts.vs ? MATCHUP[opts.unit][opts.vs] : 1;
  const wallMul = opts.wall !== undefined ? defenseMultiplier({ defense: opts.wall }, opts.vs === 'siege') : 1;
  return trainingMul * aptMul * match * terrainMul(opts.unit, opts.river) * wallMul;
}

/**
 * 교전 손실. 손실 = K × √(내 투입 × 상대 투입) × √(상대 질 / 내 질), 투입량을 넘지 않음.
 * 질이 같으면 양측 손실이 같고, 많이 투입할수록 주고받는 피해가 함께 커진다.
 */
export function clashLosses(
  aCount: number,
  aQ: number,
  bCount: number,
  bQ: number,
  noiseA = 1,
  noiseB = 1,
): { aLoss: number; bLoss: number; bExcess: number } {
  const base = BATTLE_K * Math.sqrt(aCount * bCount);
  const rawB = Math.round(base * Math.sqrt(aQ / bQ) * noiseB);
  return {
    aLoss: Math.min(aCount, Math.round(base * Math.sqrt(bQ / aQ) * noiseA)),
    bLoss: Math.min(bCount, rawB),
    // B측 투입분이 전멸하고 남은 피해 (A측 초과분은 소멸)
    bExcess: Math.max(0, rawB - bCount),
  };
}

/**
 * 남은 피해(병력 단위)를 성벽 피해로 환산하고, 성벽이 감당하지 못한 나머지를 예비대 피해(병력)로 돌려준다.
 */
export function excessToWall(excess: number, wallLeft: number, siegeMul = 1): { wall: number; reserveTroops: number } {
  const perTroop = WALL_PER_EXCESS_TROOP * siegeMul;
  const asWall = excess * perTroop;
  const wall = Math.min(wallLeft, asWall);
  return { wall, reserveTroops: Math.round((asWall - wall) / perTroop) };
}

// ── 전투 ───────────────────────────────────────────────────

/** 공격 실행. 출진 도시에서 병력·군량은 이미 차감된 상태로 호출된다. */
export function resolveBattle(state: GameState, army: Army, targetId: string, rng: Rng): void {
  const target = state.cities[targetId];
  const attackerName = factionName(state, army.faction);
  const leaderName = army.generals[0]?.name ?? '?';

  // 이미 아군 도시가 된 경우(같은 턴의 다른 공격으로 점령): 합류
  if (target.owner === army.faction) {
    mergeArmyInto(state, army, target);
    pushLog(state, 'military', `${josa(leaderName, '이', '가')} 이끄는 부대가 ${target.name}에 합류했다.`, [army.faction], target.id);
    return;
  }

  const defenderFaction = target.owner;
  const defenderName = factionName(state, defenderFaction);
  const defGenerals = defenderFaction ? generalsIn(state, target.id, defenderFaction) : [];
  const river = isRiver(state, army.origin, target.id);

  const savedPlan = target.defensePlan && checkPlan(target.defensePlan) === null ? target.defensePlan : null;
  const defenderAuto = !savedPlan || savedPlan.length === 0;
  const defPlan = defenderAuto ? autoPlan(target.units, rng) : normalizePlan(savedPlan!);
  const attPlan = army.plan.length ? normalizePlan(army.plan) : autoPlan(army.units, rng);

  const att = { ...army.units };
  const def = target.units; // 수비측은 도시 병력을 직접 사용
  const report: BattleReport = {
    turn: state.turn,
    city: target.id,
    attacker: army.faction,
    defender: defenderFaction,
    river,
    attackerGenerals: army.generals.map((g) => g.id),
    defenderGenerals: defGenerals.map((g) => g.id),
    attackerStart: { ...att },
    defenderStart: { ...def },
    attackerEnd: att,
    defenderEnd: def,
    attackerPlan: attPlan,
    defenderPlan: defPlan,
    defenderAuto,
    wallStart: target.defense,
    wallEnd: target.defense,
    rounds: [],
    outcome: 'withdrawn',
  };

  let food = army.food;
  let outcome: BattleOutcome | null = null;

  for (let r = 0; r < BATTLE_ROUNDS; r++) {
    if (sumUnits(def) <= 0) {
      outcome = 'captured';
      break;
    }
    if (sumUnits(att) <= 0) {
      outcome = 'annihilated';
      break;
    }
    const need = Math.ceil(sumUnits(att) / 200);
    if (food < need) {
      outcome = 'starved';
      break;
    }
    food -= need;

    const ap = attPlan[r];
    const dp = defPlan[r];
    const aCount = ap ? Math.min(ap.count, att[ap.unit]) : 0;
    const dCount = dp ? Math.min(dp.count, def[dp.unit]) : 0;
    const aGen = ap ? pickGeneral(army.generals, ap.general, ap.unit) : null;
    const dGen = dp ? pickGeneral(defGenerals, dp.general, dp.unit) : null;
    const round: BattleRound = {
      round: r + 1,
      att: aCount > 0 ? { general: aGen?.id ?? null, unit: ap!.unit, count: aCount, loss: 0 } : null,
      def: dCount > 0 ? { general: dGen?.id ?? null, unit: dp!.unit, count: dCount, loss: 0 } : null,
      reserveLoss: 0,
      wallDamage: 0,
      attRemaining: 0,
      defRemaining: 0,
    };

    if (aCount > 0) {
      const aQ = unitQuality({
        unit: ap!.unit,
        vs: dCount > 0 ? dp!.unit : null,
        training: army.training,
        general: aGen,
        river,
      });
      const aPower = aCount * aQ;
      let wallDamage = 0;
      if (dCount > 0) {
        const dQ = unitQuality({
          unit: dp!.unit,
          vs: ap!.unit,
          training: target.training,
          general: dGen,
          river,
          wall: target.defense,
        });
        const { aLoss, bLoss, bExcess } = clashLosses(aCount, aQ, dCount, dQ, rng.range(0.9, 1.1), rng.range(0.9, 1.1));
        att[ap!.unit] -= aLoss;
        def[dp!.unit] -= bLoss;
        (round.att as BattleSide).loss = aLoss;
        (round.def as BattleSide).loss = bLoss;
        const siegeMul = ap!.unit === 'siege' ? SIEGE_WALL_MUL : 1;
        if (ap!.unit === 'siege') wallDamage = (aPower / WALL_DAMAGE_DIV) * SIEGE_WALL_MUL * 0.5;
        if (bExcess > 0) {
          // 수비 투입분 전멸 후 남은 피해 → 성벽, 성벽이 바닥나면 예비대
          const spill = excessToWall(bExcess, Math.max(0, target.defense - wallDamage), siegeMul);
          wallDamage += spill.wall;
          if (spill.reserveTroops > 0) round.reserveLoss = removeProportional(def, spill.reserveTroops);
        }
      } else {
        // 수비가 비운 라운드: 예비대와 성벽 타격
        round.reserveLoss = removeProportional(def, Math.round(aPower * EMPTY_ROUND_RESERVE_RATE * rng.range(0.9, 1.1)));
        wallDamage = (aPower / WALL_DAMAGE_DIV) * (ap!.unit === 'siege' ? SIEGE_WALL_MUL : 1);
      }
      round.wallDamage = Math.min(target.defense, Math.round(wallDamage));
      target.defense -= round.wallDamage;
    }
    round.attRemaining = sumUnits(att);
    round.defRemaining = sumUnits(def);
    report.rounds.push(round);
  }
  if (!outcome) {
    if (sumUnits(def) <= 0) outcome = 'captured';
    else if (sumUnits(att) <= 0) outcome = 'annihilated';
    else outcome = 'withdrawn';
  }
  report.outcome = outcome;
  report.wallEnd = target.defense;
  report.attackerEnd = { ...att };
  report.defenderEnd = { ...def };
  state.battles.push(report);

  const lossA = sumUnits(report.attackerStart) - sumUnits(att);
  const lossD = sumUnits(report.defenderStart) - sumUnits(def);
  const tail = `(공격측 손실 ${lossA}, 수비측 손실 ${lossD})`;

  if (outcome === 'captured') {
    captureCity(state, { ...army, units: att }, target, food, defGenerals, rng);
    pushLog(
      state,
      'military',
      `${attackerName}군 ${josa(leaderName, '이', '가')} ${defenderName}의 ${josa(target.name, '을', '를')} 함락했다. ${tail}`,
      [],
      target.id,
    );
    if (defenderFaction) handleFactionLoss(state, defenderFaction, rng);
    return;
  }

  if (outcome === 'annihilated') {
    pushLog(
      state,
      'military',
      `${attackerName}군 ${josa(leaderName, '이', '가')} ${defenderName}의 ${target.name} 공략 중 전멸했다. ${tail}`,
      [],
      target.id,
    );
    scatterGenerals(state, army, target, rng);
    return;
  }

  const reason = outcome === 'starved' ? '군량이 떨어져 퇴각했다' : '함락하지 못하고 철수했다';
  pushLog(
    state,
    'military',
    `${attackerName}군 ${josa(leaderName, '이', '가')} ${defenderName}의 ${target.name} 공략에 나섰으나 ${reason}. ${tail}`,
    [],
    target.id,
  );
  retreat(state, { ...army, units: att, food }, target, rng);
}

function mergeArmyInto(state: GameState, army: Army, city: CityState): void {
  const add = sumUnits(army.units);
  const cur = totalTroops(city);
  const total = cur + add;
  if (total > 0) city.training = Math.round((cur * city.training + add * army.training) / total);
  for (const t of UNIT_TYPES) city.units[t] += army.units[t];
  city.food += army.food;
  for (const g of army.generals) state.generals[g.id].city = city.id;
}

function homeFor(state: GameState, army: Army, from: CityState): CityState | undefined {
  const origin = state.cities[army.origin];
  if (origin.owner === army.faction) return origin;
  return citiesOf(state, army.faction).find((c) => isAdjacent(state, c.id, from.id));
}

function retreat(state: GameState, army: Army, from: CityState, rng: Rng): void {
  const home = homeFor(state, army, from);
  if (home) {
    mergeArmyInto(state, army, home);
    return;
  }
  pushLog(state, 'military', `${factionName(state, army.faction)}군은 돌아갈 곳을 잃고 와해되었다.`, [], from.id);
  scatterGenerals(state, army, from, rng);
}

/** 부대 전멸·와해 시 장수 처리: 귀환, 포로, 또는 재야 */
function scatterGenerals(state: GameState, army: Army, battlefield: CityState, rng: Rng): void {
  const home = homeFor(state, army, battlefield) ?? citiesOf(state, army.faction)[0];
  for (const g of army.generals) {
    const gs = state.generals[g.id];
    if (home && rng.chance(0.5 + gs.war / 250)) {
      gs.city = home.id;
      continue;
    }
    if (battlefield.owner && battlefield.owner !== army.faction) {
      gs.status = 'captive';
      gs.formerFaction = gs.faction;
      gs.faction = null;
      gs.captor = battlefield.owner;
      gs.city = battlefield.id;
      pushLog(state, 'military', `${josa(gs.name, '이', '가')} ${factionName(state, battlefield.owner)}군에 사로잡혔다.`, [], battlefield.id);
    } else if (home) {
      gs.city = home.id;
    } else {
      gs.status = 'free';
      gs.faction = null;
      gs.city = battlefield.id;
    }
  }
}

function captureCity(
  state: GameState,
  army: Army,
  city: CityState,
  food: number,
  defenders: GeneralState[],
  rng: Rng,
): void {
  const prevOwner = city.owner;
  city.owner = army.faction;
  city.units = { ...army.units };
  city.training = army.training;
  city.defensePlan = null;
  city.food = Math.floor(city.food * 0.5) + food;
  city.gold = Math.floor(city.gold * 0.5);
  city.loyalty = clamp(city.loyalty - 10, 0, 100);
  for (const g of army.generals) state.generals[g.id].city = city.id;

  // 수비 장수: 탈출 또는 포로
  for (const g of defenders) {
    const gs = state.generals[g.id];
    const escapeTo = prevOwner ? citiesOf(state, prevOwner).find((c) => isAdjacent(state, c.id, city.id)) : undefined;
    if (escapeTo && rng.chance(0.3 + gs.war / 250)) {
      gs.city = escapeTo.id;
      pushLog(state, 'military', `${josa(gs.name, '은', '는')} ${escapeTo.name}(으)로 탈출했다.`, [], city.id);
    } else {
      gs.status = 'captive';
      gs.formerFaction = gs.faction;
      gs.faction = null;
      gs.captor = army.faction;
      pushLog(state, 'military', `${josa(gs.name, '이', '가')} ${factionName(state, army.faction)}군에 사로잡혔다.`, [], city.id);
    }
  }

  // 이 도시에 억류되어 있던 포로 처리
  for (const g of Object.values(state.generals)) {
    if (g.status !== 'captive' || g.city !== city.id || g.captor === army.faction) continue;
    if (g.formerFaction === army.faction && state.factions[army.faction].alive) {
      g.status = 'active';
      g.faction = army.faction;
      g.captor = null;
      g.formerFaction = null;
      pushLog(state, 'personnel', `${josa(g.name, '이', '가')} 구출되어 복귀했다.`, [army.faction], city.id);
    } else {
      g.status = 'free';
      g.captor = null;
      g.formerFaction = null;
    }
  }
}

export function describeRound(state: GameState, side: BattleSide | null): string {
  if (!side) return '대기';
  const g = side.general ? state.generals[side.general]?.name : '';
  return `${g ? g + ' ' : ''}${UNIT_LABEL[side.unit]} ${side.count}`;
}
