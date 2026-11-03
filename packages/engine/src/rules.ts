/**
 * 게임 규칙 조정값. 게임 생성 시 상태(GameState.rules)에 복사되어 그 게임에 고정된다.
 * admin은 전역 기본값(새 게임에 적용)과 게임별 값(다음 턴부터 적용)을 바꿀 수 있다.
 * 모든 값은 숫자이며, 구조는 이 기본값이 기준이다.
 */

export const FACILITY_TYPES = ['market', 'farm', 'barracks', 'drillyard'] as const;
export type FacilityType = (typeof FACILITY_TYPES)[number];

export const SCHEME_TYPES = ['rumor', 'incite', 'sow', 'arson'] as const;
export type SchemeType = (typeof SCHEME_TYPES)[number];

export const TAX_LEVELS = ['low', 'normal', 'high'] as const;
export type TaxLevel = (typeof TAX_LEVELS)[number];

export const DEFAULT_RULES = {
  battle: {
    /** 교전 손실 계수 K */
    k: 0.25,
    /** 수비가 빈 라운드에 예비대가 입는 피해 비율 (공격 전투력 대비) */
    emptyRoundReserveRate: 0.04,
    /** 성벽 피해 = 공격 전투력 / 이 값 */
    wallDamageDiv: 100,
    /** 공성 병종의 성벽 피해 배율 */
    siegeWallMul: 5,
    /** 수비 투입분 전멸 후 남은 피해 1명당 성벽 피해 */
    wallPerExcessTroop: 1,
    /** 성벽 보너스 = 1 + 성벽 / 이 값 */
    wallBonusDiv: 1500,
    /** 라운드당 군량 소모 = 출진 병력 / 이 값 */
    foodPerRoundDiv: 200,
    /** 최대 출진 장수 수 */
    maxAttackGenerals: 5,
    /** 상성 배율 [내 병종][상대 병종] */
    matchup: {
      spear: { spear: 1, cavalry: 1.5, archer: 0.7, navy: 1, siege: 1.3 },
      cavalry: { spear: 0.7, cavalry: 1, archer: 1.5, navy: 1.1, siege: 1.5 },
      archer: { spear: 1.5, cavalry: 0.7, archer: 1, navy: 1.2, siege: 1.2 },
      navy: { spear: 1, cavalry: 1, archer: 1, navy: 1, siege: 1 },
      siege: { spear: 0.5, cavalry: 0.5, archer: 0.5, navy: 0.5, siege: 0.5 },
    },
    /** 지형 배율 */
    terrain: { riverNavy: 1.6, riverCavalry: 0.7, landNavy: 0.6 },
  },
  military: {
    /** 징병 비용: 10명당 금 */
    draftCostPer10: { spear: 1, cavalry: 3, archer: 1.5, navy: 2, siege: 4 },
    minDraft: 100,
    /** 징병 상한 = 인구 / 이 값 */
    draftPopDiv: 20,
    /** 신병 훈련도 */
    recruitTraining: 20,
    /** 훈련 기본 상승량 (+ 무력/10 + 0~3) */
    trainBase: 3,
  },
  domestic: {
    developCost: 50,
    maxDev: 999,
    /** 개발 상승량 = 능력치 / 이 값 + 0~6 */
    developStatDiv: 5,
    /** 민심 상승량 = 매력 / 이 값 + 0~3 */
    loyaltyStatDiv: 12,
  },
  economy: {
    /** 월 수입 = 상업 × 민심계수 × 인구계수 / 이 값 */
    incomeDiv: 2,
    /** 수확 = 농업 × 민심계수 × 인구계수 × 이 값 */
    harvestMul: 12,
    harvestMonth: 7,
    /** 월 군량 소비 = 병력 / 이 값 */
    foodUpkeepDiv: 60,
    /** 월 급료(금) = 병력 / 이 값 */
    goldUpkeepDiv: 250,
    /** 군량 부족 시 탈영 비율 */
    desertionRate: 0.15,
    maxPopulation: 1_500_000,
    /** 인구 증감 = 인구 × (민심 − 기준) / 이 값 */
    popGrowthDiv: 20000,
    popGrowthPivot: 40,
    /** 중립 도시 수비병 월 회복 / 상한 */
    neutralRegen: 50,
    neutralCap: 3000,
    /** 군량 거래 시세 (상업 0 → 999 사이 선형) */
    tradeBuyMin: 6,
    tradeBuyMax: 10,
    tradeSellMin: 10,
    tradeSellMax: 14,
  },
  tax: {
    /** 세율별 수입 배율 */
    incomeMul: { low: 0.7, normal: 1, high: 1.4 },
    /** 세율별 월 민심 변화 */
    loyaltyDelta: { low: 1, normal: 0, high: -2 },
  },
  governor: {
    /** 태수 자동 개발량 = 정치 / 이 값 (매달, 가장 낮은 농업/상업) */
    developDiv: 25,
    /** 태수 매력이 이 값 이상이면 월 민심 +1 */
    loyaltyChaMin: 70,
    /** 태수가 있으면 반란 확률 배율 */
    rebellionMul: 0.5,
  },
  facility: {
    maxLevel: 3,
    /** 건설 비용 (레벨당 배수 적용: 비용 × 다음 레벨) */
    cost: { market: 300, farm: 300, barracks: 400, drillyard: 400 },
    /** 건설 기간 (개월) */
    months: { market: 3, farm: 3, barracks: 4, drillyard: 4 },
    /** 레벨당 효과: 시장=수입, 농장=수확, 병영=징병 비용 할인, 연병장=훈련 상승량 */
    perLevel: { market: 0.15, farm: 0.15, barracks: 0.1, drillyard: 2 },
  },
  scheme: {
    cost: { rumor: 100, incite: 150, sow: 120, arson: 150 },
    /** 기본 성공률 (%) + (내 지력 − 상대 최고 지력) × skillMul */
    baseChance: { rumor: 55, incite: 45, sow: 45, arson: 40 },
    skillMul: 0.8,
    /** 실패 시 발각 확률 (%) */
    discoverChance: 50,
    /** 발각 시 우호도 하락 */
    discoverFriendship: 10,
    rumorLoyalty: 15,
    inciteTraining: 15,
    inciteDesertion: 0.05,
    sowLoyalty: 20,
    arsonFood: 0.25,
    arsonGold: 0.1,
  },
  events: {
    /** 확률은 % 단위, 도시마다 매달 판정 */
    bumperChance: 5,
    bumperMul: 1.5,
    droughtChance: 6,
    droughtMul: 0.5,
    plagueChance: 1.5,
    plagueRate: 0.05,
    floodChance: 4,
    floodRate: 0.1,
    /** 반란: 민심이 기준 미만이면 (기준 − 민심)/기준 × 이 값 % */
    rebellionChance: 15,
    rebellionLoyalty: 40,
    /** 반란군 규모 = 인구 / 이 값 */
    rebelPopDiv: 150,
  },
  diplomacy: {
    /** 제안 유효 기간 (턴) */
    proposalTtl: 3,
    truceMonths: 12,
    breakFriendship: 40,
  },
  ai: {
    graceTurns: 3,
    attackChance: 0.7,
    attackOdds: 1.5,
    defenseDevCap: 600,
  },
};

