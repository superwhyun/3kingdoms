import type { Scenario } from '@ch/data';
import type { GameState } from './types';
import { relationKey } from './util';

export interface CreateGameOptions {
  seed: number;
  /** 이 해가 끝나면 게임 종료. 기본: 시작 연도 + 30 */
  endYear?: number;
}

export function createGame(scenario: Scenario, opts: CreateGameOptions): GameState {
  const state: GameState = {
    version: 1,
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
    relations: {},
    proposals: [],
    nextProposalId: 1,
    log: [],
    finished: false,
    winner: null,
  };
  for (const c of scenario.cities) {
    state.cities[c.id] = {
      id: c.id, name: c.name, x: c.x, y: c.y, owner: c.owner,
      population: c.population, agriculture: c.agriculture, commerce: c.commerce,
      defense: c.defense, loyalty: c.loyalty, gold: c.gold, food: c.food,
      troops: c.troops, training: c.training,
    };
    state.roads[c.id] = [];
  }
  for (const [a, b] of scenario.roads) {
    if (!state.roads[a].includes(b)) state.roads[a].push(b);
    if (!state.roads[b].includes(a)) state.roads[b].push(a);
  }
  for (const id of Object.keys(state.roads)) state.roads[id].sort();
  for (const g of scenario.generals) {
    state.generals[g.id] = {
      id: g.id, name: g.name, war: g.war, int: g.int, pol: g.pol, cha: g.cha,
      faction: g.faction, city: g.city, status: g.status, loyalty: g.loyalty,
      captor: null, formerFaction: null,
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
