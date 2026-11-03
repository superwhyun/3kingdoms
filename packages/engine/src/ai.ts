import { autoPlan, estimateOdds } from './battle';
import { barracksDiscount, schemeChance, tradeRate } from './commands';
import type { TaxLevel } from './rules';
import { harvestAmount } from './economy';
import type { Rng } from './rng';
import type { CityState, Command, FactionId, GameState, GeneralState, Proposal, RoundPlan } from './types';
import { UNIT_TYPES, draftCost, emptyUnits, sumUnits, type UnitType, type Units } from './units';
import { citiesOf, factionPower, generalsIn, getRelation, isHostile, totalTroops } from './util';


function hostileNeighbors(state: GameState, faction: FactionId, city: CityState): CityState[] {
  return state.roads[city.id]
    .map((id) => state.cities[id])
    .filter((c) => c.owner !== faction && isHostile(state, faction, c.owner));
}

/** AI 공격 계획: 균등 / 정찰 후 주력 / 초반 총공 중 하나를 무작위로 */
export function makeAttackPlan(units: Units, rng: Rng): RoundPlan[] {
  const base = autoPlan(units, rng);
  const style = rng.int(0, 2);
  const total = sumUnits(units);
  return base.map((r, i) => {
    let frac: number;
    if (style === 0) frac = 0.6;
    else if (style === 1) frac = i < 2 ? 0 : 0.75;
    else frac = i < 4 ? 0.9 : 0.4;
    if (style === 1 && i < 2) return { ...r, count: Math.max(1, Math.round(total * 0.04)) };
    return { ...r, count: Math.max(1, Math.round(units[r.unit] * frac)) };
  });
}

function scaleUnits(u: Units, frac: number): Units {
  const out = emptyUnits();
  for (const t of UNIT_TYPES) out[t] = Math.floor(u[t] * frac);
  return out;
}

/** 징병 병종 선택 */
function pickDraftUnit(state: GameState, city: CityState, enemies: CityState[], rng: Rng): UnitType {
  const river = (state.rivers[city.id]?.length ?? 0) > 0;
  const strongWalls = enemies.some((e) => e.defense > 500);
  const roll = rng.next();
  if (river && roll < 0.2) return 'navy';
  if (strongWalls && roll > 0.93) return 'siege';
  const r = rng.next();
  if (r < 0.4) return 'spear';
  if (r < 0.7) return 'archer';
  return 'cavalry';
}

