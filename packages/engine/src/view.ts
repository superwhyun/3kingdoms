import type { BattleReport, FactionId, GameState, GeneralStatus, LogEntry, Proposal, Relation, RoundPlan, UnitType, Units } from './types';
import { totalTroops } from './util';

export interface CityView {
  id: string;
  name: string;
  x: number;
  y: number;
  owner: FactionId | null;
  population: number;
  agriculture: number;
  commerce: number;
  defense: number;
  loyalty: number;
  /** 정보 없음이면 null */
  gold: number | null;
  food: number | null;
  /** 병력 합계 (인접 도시는 근사치) */
  troops: number | null;
  /** 병종별 병력 (아군만) */
  units: Units | null;
  /** 수비 전략 (아군만) */
  defensePlan: RoundPlan[] | null;
  /** 강을 끼는 인접 도시 */
  rivers: string[];
  training: number | null;
  /** 시야 등급: own(아군) / near(인접, 근사치) / far(소유자만) */
  intel: 'own' | 'near' | 'far';
}

export interface GeneralView {
  id: string;
  name: string;
  war: number;
  int: number;
  pol: number;
  cha: number;
  faction: FactionId | null;
  city: string | null;
  status: GeneralStatus;
  loyalty: number | null;
  captor: FactionId | null;
  apt: Partial<Record<UnitType, number>> | null;
}

export interface GameView {
  scenarioId: string;
  year: number;
  month: number;
  turn: number;
  endYear: number;
  me: FactionId | null;
  cities: CityView[];
  generals: GeneralView[];
  factions: { id: string; name: string; color: string; ruler: string; alive: boolean; cities: number }[];
  roads: Record<string, string[]>;
  relations: Record<string, Relation>;
  proposals: Proposal[];
  log: LogEntry[];
  /** 내가 당사자인 직전 턴 전투 */
  battles: BattleReport[];
  finished: boolean;
  winner: FactionId | null;
}

const approx = (n: number) => Math.round(n / 1000) * 1000;

/** 세력 시점의 상태(정보 은닉 적용). me가 null이면 관전자 시점. */
export function viewFor(state: GameState, me: FactionId | null): GameView {
  const ownCities = new Set(Object.values(state.cities).filter((c) => me && c.owner === me).map((c) => c.id));
  const near = new Set<string>();
  for (const id of ownCities) for (const n of state.roads[id]) if (!ownCities.has(n)) near.add(n);
  const intelOf = (id: string): CityView['intel'] => (ownCities.has(id) ? 'own' : near.has(id) ? 'near' : 'far');

  const cities: CityView[] = Object.values(state.cities).map((c) => {
    const intel = intelOf(c.id);
    const full = intel === 'own';
    return {
      id: c.id, name: c.name, x: c.x, y: c.y, owner: c.owner,
      population: c.population, agriculture: c.agriculture, commerce: c.commerce,
      defense: c.defense, loyalty: c.loyalty,
      gold: full ? c.gold : null,
      food: full ? c.food : null,
      troops: full ? totalTroops(c) : intel === 'near' ? approx(totalTroops(c)) : null,
      units: full ? { ...c.units } : null,
      defensePlan: full ? c.defensePlan : null,
      rivers: state.rivers[c.id] ?? [],
      training: full ? c.training : null,
      intel,
    };
  });

  const generals: GeneralView[] = [];
  for (const g of Object.values(state.generals)) {
    if (g.status === 'hidden') continue;
    const mine = me !== null && g.faction === me;
    const heldByMe = me !== null && g.status === 'captive' && g.captor === me;
    const seen = ownCities.has(g.city) || near.has(g.city);
    if (!mine && !heldByMe && g.status !== 'active' && !seen) continue;
    generals.push({
      id: g.id, name: g.name, war: g.war, int: g.int, pol: g.pol, cha: g.cha,
      faction: g.faction,
      city: mine || heldByMe || seen ? g.city : null,
      status: g.status,
      loyalty: mine ? g.loyalty : null,
      captor: g.captor,
      apt: g.apt ?? null,
    });
  }

  const counts: Record<string, number> = {};
  for (const c of Object.values(state.cities)) if (c.owner) counts[c.owner] = (counts[c.owner] ?? 0) + 1;

  return {
    scenarioId: state.scenarioId,
    year: state.year,
    month: state.month,
    turn: state.turn,
    endYear: state.endYear,
    me,
    cities,
    generals,
    factions: Object.values(state.factions).map((f) => ({
      id: f.id, name: f.name, color: f.color, ruler: f.ruler, alive: f.alive, cities: counts[f.id] ?? 0,
    })),
    roads: state.roads,
    relations: state.relations,
    proposals: state.proposals.filter((p) => me !== null && (p.from === me || p.to === me)),
    battles: (state.battles ?? []).filter((b) => me !== null && (b.attacker === me || b.defender === me)),
    log: state.log.filter((l) => l.visibleTo.length === 0 || (me !== null && l.visibleTo.includes(me))),
    finished: state.finished,
    winner: state.winner,
  };
}
