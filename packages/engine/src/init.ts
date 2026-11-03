import type { Scenario } from '@ch/data';
import type { GameState } from './types';
import { DEFAULT_RULES, FACILITY_TYPES, type FacilityType, type Rules } from './rules';
import { emptyUnits, type Units } from './units';

export function emptyFacilities(): Record<FacilityType, number> {
  return Object.fromEntries(FACILITY_TYPES.map((f) => [f, 0])) as Record<FacilityType, number>;
}
import { relationKey } from './util';

/** 시나리오의 단일 병력 값을 기본 병종 비율로 나눈다 */
export function splitTroops(troops: number, river: boolean): Units {
  const u = emptyUnits();
  u.archer = Math.floor(troops * 0.3);
  u.cavalry = Math.floor(troops * 0.2);
  u.navy = river ? Math.floor(troops * 0.1) : 0;
  u.spear = troops - u.archer - u.cavalry - u.navy;
  return u;
}

export interface CreateGameOptions {
  seed: number;
  /** 이 해가 끝나면 게임 종료. 기본: 시작 연도 + 30 */
  endYear?: number;
  /** 규칙 조정값. 기본: DEFAULT_RULES */
  rules?: Rules;
}

export function createGame(scenario: Scenario, opts: CreateGameOptions): GameState {
  const state: GameState = {
    version: 3,
    rules: structuredClone(opts.rules ?? DEFAULT_RULES),
    scenarioId: scenario.id,
    year: scenario.startYear,
    month: scenario.startMonth,
    turn: 0,
    endYear: opts.endYear ?? scenario.startYear + 30,
    rng: opts.seed >>> 0,
    cities: {},
    generals: {},
    factions: {},
    roads: {},
    rivers: {},
    relations: {},
    proposals: [],
    nextProposalId: 1,
    log: [],
    battles: [],
    finished: false,
    winner: null,
  };
  const riverCities = new Set(scenario.rivers.flat());
  for (const c of scenario.cities) {
    state.cities[c.id] = {
      id: c.id, name: c.name, x: c.x, y: c.y, owner: c.owner,
      population: c.population, agriculture: c.agriculture, commerce: c.commerce,
      defense: c.defense, loyalty: c.loyalty, gold: c.gold, food: c.food,
      units: splitTroops(c.troops, riverCities.has(c.id)), training: c.training, defensePlan: null,
      tax: 'normal', governor: null, facilities: emptyFacilities(), construction: null,
    };
    state.roads[c.id] = [];
    state.rivers[c.id] = [];
  }
  for (const [a, b] of scenario.roads) {
    if (!state.roads[a].includes(b)) state.roads[a].push(b);
    if (!state.roads[b].includes(a)) state.roads[b].push(a);
  }
  for (const [a, b] of scenario.rivers) {
    state.rivers[a].push(b);
    state.rivers[b].push(a);
  }
  for (const id of Object.keys(state.roads)) {
    state.roads[id].sort();
    state.rivers[id].sort();
  }
  for (const g of scenario.generals) {
    state.generals[g.id] = {
      id: g.id, name: g.name, war: g.war, int: g.int, pol: g.pol, cha: g.cha,
      faction: g.faction, city: g.city, status: g.status, loyalty: g.loyalty,
      captor: null, formerFaction: null,
      ...(g.apt ? { apt: { ...g.apt } } : {}),
    };
  }
  for (const f of scenario.factions) {
    state.factions[f.id] = { id: f.id, name: f.name, color: f.color, ruler: f.ruler, alive: true };
  }
  const ids = scenario.factions.map((f) => f.id);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      state.relations[relationKey(ids[i], ids[j])] = { status: 'neutral', friendship: 30, truceUntil: null };
    }
  }
  return state;
}
