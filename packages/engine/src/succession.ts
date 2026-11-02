import type { Rng } from './rng';
import type { FactionId, GameState } from './types';
import { activeGeneralsOf, citiesOf, josa, pushLog } from './util';

/** 세력의 도시 상실·군주 부재 후 처리: 후계자 옹립 또는 멸망 */
export function handleFactionLoss(state: GameState, faction: FactionId, rng: Rng): void {
  const f = state.factions[faction];
  if (!f || !f.alive) return;
  const cities = citiesOf(state, faction);
  if (cities.length === 0) {
    destroyFaction(state, faction);
    return;
  }
  const ruler = state.generals[f.ruler];
  if (ruler && ruler.status === 'active' && ruler.faction === faction) return;
  const candidates = activeGeneralsOf(state, faction).sort((a, b) => b.cha + b.pol - (a.cha + a.pol));
  if (candidates.length === 0) {
    for (const c of cities) c.owner = null;
    destroyFaction(state, faction);
    return;
  }
  const heir = candidates[0];
  f.ruler = heir.id;
  heir.loyalty = 100;
  pushLog(state, 'system', `${f.name} 세력은 ${josa(heir.name, '을', '를')} 새 군주로 옹립했다.`);
  void rng;
}

function destroyFaction(state: GameState, faction: FactionId): void {
  const f = state.factions[faction];
  f.alive = false;
  for (const g of Object.values(state.generals)) {
    if (g.status === 'active' && g.faction === faction) {
      g.status = 'free';
      g.faction = null;
    }
    if (g.status === 'captive' && g.captor === faction) {
      g.status = 'free';
      g.captor = null;
      g.formerFaction = null;
    }
    if (g.formerFaction === faction) g.formerFaction = null;
  }
  for (const [key, rel] of Object.entries(state.relations)) {
    if (key.split('|').includes(faction)) {
      rel.status = 'neutral';
      rel.truceUntil = null;
    }
  }
  state.proposals = state.proposals.filter((p) => p.from !== faction && p.to !== faction);
  pushLog(state, 'system', `${f.name} 세력이 멸망했다.`);
}
