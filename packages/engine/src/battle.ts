import type { Rng } from './rng';
import type { CityState, FactionId, GameState, GeneralState } from './types';
import { citiesOf, clamp, factionName, generalsIn, isAdjacent, josa, pushLog } from './util';
import { handleFactionLoss } from './succession';

export interface Army {
  faction: FactionId;
  origin: string;
  generals: GeneralState[];
  troops: number;
  food: number;
  training: number;
}

interface Side {
  troops: number;
  training: number;
  war: number;
  int: number;
  support: number;
}

const NEUTRAL_LEADER = { war: 40, int: 40 };

export function sidePower(s: Side, defenseBonus = 1): number {
  const trainingMul = 0.6 + s.training / 250;
  const leaderMul = 1 + (s.war * 0.7 + s.int * 0.3 - 50) / 100;
  const supportMul = 1 + 0.02 * Math.min(4, s.support);
  return s.troops * trainingMul * leaderMul * supportMul * defenseBonus;
}

function leaderOf(generals: GeneralState[]): { war: number; int: number; support: number } {
  if (generals.length === 0) return { ...NEUTRAL_LEADER, support: 0 };
  return {
    war: Math.max(...generals.map((g) => g.war)),
    int: Math.max(...generals.map((g) => g.int)),
    support: generals.length - 1,
  };
}

export function defenseMultiplier(city: CityState): number {
  return 1 + city.defense / 1500;
}

/** 공격측 추정 전투력 / 수비측 추정 전투력 (AI·UI 참고용) */
export function estimateOdds(state: GameState, army: Omit<Army, 'origin' | 'food'>, target: CityState): number {
  const a = leaderOf(army.generals);
  const defGenerals = target.owner ? generalsIn(state, target.id, target.owner) : [];
  const d = leaderOf(defGenerals);
  const ap = sidePower({ troops: army.troops, training: army.training, ...a });
  const dp = sidePower({ troops: target.troops, training: target.training, ...d }, defenseMultiplier(target));
  return dp <= 0 ? Infinity : ap / dp;
}

/** 공격 실행. 출진 도시에서 병력·군량은 이미 차감된 상태로 호출된다. */
export function resolveBattle(state: GameState, army: Army, targetId: string, rng: Rng): void {
  const target = state.cities[targetId];
  const attackerName = factionName(state, army.faction);
  const leaderName = army.generals[0]?.name ?? '?';

  // 이미 아군 도시가 된 경우(같은 턴의 다른 공격으로 점령): 합류
  if (target.owner === army.faction) {
    mergeArmyInto(state, army, target);
    pushLog(state, 'military', `${josa(leaderName, '이', '가')} 이끄는 부대가 ${target.name}에 합류했다.`, [army.faction], target.id);
    return;
  }

  const defenderFaction = target.owner;
  const defenderName = factionName(state, defenderFaction);
  const defGenerals = defenderFaction ? generalsIn(state, target.id, defenderFaction) : [];
  const a = leaderOf(army.generals);
  const d = leaderOf(defGenerals);
  const initialAtk = army.troops;
  const initialDef = target.troops;
  let atk = army.troops;
  let def = target.troops;
  let food = army.food;
  let outcome: 'captured' | 'repelled' | 'stalemate' | 'starved' = 'stalemate';

  if (def <= 0) {
    outcome = 'captured';
  } else {
    for (let round = 0; round < 12; round++) {
      const need = Math.ceil(atk / 200);
      if (food < need) {
        outcome = 'starved';
        break;
      }
      food -= need;
      const ap = sidePower({ troops: atk, training: army.training, ...a });
      const dp = sidePower({ troops: def, training: target.training, ...d }, defenseMultiplier(target));
      const toDef = Math.round(ap * 0.06 * rng.range(0.85, 1.15));
      const toAtk = Math.round(dp * 0.06 * rng.range(0.85, 1.15));
      def = Math.max(0, def - toDef);
      atk = Math.max(0, atk - toAtk);
      target.defense = Math.max(0, target.defense - rng.int(10, 25));
      if (def <= 0 && atk > 0) {
        outcome = 'captured';
        break;
      }
      if (atk < initialAtk * 0.25 || atk <= 0) {
        outcome = 'repelled';
        break;
      }
    }
  }

  const lossA = initialAtk - atk;
  const lossD = initialDef - def;
  target.troops = def;

  if (outcome === 'captured') {
    captureCity(state, army, target, atk, food, defGenerals, rng);
    pushLog(
      state,
      'military',
      `${attackerName}군 ${josa(leaderName, '이', '가')} ${defenderName}의 ${josa(target.name, '을', '를')} 함락했다. (공격측 손실 ${lossA}, 수비측 손실 ${lossD})`,
      [],
      target.id,
    );
    if (defenderFaction) handleFactionLoss(state, defenderFaction, rng);
    return;
  }

  const reason =
    outcome === 'starved' ? '군량이 떨어져 퇴각했다' : outcome === 'repelled' ? '격퇴당했다' : '함락하지 못하고 철수했다';
  pushLog(
    state,
    'military',
    `${attackerName}군 ${josa(leaderName, '이', '가')} ${defenderName}의 ${target.name} 공략에 나섰으나 ${reason}. (공격측 손실 ${lossA}, 수비측 손실 ${lossD})`,
    [],
    target.id,
  );
  retreat(state, { ...army, troops: atk, food }, target, rng);
}

