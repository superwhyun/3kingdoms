import { z } from 'zod';

export const CityDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  x: z.number(),
  y: z.number(),
  population: z.number().int().positive(),
  agriculture: z.number().int().min(0).max(999),
  commerce: z.number().int().min(0).max(999),
  defense: z.number().int().min(0).max(999),
  loyalty: z.number().int().min(0).max(100),
  gold: z.number().int().min(0),
  food: z.number().int().min(0),
  troops: z.number().int().min(0),
  training: z.number().int().min(0).max(100),
  owner: z.string().nullable(),
});

export const GeneralDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  war: z.number().int().min(1).max(100),
  int: z.number().int().min(1).max(100),
  pol: z.number().int().min(1).max(100),
  cha: z.number().int().min(1).max(100),
  faction: z.string().nullable(),
  city: z.string(),
  /** active: 세력 소속, free: 재야(발견됨), hidden: 재야(탐색 필요) */
  status: z.enum(['active', 'free', 'hidden']),
  loyalty: z.number().int().min(0).max(100),
});

export const FactionDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  ruler: z.string(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export const ScenarioSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  startYear: z.number().int(),
  startMonth: z.number().int().min(1).max(12),
  cities: z.array(CityDefSchema),
  roads: z.array(z.tuple([z.string(), z.string()])),
  factions: z.array(FactionDefSchema),
  generals: z.array(GeneralDefSchema),
});

export type CityDef = z.infer<typeof CityDefSchema>;
export type GeneralDef = z.infer<typeof GeneralDefSchema>;
export type FactionDef = z.infer<typeof FactionDefSchema>;
export type Scenario = z.infer<typeof ScenarioSchema>;

/** 스키마 검증 + 참조 무결성 검사. 문제가 있으면 예외. */
export function validateScenario(raw: unknown): Scenario {
  const s = ScenarioSchema.parse(raw);
  const cityIds = new Set(s.cities.map((c) => c.id));
  const factionIds = new Set(s.factions.map((f) => f.id));
  const generalIds = new Set<string>();
  const errors: string[] = [];
  const dup = (kind: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) errors.push(`duplicate ${kind} id: ${id}`);
      seen.add(id);
    }
  };
  dup('city', s.cities.map((c) => c.id));
  dup('faction', s.factions.map((f) => f.id));
  dup('general', s.generals.map((g) => g.id));
  for (const g of s.generals) generalIds.add(g.id);
  for (const c of s.cities) {
    if (c.owner && !factionIds.has(c.owner)) errors.push(`city ${c.id}: unknown owner ${c.owner}`);
  }
  for (const [a, b] of s.roads) {
    if (!cityIds.has(a) || !cityIds.has(b)) errors.push(`road ${a}-${b}: unknown city`);
    if (a === b) errors.push(`road ${a}-${b}: self loop`);
  }
  for (const g of s.generals) {
    if (!cityIds.has(g.city)) errors.push(`general ${g.id}: unknown city ${g.city}`);
    if (g.faction && !factionIds.has(g.faction)) errors.push(`general ${g.id}: unknown faction ${g.faction}`);
    if (g.status === 'active' && !g.faction) errors.push(`general ${g.id}: active without faction`);
    if (g.status !== 'active' && g.faction) errors.push(`general ${g.id}: ${g.status} with faction`);
    if (g.faction) {
      const city = s.cities.find((c) => c.id === g.city);
      if (city && city.owner !== g.faction) errors.push(`general ${g.id}: stationed in non-owned city ${g.city}`);
    }
  }
  for (const f of s.factions) {
    const ruler = s.generals.find((g) => g.id === f.ruler);
    if (!ruler) errors.push(`faction ${f.id}: unknown ruler ${f.ruler}`);
    else if (ruler.faction !== f.id) errors.push(`faction ${f.id}: ruler belongs to ${ruler.faction}`);
    if (!s.cities.some((c) => c.owner === f.id)) errors.push(`faction ${f.id}: owns no city`);
  }
  // 도로망 연결성
  const adj = new Map<string, string[]>();
  for (const c of s.cities) adj.set(c.id, []);
  for (const [a, b] of s.roads) {
    adj.get(a)?.push(b);
    adj.get(b)?.push(a);
  }
  if (s.cities.length > 0) {
    const seen = new Set<string>([s.cities[0].id]);
    const queue = [s.cities[0].id];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const n of adj.get(cur) ?? []) {
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    for (const c of s.cities) if (!seen.has(c.id)) errors.push(`city ${c.id}: not connected`);
  }
  if (errors.length) throw new Error(`invalid scenario ${s.id}:\n${errors.join('\n')}`);
  return s;
}