export type Rules = typeof DEFAULT_RULES;

/** 규칙 덮어쓰기: Rules의 부분 집합 */
export type RulesPatch = { [K in keyof Rules]?: DeepPartial<Rules[K]> };
type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/** 기본값 구조를 기준으로 patch를 검증한다. 오류 메시지 또는 null */
export function validateRulesPatch(patch: unknown, shape: unknown = DEFAULT_RULES, path = ''): string | null {
  if (!isObj(patch)) return `${path || '규칙'}: 객체여야 한다`;
  if (!isObj(shape)) return `${path}: 잘못된 경로`;
  for (const [k, v] of Object.entries(patch)) {
    const p = path ? `${path}.${k}` : k;
    if (!(k in shape)) return `${p}: 알 수 없는 항목`;
    const s = shape[k];
    if (isObj(s)) {
      const err = validateRulesPatch(v, s, p);
      if (err) return err;
    } else {
      if (typeof v !== 'number' || !Number.isFinite(v)) return `${p}: 숫자여야 한다`;
      if (v < 0 || v > 1e8) return `${p}: 0 이상 1억 이하`;
    }
  }
  return null;
}

/** base에 patch를 깊은 병합한 새 규칙 (patch는 검증된 것으로 가정) */
export function applyRulesPatch<T>(base: T, patch: unknown): T {
  const out = structuredClone(base) as Record<string, unknown>;
  if (!isObj(patch)) return out as T;
  for (const [k, v] of Object.entries(patch)) {
    if (isObj(v) && isObj(out[k])) out[k] = applyRulesPatch(out[k], v);
    else if (typeof v === 'number') out[k] = v;
  }
  return out as T;
}

/** 기본값과 다른 항목만 추린 patch */
export function diffRules(base: unknown, value: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!isObj(base) || !isObj(value)) return out;
  for (const [k, v] of Object.entries(value)) {
    if (isObj(v)) {
      const d = diffRules(base[k], v);
      if (Object.keys(d).length) out[k] = d;
    } else if (v !== base[k]) out[k] = v;
  }
  return out;
}

/** 이전 버전 상태 등 일부 항목이 빠진 규칙을 기본값으로 채운다 */
export function completeRules(r: unknown): Rules {
  return applyRulesPatch(DEFAULT_RULES, r);
}

