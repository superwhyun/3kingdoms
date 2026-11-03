import { describe, expect, it } from 'vitest';
import { getScenario } from '@ch/data';
import {
  autoPlan,
  clashLosses,
  excessToWall,
  WALL_PER_EXCESS_TROOP,
  SIEGE_WALL_MUL,
  createGame,
  emptyUnits,
  resolveTurn,
  unitQuality,
  validateOrders,
  viewFor,
  type Command,
  type GameState,
  type RoundPlan,
  type Units,
} from '../src';

const scenario = getScenario('y190');
const U = (u: Partial<Units>): Units => ({ ...emptyUnits(), ...u });
const P = (...rounds: [RoundPlan['unit'], number][]): RoundPlan[] => rounds.map(([unit, count]) => ({ general: null, unit, count }));

/** 진류(조조) → 허창(중립) 공격 구도를 만든다 */
function arena(def: Partial<Units>, defPlan: RoundPlan[] | null, wall = 0): GameState {
  const s = createGame(scenario, { seed: 5 });
  s.cities.chenliu.units = U({ spear: 20000, cavalry: 20000, archer: 20000, siege: 5000 });
  s.cities.chenliu.food = 50000;
  s.cities.chenliu.training = 60;
  s.cities.xuchang.units = U(def);
  s.cities.xuchang.training = 60;
  s.cities.xuchang.defense = wall;
  s.cities.xuchang.defensePlan = defPlan;
  return s;
}

function attack(s: GameState, units: Partial<Units>, plan: RoundPlan[]): GameState {
  const cmd: Command = { type: 'attack', generals: ['xiahou_dun'], to: 'xuchang', units, food: 20000, plan };
  expect(validateOrders(s, 'caocao', [cmd]).errors).toEqual([]);
  return resolveTurn(s, { caocao: [cmd] }, { ai: [] });
}

describe('clash model', () => {
  it('equal quality → equal losses, scaled by commitment', () => {
    const small = clashLosses(1000, 1, 1000, 1);
    const big = clashLosses(4000, 1, 4000, 1);
    expect(small.aLoss).toBe(small.bLoss);
    expect(big.aLoss).toBe(big.bLoss);
    expect(big.aLoss).toBe(small.aLoss * 4);
  });

  it('a small probe into a large force is almost wiped out', () => {
    const r = clashLosses(300, 1, 10000, 1);
    expect(r.aLoss).toBe(300);
    expect(r.bLoss).toBeLessThan(500);
  });

  it('matchup: spear beats cavalry', () => {
    const base = { training: 60, general: null, river: false };
    const spearQ = unitQuality({ ...base, unit: 'spear', vs: 'cavalry' });
    const cavQ = unitQuality({ ...base, unit: 'cavalry', vs: 'spear' });
    const r = clashLosses(5000, spearQ, 5000, cavQ);
    expect(r.bLoss).toBeGreaterThan(r.aLoss * 1.8);
  });

  it('river terrain favours navy', () => {
    const base = { training: 60, general: null, vs: 'spear' as const };
    expect(unitQuality({ ...base, unit: 'navy', river: true })).toBeGreaterThan(unitQuality({ ...base, unit: 'navy', river: false }) * 2);
  });

  it('autoPlan spreads unit types proportionally over 10 rounds', () => {
    const p = autoPlan(U({ spear: 6000, archer: 4000 }));
    expect(p).toHaveLength(10);
    expect(p.filter((r) => r.unit === 'spear')).toHaveLength(6);
    expect(p.filter((r) => r.unit === 'archer')).toHaveLength(4);
  });
});

