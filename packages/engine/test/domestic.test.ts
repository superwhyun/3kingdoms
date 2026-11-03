import { describe, expect, it } from 'vitest';
import { getScenario } from '@ch/data';
import {
  DEFAULT_RULES,
  applyRulesPatch,
  createGame,
  diffRules,
  monthlyIncome,
  resolveTurn,
  schemeChance,
  validateOrders,
  validateRulesPatch,
  type GameState,
  type Rules,
} from '../src';

const scenario = getScenario('y190');
const newGame = (seed = 11, rules?: Rules) => createGame(scenario, { seed, rules });
const quiet = (): Rules =>
  applyRulesPatch(DEFAULT_RULES, {
    events: { bumperChance: 0, droughtChance: 0, plagueChance: 0, floodChance: 0, rebellionChance: 0 },
  });

describe('rules', () => {
  it('validates patches against the default shape', () => {
    expect(validateRulesPatch({ battle: { k: 0.3 } })).toBeNull();
    expect(validateRulesPatch({ battle: { matchup: { spear: { cavalry: 2 } } } })).toBeNull();
    expect(validateRulesPatch({ battle: { nope: 1 } })).toMatch(/알 수 없는/);
    expect(validateRulesPatch({ battle: { k: 'x' } })).toMatch(/숫자/);
    expect(validateRulesPatch({ battle: { k: -1 } })).toMatch(/0 이상/);
    expect(validateRulesPatch({ battle: 3 })).toMatch(/객체/);
  });

  it('applies and diffs patches without mutating defaults', () => {
    const r = applyRulesPatch(DEFAULT_RULES, { battle: { k: 0.4 }, tax: { incomeMul: { high: 2 } } });
    expect(r.battle.k).toBe(0.4);
    expect(r.tax.incomeMul.high).toBe(2);
    expect(r.tax.incomeMul.low).toBe(DEFAULT_RULES.tax.incomeMul.low);
    expect(DEFAULT_RULES.battle.k).toBe(0.25);
    expect(diffRules(DEFAULT_RULES, r)).toEqual({ battle: { k: 0.4 }, tax: { incomeMul: { high: 2 } } });
  });

  it('game rules drive the engine (develop cost)', () => {
    const s = newGame(1, applyRulesPatch(DEFAULT_RULES, { domestic: { developCost: 999999 } }));
    expect(validateOrders(s, 'caocao', [{ type: 'develop', general: 'xun_yu', field: 'commerce' }]).ok).toBe(false);
  });
});

describe('tax & governor', () => {
  it('high tax raises income and lowers loyalty', () => {
    const s = newGame(1, quiet());
    const low = { ...s.cities.chenliu, tax: 'low' as const };
    const high = { ...s.cities.chenliu, tax: 'high' as const };
    expect(monthlyIncome(high, s.rules)).toBeGreaterThan(monthlyIncome(low, s.rules));
    const n = resolveTurn(s, { caocao: [{ type: 'setTax', city: 'chenliu', tax: 'high' }] }, { ai: [] });
    expect(n.cities.chenliu.tax).toBe('high');
    expect(n.cities.chenliu.loyalty).toBe(s.cities.chenliu.loyalty + DEFAULT_RULES.tax.loyaltyDelta.high);
  });

  it('governor auto-develops and does not consume an action', () => {
    const s = newGame(1, quiet());
    const before = Math.min(s.cities.chenliu.agriculture, s.cities.chenliu.commerce);
    const n = resolveTurn(
      s,
      {
        caocao: [
          { type: 'appoint', city: 'chenliu', general: 'xun_yu' },
          { type: 'develop', general: 'xun_yu', field: 'defense' },
        ],
      },
      { ai: [] },
    );
    expect(n.cities.chenliu.governor).toBe('xun_yu');
    expect(n.cities.chenliu.agriculture + n.cities.chenliu.commerce).toBeGreaterThan(
      s.cities.chenliu.agriculture + s.cities.chenliu.commerce,
    );
    expect(Math.min(n.cities.chenliu.agriculture, n.cities.chenliu.commerce)).toBeGreaterThanOrEqual(before);
  });

  it('governor must be stationed in the city; cleared when he leaves', () => {
    const s = newGame(1, quiet());
    expect(validateOrders(s, 'caocao', [{ type: 'appoint', city: 'chenliu', general: 'lu_bu' }]).ok).toBe(false);
    s.cities.chenliu.governor = 'xun_yu';
    s.generals.xun_yu.city = 'xuchang'; // 다른 곳에 있음
    const n = resolveTurn(s, {}, { ai: [] });
    expect(n.cities.chenliu.governor).toBeNull();
  });
});

