import { describe, expect, it } from 'vitest';
import { getScenario } from '@ch/data';
import {
  createGame,
  resolveTurn,
  validateOrders,
  viewFor,
  type Command,
  type GameState,
} from '../src';

const scenario = getScenario('y190');
const allFactions = scenario.factions.map((f) => f.id);
const newGame = (seed = 42) => createGame(scenario, { seed });

function checkInvariants(s: GameState) {
  for (const c of Object.values(s.cities)) {
    for (const k of ['gold', 'food', 'troops', 'population', 'agriculture', 'commerce', 'defense'] as const) {
      expect(c[k], `${c.id}.${k}`).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(c[k])).toBe(true);
    }
    expect(c.loyalty).toBeGreaterThanOrEqual(0);
    expect(c.loyalty).toBeLessThanOrEqual(100);
    expect(c.training).toBeGreaterThanOrEqual(0);
    expect(c.training).toBeLessThanOrEqual(100);
    if (c.owner) expect(s.factions[c.owner].alive, `${c.id} owned by dead faction`).toBe(true);
  }
  for (const g of Object.values(s.generals)) {
    expect(s.cities[g.city], `${g.id} city`).toBeDefined();
    if (g.status === 'active') {
      expect(g.faction).not.toBeNull();
      expect(s.factions[g.faction!].alive, `${g.id} in dead faction`).toBe(true);
      expect(s.cities[g.city].owner, `${g.id} stationed in foreign city`).toBe(g.faction);
    } else {
      expect(g.faction).toBeNull();
    }
    if (g.status === 'captive') expect(g.captor).not.toBeNull();
  }
  for (const f of Object.values(s.factions)) {
    if (!f.alive) continue;
    const ruler = s.generals[f.ruler];
    expect(ruler.status, `${f.id} ruler status`).toBe('active');
    expect(ruler.faction).toBe(f.id);
    expect(Object.values(s.cities).some((c) => c.owner === f.id)).toBe(true);
  }
}

describe('scenario & init', () => {
  it('creates a consistent initial state', () => {
    const s = newGame();
    expect(Object.keys(s.cities).length).toBeGreaterThanOrEqual(35);
    expect(Object.keys(s.factions).length).toBe(11);
    checkInvariants(s);
  });
});

describe('commands', () => {
  it('develop consumes gold and raises the stat', () => {
    const s = newGame();
    const before = s.cities.chenliu;
    const next = resolveTurn(s, { caocao: [{ type: 'develop', general: 'xun_yu', field: 'agriculture' }] }, { ai: [] });
    expect(next.cities.chenliu.agriculture).toBeGreaterThan(before.agriculture);
    expect(next.log.some((l) => l.text.includes('순욱') && l.visibleTo.includes('caocao'))).toBe(true);
    // 입력 상태 불변
    expect(s.cities.chenliu.agriculture).toBe(before.agriculture);
  });

  it('validation accumulates resource usage and rejects double actions', () => {
    const s = newGame();
    s.cities.chenliu.gold = 120;
    const cmds: Command[] = [
      { type: 'develop', general: 'xun_yu', field: 'commerce' },
      { type: 'develop', general: 'cao_cao', field: 'commerce' },
      { type: 'develop', general: 'cao_ren', field: 'commerce' },
      { type: 'train', general: 'xun_yu' },
    ];
    const v = validateOrders(s, 'caocao', cmds);
    expect(v.ok).toBe(false);
    expect(v.errors.map((e) => e.index)).toEqual([2, 3]);
  });

  it('rejects commanding another faction\'s general', () => {
    const s = newGame();
    const v = validateOrders(s, 'caocao', [{ type: 'train', general: 'lu_bu' }]);
    expect(v.ok).toBe(false);
  });

  it('rejects malformed input safely', () => {
    const s = newGame();
    const v = validateOrders(s, 'caocao', [null as never, { type: 'nope' } as never, { type: 'draft', general: 'xun_yu', amount: -5 }]);
    expect(v.errors.length).toBe(3);
  });

  it('draft adds troops and reduces population', () => {
    const s = newGame();
    const n = resolveTurn(s, { caocao: [{ type: 'draft', general: 'cao_hong', amount: 1000 }] }, { ai: [] });
    expect(n.cities.chenliu.troops).toBe(s.cities.chenliu.troops + 1000);
    expect(n.cities.chenliu.population).toBeLessThan(s.cities.chenliu.population);
  });

  it('overwhelming attack captures a neutral city and moves generals', () => {
    const s = newGame();
    s.cities.chenliu.troops = 30000;
    s.cities.chenliu.food = 20000;
    const n = resolveTurn(
      s,
      { caocao: [{ type: 'attack', generals: ['xiahou_dun', 'cao_ren'], to: 'xuchang', troops: 25000, food: 5000 }] },
      { ai: [] },
    );
    expect(n.cities.xuchang.owner).toBe('caocao');
    expect(n.generals.xiahou_dun.city).toBe('xuchang');
    checkInvariants(n);
  });

  it('cannot attack an ally', () => {
    const s = newGame();
    s.relations['caocao|liubei'] = { status: 'alliance', friendship: 80, truceUntil: null };
    s.roads.chenliu.push('pingyuan');
    s.roads.pingyuan.push('chenliu');
    const v = validateOrders(s, 'caocao', [{ type: 'attack', generals: ['xiahou_dun'], to: 'pingyuan', troops: 1000, food: 100 }]);
    expect(v.ok).toBe(false);
  });

  it('capturing the last city destroys the faction', () => {
    const s = newGame();
    s.cities.chenliu.troops = 60000;
    s.cities.chenliu.training = 100;
    s.cities.chenliu.food = 50000;
    s.roads.chenliu.push('pingyuan');
    s.roads.pingyuan.push('chenliu');
    s.cities.pingyuan.troops = 100;
    const n = resolveTurn(
      s,
      { caocao: [{ type: 'attack', generals: ['xiahou_dun', 'cao_ren', 'xiahou_yuan'], to: 'pingyuan', troops: 50000, food: 10000 }] },
      { ai: [] },
    );
    expect(n.cities.pingyuan.owner).toBe('caocao');
    expect(n.factions.liubei.alive).toBe(false);
    checkInvariants(n);
  });

  it('alliance proposal → acceptance next turn', () => {
    let s = newGame();
    s = resolveTurn(s, { caocao: [{ type: 'propose', to: 'liubei', kind: 'alliance' }] }, { ai: [] });
    const p = s.proposals.find((x) => x.from === 'caocao' && x.to === 'liubei');
    expect(p).toBeDefined();
    expect(viewFor(s, 'liubei').proposals.length).toBe(1);
    expect(viewFor(s, 'sunjian').proposals.length).toBe(0);
    s = resolveTurn(s, { liubei: [{ type: 'respond', proposal: p!.id, accept: true }] }, { ai: [] });
    expect(s.relations['caocao|liubei'].status).toBe('alliance');
  });
});