/** 규칙 기반 AI 명령 생성 */
export function planAI(state: GameState, faction: FactionId, rng: Rng): Command[] {
  const cmds: Command[] = [];
  const f = state.factions[faction];
  if (!f?.alive) return cmds;
  const R = state.rules;
  const DEVELOP_COST = R.domestic.developCost;
  const MAX_DEV = R.domestic.maxDev;
  const cities = citiesOf(state, faction);
  const frontierIds = new Set(cities.filter((c) => hostileNeighbors(state, faction, c).length > 0).map((c) => c.id));

  for (const city of cities) {
    const avail: GeneralState[] = generalsIn(state, city.id, faction).sort((a, b) => b.war - a.war);
    if (avail.length === 0) continue;
    let budget = city.gold;
    let troops = totalTroops(city);
    let food = city.food;
    const take = (pick: (g: GeneralState) => number): GeneralState | undefined => {
      if (!avail.length) return undefined;
      let best = 0;
      for (let i = 1; i < avail.length; i++) if (pick(avail[i]) > pick(avail[best])) best = i;
      return avail.splice(best, 1)[0];
    };
    const enemies = hostileNeighbors(state, faction, city);

    // 1. 공격
    // 0. 태수·세율 (행동 소모 없음)
    if (!city.governor || !avail.some((g) => g.id === city.governor)) {
      const gov = [...avail].sort((a, b) => b.pol - a.pol)[0];
      cmds.push({ type: 'appoint', city: city.id, general: gov.id });
    }
    const wantTax: TaxLevel = city.loyalty < 50 ? 'low' : city.loyalty > 85 ? 'high' : 'normal';
    if (city.tax !== wantTax) cmds.push({ type: 'setTax', city: city.id, tax: wantTax });

    if (state.turn >= R.ai.graceTurns && enemies.length && troops >= 4000 && rng.chance(R.ai.attackChance)) {
      const army = avail.slice(0, Math.min(Math.max(1, avail.length - 1), R.battle.maxAttackGenerals));
      const armyTroops = Math.floor(troops * 0.8);
      let best: { target: CityState; odds: number } | null = null;
      for (const t of enemies) {
        const odds = estimateOdds(state, { faction, generals: army, troops: armyTroops, training: city.training }, t);
        // 중립 도시보다 적 세력 도시를 약간 선호하지 않도록 동일 취급
        if (!best || odds > best.odds) best = { target: t, odds };
      }
      if (best && best.odds >= R.ai.attackOdds) {
        const needFood = Math.ceil(armyTroops / 200) * 12 + 100;
        const armyFood = Math.min(Math.floor(food * 0.7), needFood);
        if (armyFood >= Math.ceil(armyTroops / 200) * 6) {
          const units = scaleUnits(city.units, 0.8);
          cmds.push({
            type: 'attack',
            generals: army.map((g) => g.id),
            to: best.target.id,
            units,
            food: armyFood,
            plan: makeAttackPlan(units, rng),
          });
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
    const monthlyNeed = Math.ceil(troops / R.economy.foodUpkeepDiv);
    const rate = tradeRate(city.commerce, R);
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
    const yearlyFood = food + (state.month <= R.economy.harvestMonth ? harvestAmount(city, R) : 0);
    const foodCap = Math.floor((yearlyFood / 12) * R.economy.foodUpkeepDiv);
    const draftUnit = pickDraftUnit(state, city, enemies, rng);
    if (troops < cap && troops < foodCap && budget > 200 && city.loyalty >= 45) {
      const discount = barracksDiscount(city.facilities.barracks, R);
      const affordable = Math.floor((budget - 100) / 2 / Math.max(0.001, draftCost(draftUnit, 1000, R, discount) / 1000));
      let amount = Math.min(affordable, cap - troops, foodCap - troops, Math.floor(city.population / R.military.draftPopDiv), 3000);
      amount = Math.floor(amount / 100) * 100;
      if (amount >= 100) {
        const g = take((x) => x.cha);
        if (g) {
          cmds.push({ type: 'draft', general: g.id, amount, unit: draftUnit });
          budget -= draftCost(draftUnit, amount, R, discount);
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
          const units = scaleUnits(city.units, 0.6);
          cmds.push({ type: 'transport', general: g.id, to: dest.id, gold: 0, food: Math.floor(food * 0.4), units });
          troops -= sumUnits(units);
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
      const open = fields.filter((k) => city[k] < (k === 'defense' ? R.ai.defenseDevCap : MAX_DEV));
      if (!open.length) break;
      const field = open.reduce((a, b) => (city[a] <= city[b] ? a : b));
      const g = take((x) => (field === 'defense' ? x.pol + x.war : x.pol));
      if (!g) break;
      cmds.push({ type: 'develop', general: g.id, field });
      budget -= DEVELOP_COST;
    }

    // 9-1. 시설 건설 (여유 자금이 있을 때)
    if (avail.length && !city.construction) {
      const order = isFrontier ? (['barracks', 'farm', 'market', 'drillyard'] as const) : (['market', 'farm', 'barracks', 'drillyard'] as const);
      const fac = order.find((f) => city.facilities[f] < R.facility.maxLevel);
      if (fac) {
        const cost = R.facility.cost[fac] * (city.facilities[fac] + 1);
        if (budget >= cost + 300) {
          const g = take((x) => x.pol);
          if (g) {
            cmds.push({ type: 'build', general: g.id, facility: fac });
            budget -= cost;
          }
        }
      }
    }

    // 9-2. 계략 (가끔, 지력이 높은 장수로)
    const enemyTargets = enemies.filter((e) => e.owner);
    if (avail.length && enemyTargets.length && rng.chance(0.15)) {
      const g = [...avail].sort((a, b) => b.int - a.int)[0];
      const tgt = enemyTargets[rng.int(0, enemyTargets.length - 1)];
      const kind = (['rumor', 'incite', 'arson'] as const)[rng.int(0, 2)];
      if (g.int >= 60 && budget >= R.scheme.cost[kind] + 200 && schemeChance(state, kind, g.int, tgt.id) >= 0.4) {
        take((x) => (x.id === g.id ? 1 : 0));
        cmds.push({ type: 'scheme', general: g.id, kind, to: tgt.id });
        budget -= R.scheme.cost[kind];
      }
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
