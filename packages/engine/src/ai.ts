import { estimateOdds } from './battle';
import { DEVELOP_COST, MAX_ATTACK_GENERALS, MAX_DEV, tradeRate } from './commands';
import { harvestAmount } from './economy';
import type { Rng } from './rng';
import type { CityState, Command, FactionId, GameState, GeneralState, Proposal } from './types';
import { citiesOf, factionPower, generalsIn, getRelation, isHostile } from './util';

/** AI가 공격을 시작하는 최소 턴 (초반 유예) */
export const AI_GRACE_TURNS = 3;

function hostileNeighbors(state: GameState, faction: FactionId, city: CityState): CityState[] {
  return state.roads[city.id]
    .map((id) => state.cities[id])
    .filter((c) => c.owner !== faction && isHostile(state, faction, c.owner));
}

/** 규칙 기반 AI 명령 생성 */
export function planAI(state: GameState, faction: FactionId, rng: Rng): Command[] {
  const cmds: Command[] = [];
  const f = state.factions[faction];
  if (!f?.alive) return cmds;
  const cities = citiesOf(state, faction);
  const frontierIds = new Set(cities.filter((c) => hostileNeighbors(state, faction, c).length > 0).map((c) => c.id));

  for (const city of cities) {
    const avail: GeneralState[] = generalsIn(state, city.id, faction).sort((a, b) => b.war - a.war);
    if (avail.length === 0) continue;
    let budget = city.gold;
    let troops = city.troops;
    let food = city.food;
    const take = (pick: (g: GeneralState) => number): GeneralState | undefined => {
      if (!avail.length) return undefined;
      let best = 0;
      for (let i = 1; i < avail.length; i++) if (pick(avail[i]) > pick(avail[best])) best = i;
      return avail.splice(best, 1)[0];
    };
    const enemies = hostileNeighbors(state, faction, city);

    // 1. 공격
    if (state.turn >= AI_GRACE_TURNS && enemies.length && troops >= 4000 && rng.chance(0.7)) {
      const army = avail.slice(0, Math.min(Math.max(1, avail.length - 1), MAX_ATTACK_GENERALS));
      const armyTroops = Math.floor(troops * 0.8);
      let best: { target: CityState; odds: number } | null = null;
      for (const t of enemies) {
        const odds = estimateOdds(state, { faction, generals: army, troops: armyTroops, training: city.training }, t);
        // 중립 도시보다 적 세력 도시를 약간 선호하지 않도록 동일 취급
        if (!best || odds > best.odds) best = { target: t, odds };
      }
      if (best && best.odds >= 1.5) {
        const needFood = Math.ceil(armyTroops / 200) * 12 + 100;
        const armyFood = Math.min(Math.floor(food * 0.7), needFood);
        if (armyFood >= Math.ceil(armyTroops / 200) * 6) {
          cmds.push({ type: 'attack', generals: army.map((g) => g.id), to: best.target.id, troops: armyTroops, food: armyFood });
          for (const g of army) avail.splice(avail.indexOf(g), 1);
          troops -= armyTroops;
          food -= armyFood;
        }
      }
    }

    // 2. 등용
    const recruitable = Object.values(state.generals).filter(
      (g) => g.city === city.id && (g.status === 'free' || (g.status === 'captive' && g.captor === faction)),
    );
    const rulerIds = new Set(Object.values(state.factions).filter((x) => x.alive).map((x) => x.ruler));
    for (const t of recruitable) {
      if (rulerIds.has(t.id)) continue;
      const g = take((x) => x.cha);
      if (!g) break;
      cmds.push({ type: 'recruit', general: g.id, target: t.id });
    }

    // 3. 민심
    if (city.loyalty < 50 && budget >= DEVELOP_COST) {
      const g = take((x) => x.cha);
      if (g) {
        cmds.push({ type: 'develop', general: g.id, field: 'loyalty' });
        budget -= DEVELOP_COST;
      }
    }

    // 4. 군량 매입/매각
    const monthlyNeed = Math.ceil(troops / 60);
    const rate = tradeRate(city.commerce);
    if (food < monthlyNeed * 8 && budget > 300) {
      const spend = Math.floor(Math.min(budget - 150, ((monthlyNeed * 12 - food) / rate.buy)) / 10) * 10;
      if (spend >= 10) {
        const g = take((x) => x.pol);
        if (g) {
          cmds.push({ type: 'trade', general: g.id, action: 'buy', gold: spend });
          budget -= spend;
          food += Math.floor(spend * rate.buy);
        }
      }
    } else if (food > monthlyNeed * 30 + 20000 && budget < 300) {
      const gain = Math.floor(((food - monthlyNeed * 24) / rate.sell / 2) / 10) * 10;
      if (gain >= 10) {
        const g = take((x) => x.pol);
        if (g) {
          cmds.push({ type: 'trade', general: g.id, action: 'sell', gold: gain });
          budget += gain;
          food -= Math.ceil(gain * rate.sell);
        }
      }
    }

    // 5. 징병 (군량이 버틸 수 있는 만큼만)
    const isFrontier = frontierIds.has(city.id);
    const cap = Math.floor(city.population / (isFrontier ? 12 : 25));
    const yearlyFood = food + (state.month <= 7 ? harvestAmount(city) : 0);
    const foodCap = Math.floor((yearlyFood / 12) * 60);
    if (troops < cap && troops < foodCap && budget > 200 && city.loyalty >= 45) {
      const affordable = Math.floor(((budget - 100) * 10) / 2);
      let amount = Math.min(affordable, cap - troops, foodCap - troops, Math.floor(city.population / 20), 3000);
      amount = Math.floor(amount / 100) * 100;
      if (amount >= 100) {
        const g = take((x) => x.cha);
        if (g) {
          cmds.push({ type: 'draft', general: g.id, amount });
          budget -= Math.ceil(amount / 10);
          troops += amount;
        }
      }
    }

    // 6. 훈련
    if (city.training < 75 && troops > 2000) {
      const g = take((x) => x.war);
      if (g) cmds.push({ type: 'train', general: g.id });
    }

    // 7. 후방 병력을 전선으로
    if (!isFrontier && troops > 5000) {
      const dest = state.roads[city.id].map((id) => state.cities[id]).find((c) => c.owner === faction && frontierIds.has(c.id));
      if (dest) {
        const g = take((x) => -(x.war + x.int));
        if (g) {
          const amt = Math.floor(troops * 0.6);
          cmds.push({ type: 'transport', general: g.id, to: dest.id, gold: 0, food: Math.floor(food * 0.4), troops: amt });
          troops -= amt;
        }
      }
    }

    // 8. 장수 분산: 장수가 없는 인접 아군 도시로
    if (avail.length > 2) {
      const empty = state.roads[city.id]
        .map((id) => state.cities[id])
        .find((c) => c.owner === faction && generalsIn(state, c.id, faction).length === 0);
      if (empty) {
        const g = take((x) => x.pol);
        if (g) cmds.push({ type: 'move', general: g.id, to: empty.id });
      }
    }

    // 9. 개발
    while (avail.length && budget >= DEVELOP_COST + 80) {
      const fields: ('agriculture' | 'commerce' | 'defense')[] = isFrontier
        ? ['agriculture', 'commerce', 'defense']
        : ['agriculture', 'commerce'];
      const open = fields.filter((k) => city[k] < (k === 'defense' ? 600 : MAX_DEV));
      if (!open.length) break;
      const field = open.reduce((a, b) => (city[a] <= city[b] ? a : b));
      const g = take((x) => (field === 'defense' ? x.pol + x.war : x.pol));
      if (!g) break;
      cmds.push({ type: 'develop', general: g.id, field });
      budget -= DEVELOP_COST;
    }

    // 10. 탐색
    if (avail.length && rng.chance(0.3)) {
      const g = take((x) => x.int);
      if (g) cmds.push({ type: 'search', general: g.id });
    }
  }

  // 외교: 압도적으로 강한 인접 적에게 가끔 정전 제안
  if (rng.chance(0.08)) {
    const mine = factionPower(state, faction);
    const neighbors = new Set<FactionId>();
    for (const c of cities) for (const n of hostileNeighbors(state, faction, c)) if (n.owner) neighbors.add(n.owner);
    for (const other of neighbors) {
      if (factionPower(state, other) > mine * 1.5 && !state.proposals.some((p) => p.from === faction && p.to === other)) {
        cmds.push({ type: 'propose', to: other, kind: 'truce' });
        break;
      }
    }
  }
  return cmds;
}

/** AI가 받은 외교 제안을 수락할지 */
export function aiAcceptsProposal(state: GameState, p: Proposal): boolean {
  const rel = getRelation(state, p.from, p.to);
  const ratio = Math.min(2, factionPower(state, p.from) / Math.max(1, factionPower(state, p.to)));
  const score = rel.friendship + ratio * 20 + (p.kind === 'truce' ? 15 : 0);
  return score >= (p.kind === 'alliance' ? 75 : 60);
}