describe('turn resolution', () => {
  it('is deterministic for identical input', () => {
    let a = newGame(7);
    let b = newGame(7);
    for (let i = 0; i < 24; i++) {
      a = resolveTurn(a, {}, { ai: allFactions });
      b = resolveTurn(b, {}, { ai: allFactions });
    }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('advances the calendar and harvests in month 7', () => {
    let s = newGame();
    for (let i = 0; i < 6; i++) s = resolveTurn(s, {}, { ai: [] });
    expect(s.month).toBe(7);
    const food = s.cities.chenliu.food;
    s = resolveTurn(s, {}, { ai: [] });
    expect(s.cities.chenliu.food).toBeGreaterThan(food);
    expect(s.month).toBe(8);
  });

  it('long AI-only simulation keeps invariants and makes progress', () => {
    for (const seed of [1, 2, 3]) {
      let s = createGame(scenario, { seed, endYear: 260 });
      const initialOwned = Object.values(s.cities).filter((c) => c.owner).length;
      for (let i = 0; i < 400 && !s.finished; i++) {
        s = resolveTurn(s, {}, { ai: allFactions });
        if (i % 25 === 0) checkInvariants(s);
      }
      checkInvariants(s);
      const owned = Object.values(s.cities).filter((c) => c.owner).length;
      expect(owned).toBeGreaterThan(initialOwned);
      const alive = Object.values(s.factions).filter((f) => f.alive).length;
      expect(alive).toBeLessThan(11);
    }
  });

  it('ends at endYear with a winner', () => {
    let s = createGame(scenario, { seed: 9, endYear: 191 });
    for (let i = 0; i < 30 && !s.finished; i++) s = resolveTurn(s, {}, { ai: allFactions });
    expect(s.finished).toBe(true);
    expect(s.winner).not.toBeNull();
  });
});

describe('view', () => {
  it('hides foreign resources and hidden generals', () => {
    const s = newGame();
    const v = viewFor(s, 'caocao');
    const own = v.cities.find((c) => c.id === 'chenliu')!;
    const far = v.cities.find((c) => c.id === 'chengdu')!;
    const near = v.cities.find((c) => c.id === 'luoyang')!;
    expect(own.gold).not.toBeNull();
    expect(far.gold).toBeNull();
    expect(far.troops).toBeNull();
    expect(near.troops! % 1000).toBe(0);
    expect(v.generals.some((g) => g.id === 'zhuge_liang')).toBe(false);
    expect(v.generals.find((g) => g.id === 'liu_yan')!.city).toBeNull();
  });
});