describe('battle resolution', () => {
  it('counter-picking the defender plan wins, mirroring it loses', () => {
    const defPlan = P(...Array.from({ length: 10 }, () => ['cavalry', 4000] as [RoundPlan['unit'], number]));
    const win = attack(arena({ cavalry: 12000 }, defPlan), { spear: 20000 }, P(...Array.from({ length: 10 }, () => ['spear', 8000] as [RoundPlan['unit'], number])));
    const lose = attack(arena({ cavalry: 12000 }, defPlan), { archer: 20000 }, P(...Array.from({ length: 10 }, () => ['archer', 8000] as [RoundPlan['unit'], number])));
    const rw = win.battles[0];
    const rl = lose.battles[0];
    const lossW = 20000 - rw.attackerEnd.spear;
    const lossL = 20000 - rl.attackerEnd.archer;
    expect(lossL).toBeGreaterThan(lossW * 2);
    expect(rw.outcome).toBe('captured');
    expect(win.cities.xuchang.owner).toBe('caocao');
  });

  it('empty defender rounds damage walls and reserve', () => {
    const s = attack(arena({ spear: 10000 }, P(['spear', 0], ['spear', 0]), 600), { siege: 3000, spear: 5000 }, P(['siege', 3000], ['spear', 5000]));
    const r = s.battles[0];
    expect(r.rounds[0].def).toBeNull();
    expect(r.rounds[0].reserveLoss).toBeGreaterThan(0);
    expect(r.rounds[0].wallDamage).toBeGreaterThan(r.rounds[1].wallDamage);
    expect(r.wallEnd).toBeLessThan(600);
  });

  it('attacker withdraws after 10 rounds if defenders remain', () => {
    const s = attack(arena({ spear: 30000 }, P(['spear', 100])), { spear: 2000 }, P(['spear', 100]));
    const r = s.battles[0];
    expect(r.outcome).toBe('withdrawn');
    expect(s.cities.xuchang.owner).toBeNull();
    // 생존 병력은 진류로 귀환
    expect(s.cities.chenliu.units.spear).toBe(18000 + r.attackerEnd.spear);
  });

  it('invalid plans are rejected', () => {
    const s = arena({ spear: 1000 }, null);
    const bad: Command[] = [
      { type: 'attack', generals: ['xiahou_dun'], to: 'xuchang', units: { spear: 1000 }, food: 100, plan: [] },
      { type: 'attack', generals: ['cao_ren'], to: 'xuchang', units: { spear: 1000 }, food: 100, plan: P(['cavalry', 500]) },
      { type: 'attack', generals: ['cao_hong'], to: 'xuchang', units: { spear: 1000 }, food: 100, plan: [{ general: 'lu_bu', unit: 'spear', count: 1 }] },
      { type: 'attack', generals: ['yue_jin'], to: 'xuchang', units: { spear: 1000 }, food: 100, plan: P(...Array.from({ length: 11 }, () => ['spear', 1] as [RoundPlan['unit'], number])) },
    ];
    expect(validateOrders(s, 'caocao', bad).errors.map((e) => e.index)).toEqual([0, 1, 2, 3]);
  });

  it('defense plan is private; battle report visible only to the parties', () => {
    let s = createGame(scenario, { seed: 3 });
    s.roads.chenliu.push('pingyuan');
    s.roads.pingyuan.push('chenliu');
    s = resolveTurn(s, { liubei: [{ type: 'setDefense', city: 'pingyuan', plan: P(['spear', 2000], ['archer', 1000]) }] }, { ai: [] });
    expect(s.cities.pingyuan.defensePlan).toHaveLength(2);
    expect(viewFor(s, 'caocao').cities.find((c) => c.id === 'pingyuan')!.defensePlan).toBeNull();
    expect(viewFor(s, 'liubei').cities.find((c) => c.id === 'pingyuan')!.defensePlan).toHaveLength(2);
    s = resolveTurn(
      s,
      { caocao: [{ type: 'attack', generals: ['xiahou_dun'], to: 'pingyuan', units: { spear: 1000 }, food: 500, plan: P(['spear', 500]) }] },
      { ai: [] },
    );
    expect(s.battles).toHaveLength(1);
    expect(viewFor(s, 'caocao').battles[0].defenderPlan).toEqual(P(['spear', 2000], ['archer', 1000]));
    expect(viewFor(s, 'liubei').battles).toHaveLength(1);
    expect(viewFor(s, 'sunjian').battles).toHaveLength(0);
  });

  it('navy can only be drafted in river cities', () => {
    const s = createGame(scenario, { seed: 1 });
    expect(validateOrders(s, 'caocao', [{ type: 'draft', general: 'cao_hong', amount: 500, unit: 'navy' }]).ok).toBe(false);
    expect(validateOrders(s, 'liubiao', [{ type: 'draft', general: 'cai_mao', amount: 500, unit: 'navy' }]).ok).toBe(true);
  });
});

