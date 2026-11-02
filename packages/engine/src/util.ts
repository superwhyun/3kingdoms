import type { CityState, FactionId, GameState, GeneralState, LogEntry, LogKind, Relation } from './types';

export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export function relationKey(a: FactionId, b: FactionId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function getRelation(state: GameState, a: FactionId, b: FactionId): Relation {
  const key = relationKey(a, b);
  let r = state.relations[key];
  if (!r) {
    r = { status: 'neutral', friendship: 30, truceUntil: null };
    state.relations[key] = r;
  }
  return r;
}

/** 공격 가능한 관계인가 (동맹·정전이 아님) */
export function isHostile(state: GameState, a: FactionId, b: FactionId | null): boolean {
  if (b === null) return true;
  if (a === b) return false;
  const r = state.relations[relationKey(a, b)];
  return !r || r.status === 'neutral';
}

export function citiesOf(state: GameState, faction: FactionId): CityState[] {
  return Object.values(state.cities).filter((c) => c.owner === faction);
}

export function generalsIn(state: GameState, city: string, faction?: FactionId): GeneralState[] {
  return Object.values(state.generals).filter(
    (g) => g.city === city && g.status === 'active' && (faction === undefined || g.faction === faction),
  );
}

export function activeGeneralsOf(state: GameState, faction: FactionId): GeneralState[] {
  return Object.values(state.generals).filter((g) => g.status === 'active' && g.faction === faction);
}

export function isAdjacent(state: GameState, a: string, b: string): boolean {
  return state.roads[a]?.includes(b) ?? false;
}

export function factionPower(state: GameState, faction: FactionId): number {
  let p = 0;
  for (const c of citiesOf(state, faction)) p += c.troops + c.population / 50 + c.gold * 2;
  return p;
}

export function factionName(state: GameState, id: FactionId | null): string {
  if (!id) return '중립';
  return state.factions[id]?.name ?? id;
}

export function pushLog(
  state: GameState,
  kind: LogKind,
  text: string,
  visibleTo: FactionId[] = [],
  city?: string,
): void {
  const entry: LogEntry = { turn: state.turn, year: state.year, month: state.month, kind, text, visibleTo };
  if (city) entry.city = city;
  state.log.push(entry);
}

export function josa(word: string, withFinal: string, withoutFinal: string): string {
  const code = word.charCodeAt(word.length - 1);
  if (code < 0xac00 || code > 0xd7a3) return word + withoutFinal;
  return word + ((code - 0xac00) % 28 ? withFinal : withoutFinal);
}
