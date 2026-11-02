import type { Rng } from './rng';
import type { CityState, GameState } from './types';
import { clamp, josa, pushLog } from './util';

export const HARVEST_MONTH = 7;
export const MAX_POPULATION = 1_500_000;

const popFactor = (c: CityState) => 0.5 + c.population / 1_000_000;
const loyaltyFactor = (c: CityState) => 0.4 + c.loyalty / 200;

export function monthlyIncome(c: CityState): number {
  return Math.floor((c.commerce * loyaltyFactor(c) * popFactor(c)) / 2);
}

export function harvestAmount(c: CityState): number {
  return Math.floor(c.agriculture * loyaltyFactor(c) * popFactor(c) * 12);
}

export function foodUpkeep(c: CityState): number {
  return Math.ceil(c.troops / 60);
}

/** 병사 급료 (금) */
export function goldUpkeep(c: CityState): number {
  return Math.ceil(c.troops / 250);
}

/** 월간 경제 처리: 세금, 수확, 군량 소비, 인구 변화, 장수 충성도 */
export function runEconomy(state: GameState, rng: Rng): void {
  for (const c of Object.values(state.cities)) {
    if (!c.owner) {
      // 중립 도시: 수비병이 서서히 회복
      if (c.troops < 3000) c.troops += 50;
      continue;
    }
    const own = [c.owner];
    c.gold += monthlyIncome(c);
    if (state.month === HARVEST_MONTH) {
      const h = harvestAmount(c);
      c.food += h;
      pushLog(state, 'economy', `${c.name}: 군량 ${h} 수확`, own, c.id);
    }
    const pay = goldUpkeep(c);
    if (c.gold >= pay) {
      c.gold -= pay;
    } else {
      c.gold = 0;
      c.training = clamp(c.training - 5, 0, 100);
    }
    const need = foodUpkeep(c);
    if (c.food >= need) {
      c.food -= need;
    } else {
      c.food = 0;
      const lost = Math.floor(c.troops * 0.15);
      c.troops -= lost;
      c.loyalty = clamp(c.loyalty - 3, 0, 100);
      pushLog(state, 'economy', `${c.name}: 군량 부족으로 병사 ${lost}명이 탈영했다`, own, c.id);
    }
    const growth = Math.floor((c.population * (c.loyalty - 40)) / 20000);
    c.population = clamp(c.population + growth, 10000, MAX_POPULATION);
  }

  // 장수 충성도: 연초 소폭 하락, 낮으면 출분
  for (const g of Object.values(state.generals)) {
    if (g.status !== 'active' || !g.faction) continue;
    const f = state.factions[g.faction];
    if (f.ruler === g.id) continue;
    if (state.month === 1) g.loyalty = clamp(g.loyalty - 2, 0, 100);
    if (g.loyalty < 40 && rng.chance((40 - g.loyalty) / 100)) {
      const fname = f.name;
      g.status = 'free';
      g.faction = null;
      pushLog(state, 'personnel', `${josa(g.name, '이', '가')} ${fname} 세력을 떠나 재야로 돌아갔다`, [f.id], g.city);
    }
  }
}
