import { validateScenario, type Scenario } from './schema';
import { scenario190 } from './scenarios/y190';

export * from './schema';

const registry: Record<string, Scenario> = {
  [scenario190.id]: validateScenario(scenario190),
};

export function getScenario(id: string): Scenario {
  const s = registry[id];
  if (!s) throw new Error(`unknown scenario: ${id}`);
  return s;
}

export function listScenarios(): { id: string; name: string; description: string; factions: { id: string; name: string; color: string }[] }[] {
  return Object.values(registry).map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    factions: s.factions.map((f) => ({ id: f.id, name: f.name, color: f.color })),
  }));
}
