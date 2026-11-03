import type { Rng } from './rng';
import { DEFAULT_RULES, type Rules } from './rules';
import type { CityState, GameState } from './types';
import { removeProportional } from './units';
import { clamp, evacuateGenerals, josa, pushLog, resetCityOwnership, totalTroops } from './util';
import { FACILITY_LABEL } from './commands';

const popFactor = (c: CityState) => 0.5 + c.population / 1_000_000;
const loyaltyFactor = (c: CityState) => 0.4 + c.loyalty / 200;

export function monthlyIncome(c: CityState, r: Rules = DEFAULT_RULES): number {
  const tax = r.tax.incomeMul[c.tax ?? 'normal'];
  const market = 1 + (c.facilities?.market ?? 0) * r.facility.perLevel.market;
  return Math.floor(((c.commerce * loyaltyFactor(c) * popFactor(c)) / r.economy.incomeDiv) * tax * market);
}

export function harvestAmount(c: CityState, r: Rules = DEFAULT_RULES): number {
  const farm = 1 + (c.facilities?.farm ?? 0) * r.facility.perLevel.farm;
  return Math.floor(c.agriculture * loyaltyFactor(c) * popFactor(c) * r.economy.harvestMul * farm);
}

export function foodUpkeep(c: CityState, r: Rules = DEFAULT_RULES): number {
  return Math.ceil(totalTroops(c) / r.economy.foodUpkeepDiv);
}

/** 병사 급료 (금) */
export function goldUpkeep(c: CityState, r: Rules = DEFAULT_RULES): number {
  return Math.ceil(totalTroops(c) / r.economy.goldUpkeepDiv);
}

/** 월간 경제 처리: 시설 건설, 이벤트, 세금, 수확, 급료·군량, 인구, 태수, 장수 충성도 */
export function runEconomy(state: GameState, rng: Rng): void {
  const R = state.rules;
  const E = R.economy;
  const V = R.events;
  for (const c of Object.values(state.cities)) {
    if (!c.owner) {
      // 중립 도시: 수비병이 서서히 회복
      if (totalTroops(c) < E.neutralCap) c.units.spear += E.neutralRegen;
      continue;
    }
    const own = [c.owner];
    const governor = c.governor ? state.generals[c.governor] : null;
    if (governor && !(governor.status === 'active' && governor.faction === c.owner && governor.city === c.id)) {
      c.governor = null;
    }
    const gov = c.governor ? state.generals[c.governor] : null;

    // 시설 건설
    if (c.construction) {
      c.construction.monthsLeft -= 1;
      if (c.construction.monthsLeft <= 0) {
        const f = c.construction.facility;
        c.facilities[f] = Math.min(R.facility.maxLevel, c.facilities[f] + 1);
        pushLog(state, 'domestic', `${c.name}: ${FACILITY_LABEL[f]} ${c.facilities[f]}단계 완공`, own, c.id);
        c.construction = null;
      }
    }

    // 수입
    c.gold += monthlyIncome(c, R);
    c.loyalty = clamp(c.loyalty + R.tax.loyaltyDelta[c.tax], 0, 100);

    // 수확 (풍작·흉년)
    if (state.month === E.harvestMonth) {
      let h = harvestAmount(c, R);
      let note = '';
      if (rng.chance(V.bumperChance / 100)) {
        h = Math.floor(h * V.bumperMul);
        note = ' (풍작)';
      } else if (rng.chance(V.droughtChance / 100)) {
        h = Math.floor(h * V.droughtMul);
        note = ' (흉년)';
      }
      c.food += h;
      pushLog(state, 'economy', `${c.name}: 군량 ${h} 수확${note}`, own, c.id);
    }

    // 역병
    if (rng.chance(V.plagueChance / 100)) {
      const pop = Math.floor(c.population * V.plagueRate);
      c.population -= pop;
      const lost = removeProportional(c.units, Math.floor(totalTroops(c) * V.plagueRate));
      pushLog(state, 'economy', `${c.name}: 역병이 돌아 인구 ${pop}, 병사 ${lost}을 잃었다`, [], c.id);
    }

    // 홍수 (강 도시, 6~8월)
    if ((state.rivers[c.id]?.length ?? 0) > 0 && state.month >= 6 && state.month <= 8 && rng.chance(V.floodChance / 100)) {
      const agr = Math.floor(c.agriculture * V.floodRate);
      const def = Math.floor(c.defense * V.floodRate);
      c.agriculture -= agr;
      c.defense -= def;
      pushLog(state, 'economy', `${c.name}: 홍수로 농업 −${agr}, 성벽 −${def}`, [], c.id);
    }

    // 급료·군량
    const pay = goldUpkeep(c, R);
    if (c.gold >= pay) {
      c.gold -= pay;
    } else {
      c.gold = 0;
      c.training = clamp(c.training - 5, 0, 100);
    }
    const need = foodUpkeep(c, R);
    if (c.food >= need) {
      c.food -= need;
    } else {
      c.food = 0;
      const lost = removeProportional(c.units, Math.floor(totalTroops(c) * E.desertionRate));
      c.loyalty = clamp(c.loyalty - 3, 0, 100);
      pushLog(state, 'economy', `${c.name}: 군량 부족으로 병사 ${lost}명이 탈영했다`, own, c.id);
    }

    // 태수
    if (gov) {
      const field = c.agriculture <= c.commerce ? 'agriculture' : 'commerce';
      const gain = Math.floor(gov.pol / Math.max(1, R.governor.developDiv));
      if (gain > 0) c[field] = clamp(c[field] + gain, 0, R.domestic.maxDev);
      if (gov.cha >= R.governor.loyaltyChaMin) c.loyalty = clamp(c.loyalty + 1, 0, 100);
    }

    // 인구
    const growth = Math.floor((c.population * (c.loyalty - E.popGrowthPivot)) / E.popGrowthDiv);
    c.population = clamp(c.population + growth, 10000, E.maxPopulation);

    // 반란
    if (c.loyalty < V.rebellionLoyalty) {
      const p = ((V.rebellionLoyalty - c.loyalty) / V.rebellionLoyalty) * (V.rebellionChance / 100) * (gov ? R.governor.rebellionMul : 1);
      if (rng.chance(p)) rebellion(state, c, rng);
    }
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
      for (const c of Object.values(state.cities)) if (c.governor === g.id) c.governor = null;
      pushLog(state, 'personnel', `${josa(g.name, '이', '가')} ${fname} 세력을 떠나 재야로 돌아갔다`, [f.id], g.city);
    }
  }

}

/** 반란: 반란군이 수비병과 싸워, 이기면 도시가 중립이 된다 */
function rebellion(state: GameState, c: CityState, rng: Rng): void {
  const owner = c.owner!;
  const rebels = Math.max(500, Math.floor(c.population / state.rules.events.rebelPopDiv));
  const garrison = totalTroops(c);
  const clash = Math.min(garrison, Math.floor(rebels * rng.range(0.6, 0.9)));
  removeProportional(c.units, clash);
  c.gold = Math.floor(c.gold * 0.8);
  if (totalTroops(c) > 0) {
    c.loyalty = clamp(c.loyalty + 5, 0, 100); // 진압 후 일시적 안정
    pushLog(state, 'military', `${c.name}: 반란이 일어났으나 진압했다 (병사 −${clash})`, [], c.id);
    return;
  }
  evacuateGenerals(state, c, owner);
  c.owner = null;
  resetCityOwnership(c);
  c.units.spear = Math.max(0, rebels - clash);
  c.loyalty = 50;
  pushLog(state, 'military', `${c.name}: 반란군이 도시를 장악했다`, [], c.id);
}