describe('excess damage after the committed group is wiped', () => {
  const rounds = (unit: RoundPlan['unit'], n: number) => P(...Array.from({ length: 10 }, () => [unit, n] as [RoundPlan['unit'], number]));

  it('excess is linear in the attackers left over after the wipe', () => {
    // K=0.25, 동일 질: 100명 전멸에 1,600명 필요 → 남는 3,200 × 0.25 = 800
    expect(clashLosses(4800, 1, 100, 1).bExcess).toBe(800);
    expect(clashLosses(1600, 1, 100, 1).bExcess).toBe(0);
    expect(clashLosses(1000, 1, 100, 1).bExcess).toBe(0);
    // 질 우위가 있으면 더 적은 병력으로 전멸시키고 더 많이 밀고 들어간다
    expect(clashLosses(4800, 2, 100, 1).bExcess).toBeGreaterThan(800);
  });

  it('clashLosses reports the defender excess only', () => {
    const r = clashLosses(15000, 1, 300, 1);
    expect(r.bLoss).toBe(300);
    expect(r.bExcess).toBeGreaterThan(0);
    const probe = clashLosses(300, 1, 15000, 1);
    expect(probe.aLoss).toBe(300);
    expect(probe.bExcess).toBe(0);
  });

  it('goes to the wall first; reserve hit only after the wall is gone', () => {
    // 남은 피해가 성벽보다 작은 경우: 성벽만 깎인다
    const small = attack(arena({ spear: 8000 }, rounds('spear', 300), 900), { spear: 20000 }, rounds('spear', 6000));
    const s0 = small.battles[0].rounds[0];
    expect(s0.def!.loss).toBe(300);
    expect(s0.wallDamage).toBeGreaterThan(0);
    expect(s0.reserveLoss).toBe(0);
    // 남은 피해가 큰 경우: 예비대가 피해를 입는 라운드에는 성벽이 이미 0이다
    const big = attack(arena({ spear: 8000 }, rounds('spear', 300), 900), { spear: 20000 }, rounds('spear', 15000));
    const b = big.battles[0];
    let wall = b.wallStart;
    for (const r of b.rounds) {
      wall -= r.wallDamage;
      if (r.def && r.reserveLoss > 0) expect(wall).toBe(0);
    }
    expect(b.rounds[0].reserveLoss).toBeGreaterThan(0);
  });

  it('spills onto the reserve once walls are down', () => {
    const s = attack(arena({ spear: 8000 }, rounds('spear', 300), 0), { spear: 20000 }, rounds('spear', 15000));
    const r0 = s.battles[0].rounds[0];
    expect(r0.wallDamage).toBe(0);
    expect(r0.reserveLoss).toBeGreaterThan(0);
  });

  it('excessToWall: walls absorb first, siege multiplies by 5, overflow goes to reserve', () => {
    expect(excessToWall(100, 500)).toEqual({ wall: 100 * WALL_PER_EXCESS_TROOP, reserveTroops: 0 });
    expect(excessToWall(100, 1000, SIEGE_WALL_MUL)).toEqual({ wall: 100 * WALL_PER_EXCESS_TROOP * SIEGE_WALL_MUL, reserveTroops: 0 });
    const partial = excessToWall(100, 40 * WALL_PER_EXCESS_TROOP);
    expect(partial.wall).toBe(40 * WALL_PER_EXCESS_TROOP);
    expect(partial.reserveTroops).toBe(60);
    expect(excessToWall(100, 0)).toEqual({ wall: 0, reserveTroops: 100 });
  });

  it('an attacking probe that is wiped out costs nothing beyond the probe', () => {
    const s = attack(arena({ spear: 20000 }, rounds('spear', 15000), 0), { spear: 5000 }, P(['spear', 300]));
    const r0 = s.battles[0].rounds[0];
    expect(r0.att!.loss).toBe(300);
    expect(r0.attRemaining).toBe(4700);
  });
});