/** admin 화면용 항목 이름 */
export const RULE_LABELS: Record<string, string> = {
  battle: '전투',
  'battle.k': '교전 손실 계수 K',
  'battle.emptyRoundReserveRate': '수비 대기 라운드 예비대 피해 비율',
  'battle.wallDamageDiv': '성벽 피해 제수 (전투력/값)',
  'battle.siegeWallMul': '공성 성벽 피해 배율',
  'battle.wallPerExcessTroop': '남은 피해 1명당 성벽 피해',
  'battle.wallBonusDiv': '성벽 방어 보너스 제수',
  'battle.foodPerRoundDiv': '라운드당 군량 소모 제수',
  'battle.maxAttackGenerals': '최대 출진 장수',
  'battle.matchup': '병종 상성 [공격 병종][상대 병종]',
  'battle.terrain': '지형 배율',
  'battle.terrain.riverNavy': '강: 수군',
  'battle.terrain.riverCavalry': '강: 기병',
  'battle.terrain.landNavy': '육로: 수군',
  military: '군사',
  'military.draftCostPer10': '징병 비용 (10명당 금)',
  'military.minDraft': '최소 징병 수',
  'military.draftPopDiv': '징병 상한 제수 (인구/값)',
  'military.recruitTraining': '신병 훈련도',
  'military.trainBase': '훈련 기본 상승량',
  domestic: '내정',
  'domestic.developCost': '개발 비용',
  'domestic.maxDev': '개발 최대치',
  'domestic.developStatDiv': '개발 상승 제수',
  'domestic.loyaltyStatDiv': '민심 상승 제수',
  economy: '경제',
  'economy.incomeDiv': '수입 제수',
  'economy.harvestMul': '수확 배율',
  'economy.harvestMonth': '수확 월',
  'economy.foodUpkeepDiv': '군량 소비 제수 (병력/값)',
  'economy.goldUpkeepDiv': '급료 제수 (병력/값)',
  'economy.desertionRate': '군량 부족 탈영 비율',
  'economy.maxPopulation': '최대 인구',
  'economy.popGrowthDiv': '인구 증감 제수',
  'economy.popGrowthPivot': '인구 증감 기준 민심',
  'economy.neutralRegen': '중립 도시 월 수비병 회복',
  'economy.neutralCap': '중립 도시 수비병 회복 상한',
  'economy.tradeBuyMin': '군량 매입: 상업 0일 때 금1당 군량',
  'economy.tradeBuyMax': '군량 매입: 상업 999일 때 금1당 군량',
  'economy.tradeSellMin': '군량 매각: 상업 999일 때 금1당 군량',
  'economy.tradeSellMax': '군량 매각: 상업 0일 때 금1당 군량',
  tax: '세율',
  'tax.incomeMul': '세율별 수입 배율',
  'tax.loyaltyDelta': '세율별 월 민심 변화',
  governor: '태수',
  'governor.developDiv': '태수 자동 개발 제수 (정치/값)',
  'governor.loyaltyChaMin': '민심 +1 최소 매력',
  'governor.rebellionMul': '태수 있을 때 반란 확률 배율',
  facility: '시설',
  'facility.maxLevel': '최대 레벨',
  'facility.cost': '건설 비용 (× 다음 레벨)',
  'facility.months': '건설 기간 (개월)',
  'facility.perLevel': '레벨당 효과',
  scheme: '계략',
  'scheme.cost': '비용',
  'scheme.baseChance': '기본 성공률 (%)',
  'scheme.skillMul': '지력 차 보정 배율',
  'scheme.discoverChance': '실패 시 발각 확률 (%)',
  'scheme.discoverFriendship': '발각 시 우호도 하락',
  'scheme.rumorLoyalty': '유언비어: 민심 하락',
  'scheme.inciteTraining': '선동: 훈련도 하락',
  'scheme.inciteDesertion': '선동: 병력 이탈 비율',
  'scheme.sowLoyalty': '이간: 충성도 하락',
  'scheme.arsonFood': '방화: 군량 손실 비율',
  'scheme.arsonGold': '방화: 금 손실 비율',
  events: '이벤트',
  'events.bumperChance': '풍작 확률 (%)',
  'events.bumperMul': '풍작 수확 배율',
  'events.droughtChance': '흉년 확률 (%)',
  'events.droughtMul': '흉년 수확 배율',
  'events.plagueChance': '역병 확률 (%)',
  'events.plagueRate': '역병 인구·병력 손실 비율',
  'events.floodChance': '홍수 확률 (%, 강 도시 6~8월)',
  'events.floodRate': '홍수 농업·성벽 손실 비율',
  'events.rebellionChance': '반란 최대 확률 (%)',
  'events.rebellionLoyalty': '반란 기준 민심',
  'events.rebelPopDiv': '반란군 규모 제수 (인구/값)',
  diplomacy: '외교',
  'diplomacy.proposalTtl': '제안 유효 턴',
  'diplomacy.truceMonths': '정전 기간 (개월)',
  'diplomacy.breakFriendship': '협정 파기 시 우호 하락',
  ai: 'AI',
  'ai.graceTurns': '공격 유예 턴',
  'ai.attackChance': '공격 시도 확률',
  'ai.attackOdds': '공격 최소 전력비',
  'ai.defenseDevCap': '성벽 개발 상한',
};