function mergeArmyInto(state: GameState, army: Army, city: CityState): void {
  const total = city.troops + army.troops;
  city.training = total > 0 ? Math.round((city.troops * city.training + army.troops * army.training) / total) : city.training;
  city.troops = total;
  city.food += army.food;
  for (const g of army.generals) state.generals[g.id].city = city.id;
}

function retreat(state: GameState, army: Army, from: CityState, rng: Rng): void {
  const origin = state.cities[army.origin];
  let home: CityState | undefined = origin.owner === army.faction ? origin : undefined;
  if (!home) {
    home = citiesOf(state, army.faction).find((c) => isAdjacent(state, c.id, from.id));
  }
  if (home) {
    mergeArmyInto(state, army, home);
    return;
  }
  // 돌아갈 곳이 없다: 부대 와해
  for (const g of army.generals) {
    const gs = state.generals[g.id];
    if (state.factions[army.faction].ruler === g.id) {
      gs.city = from.id;
      continue;
    }
    gs.status = 'free';
    gs.faction = null;
    gs.city = from.id;
  }
  pushLog(state, 'military', `${factionName(state, army.faction)}군은 돌아갈 곳을 잃고 와해되었다.`, [], from.id);
  void rng;
}

function captureCity(
  state: GameState,
  army: Army,
  city: CityState,
  troops: number,
  food: number,
  defenders: GeneralState[],
  rng: Rng,
): void {
  const prevOwner = city.owner;
  city.owner = army.faction;
  city.troops = troops;
  city.training = army.training;
  city.food = Math.floor(city.food * 0.5) + food;
  city.gold = Math.floor(city.gold * 0.5);
  city.loyalty = clamp(city.loyalty - 10, 0, 100);
  for (const g of army.generals) state.generals[g.id].city = city.id;

  // 수비 장수: 탈출 또는 포로
  for (const g of defenders) {
    const gs = state.generals[g.id];
    const escapeTo = prevOwner
      ? citiesOf(state, prevOwner).find((c) => isAdjacent(state, c.id, city.id))
      : undefined;
    if (escapeTo && rng.chance(0.3 + gs.war / 250)) {
      gs.city = escapeTo.id;
      pushLog(state, 'military', `${josa(gs.name, '은', '는')} ${escapeTo.name}(으)로 탈출했다.`, [], city.id);
    } else {
      gs.status = 'captive';
      gs.formerFaction = gs.faction;
      gs.faction = null;
      gs.captor = army.faction;
      pushLog(state, 'military', `${josa(gs.name, '이', '가')} ${factionName(state, army.faction)}군에 사로잡혔다.`, [], city.id);
    }
  }

  // 이 도시에 억류되어 있던 포로 처리
  for (const g of Object.values(state.generals)) {
    if (g.status !== 'captive' || g.city !== city.id || g.captor === army.faction) continue;
    if (g.formerFaction === army.faction && state.factions[army.faction].alive) {
      g.status = 'active';
      g.faction = army.faction;
      g.captor = null;
      g.formerFaction = null;
      pushLog(state, 'personnel', `${josa(g.name, '이', '가')} 구출되어 복귀했다.`, [army.faction], city.id);
    } else {
      g.status = 'free';
      g.captor = null;
      g.formerFaction = null;
    }
  }
}