describe('facilities', () => {
  it('construction takes months, then raises the level and its effect applies', () => {
    let s = newGame(1, quiet());
    s.cities.chenliu.gold = 5000;
    s = resolveTurn(s, { caocao: [{ type: 'build', general: 'xun_yu', facility: 'market' }] }, { ai: [] });
    expect(s.cities.chenliu.construction?.facility).toBe('market');
    expect(validateOrders(s, 'caocao', [{ type: 'build', general: 'cao_ren', facility: 'farm' }]).ok).toBe(false);
    for (let i = 0; i < DEFAULT_RULES.facility.months.market - 1; i++) s = resolveTurn(s, {}, { ai: [] });
    expect(s.cities.chenliu.facilities.market).toBe(1);
    expect(s.cities.chenliu.construction).toBeNull();
    const base = { ...s.cities.chenliu, facilities: { ...s.cities.chenliu.facilities, market: 0 } };
    expect(monthlyIncome(s.cities.chenliu, s.rules)).toBeGreaterThan(monthlyIncome(base, s.rules));
  });

  it('barracks discount lowers draft cost', () => {
    const s = newGame(1, quiet());
    s.cities.chenliu.facilities.barracks = 3;
    const gold = s.cities.chenliu.gold;
    const n = resolveTurn(s, { caocao: [{ type: 'draft', general: 'cao_hong', amount: 1000, unit: 'cavalry' }] }, { ai: [] });
    const spent = gold - n.cities.chenliu.gold;
    // 할인 없이 300, 병영 3단계(30%)로 210 — 월 수입·급료 변동을 감안해 대략 비교
    const full = createGame(scenario, { seed: 1, rules: quiet() });
    const m = resolveTurn(full, { caocao: [{ type: 'draft', general: 'cao_hong', amount: 1000, unit: 'cavalry' }] }, { ai: [] });
    expect(spent).toBeLessThan(gold - m.cities.chenliu.gold);
  });
});

describe('schemes', () => {
  function withTarget(): GameState {
    const s = newGame(2, quiet());
    s.roads.chenliu.push('pingyuan');
    s.roads.pingyuan.push('chenliu');
    s.cities.chenliu.gold = 5000;
    return s;
  }

  it('validates targets: adjacent hostile faction city only', () => {
    const s = withTarget();
    expect(validateOrders(s, 'caocao', [{ type: 'scheme', general: 'xun_yu', kind: 'rumor', to: 'pingyuan' }]).ok).toBe(true);
    expect(validateOrders(s, 'caocao', [{ type: 'scheme', general: 'xun_yu', kind: 'rumor', to: 'xuchang' }]).ok).toBe(false); // 중립
    expect(validateOrders(s, 'caocao', [{ type: 'scheme', general: 'xun_yu', kind: 'rumor', to: 'chengdu' }]).ok).toBe(false); // 인접 아님
    expect(validateOrders(s, 'caocao', [{ type: 'scheme', general: 'xun_yu', kind: 'sow', to: 'pingyuan', target: 'liu_bei' }]).ok).toBe(false); // 군주
  });

  it('success applies the effect; result visible to both sides', () => {
    const s = withTarget();
    s.rules.scheme.baseChance.rumor = 100;
    s.rules.scheme.skillMul = 0;
    expect(schemeChance(s, 'rumor', 90, 'pingyuan')).toBe(0.95);
    let hits = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const t = structuredClone(s);
      t.rng = seed;
      const n = resolveTurn(t, { caocao: [{ type: 'scheme', general: 'xun_yu', kind: 'rumor', to: 'pingyuan' }] }, { ai: [] });
      if (n.cities.pingyuan.loyalty < s.cities.pingyuan.loyalty - 5) {
        hits++;
        expect(n.log.some((l) => l.visibleTo.includes('liubei') && l.text.includes('유언비어'))).toBe(true);
      }
    }
    expect(hits).toBeGreaterThanOrEqual(7);
  });

  it('sow lowers the target general loyalty', () => {
    const s = withTarget();
    s.rules.scheme.baseChance.sow = 100;
    s.rules.scheme.skillMul = 0;
    s.rng = 3;
    const n = resolveTurn(s, { caocao: [{ type: 'scheme', general: 'xun_yu', kind: 'sow', to: 'pingyuan', target: 'zhang_fei' }] }, { ai: [] });
    expect(n.generals.zhang_fei.loyalty).toBeLessThan(s.generals.zhang_fei.loyalty);
  });
});

describe('events', () => {
  it('rebellion can turn a disloyal, ungarrisoned city neutral and evacuate generals', () => {
    const s = newGame(4, applyRulesPatch(quiet(), { events: { rebellionChance: 100 } }));
    s.cities.xiaopei.loyalty = 0;
    s.cities.xiaopei.units = { spear: 10, cavalry: 0, archer: 0, navy: 0, siege: 0 };
    const n = resolveTurn(s, {}, { ai: [] });
    expect(n.cities.xiaopei.owner).toBeNull();
    for (const id of ['cao_bao', 'zang_ba']) {
      expect(n.generals[id].city).not.toBe('xiaopei');
      expect(n.cities[n.generals[id].city].owner).toBe('taoqian');
    }
  });

  it('events are deterministic for the same seed', () => {
    let a = newGame(9);
    let b = newGame(9);
    const ai = scenario.factions.map((f) => f.id);
    for (let i = 0; i < 24; i++) {
      a = resolveTurn(a, {}, { ai });
      b = resolveTurn(b, {}, { ai });
    }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
