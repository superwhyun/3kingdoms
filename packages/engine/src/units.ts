import type { GeneralState } from './types';
import { DEFAULT_RULES, type Rules } from './rules';

export const UNIT_TYPES = ['spear', 'cavalry', 'archer', 'navy', 'siege'] as const;
export type UnitType = (typeof UNIT_TYPES)[number];
export type Units = Record<UnitType, number>;

export const UNIT_LABEL: Record<UnitType, string> = {
  spear: '창병',
  cavalry: '기병',
  archer: '궁병',
  navy: '수군',
  siege: '공성',
};

export const BATTLE_ROUNDS = 10;

/** 지형 배율: 강을 끼는 도로인지에 따라 */
export function terrainMul(unit: UnitType, river: boolean, r: Rules = DEFAULT_RULES): number {
  const t = r.battle.terrain;
  if (river) {
    if (unit === 'navy') return t.riverNavy;
    if (unit === 'cavalry') return t.riverCavalry;
    return 1;
  }
  return unit === 'navy' ? t.landNavy : 1;
}

/** 장수 병종 적성 (0~100) */
export function aptitude(g: Pick<GeneralState, 'war' | 'int' | 'pol' | 'cha' | 'apt'> | null, unit: UnitType): number {
  if (!g) return 40;
  let base: number;
  switch (unit) {
    case 'spear':
      base = g.war;
      break;
    case 'cavalry':
      base = g.war * 0.8 + g.cha * 0.2;
      break;
    case 'archer':
      base = g.war * 0.5 + g.int * 0.5;
      break;
    case 'navy':
      base = g.war * 0.5 + g.int * 0.3 + g.pol * 0.2;
      break;
    case 'siege':
      base = g.int * 0.6 + g.pol * 0.4;
      break;
  }
  return Math.max(1, Math.min(100, Math.round(base + (g.apt?.[unit] ?? 0))));
}

export function emptyUnits(): Units {
  return { spear: 0, cavalry: 0, archer: 0, navy: 0, siege: 0 };
}

export function sumUnits(u: Units): number {
  return u.spear + u.cavalry + u.archer + u.navy + u.siege;
}

export function isUnitType(x: unknown): x is UnitType {
  return typeof x === 'string' && (UNIT_TYPES as readonly string[]).includes(x);
}

/** 외부 입력(Partial<Units>)을 검증해 완전한 Units로 만든다. 잘못되면 null */
export function parseUnits(raw: unknown): Units | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = emptyUnits();
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isUnitType(k)) return null;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) return null;
    out[k] = v;
  }
  return out;
}

/** 징병 비용. discount는 병영 할인율(0~1) */
export function draftCost(unit: UnitType, amount: number, r: Rules = DEFAULT_RULES, discount = 0): number {
  return Math.ceil((amount / 10) * r.military.draftCostPer10[unit] * Math.max(0, 1 - discount));
}

/** 병력을 병종 비율대로 차감한다 (탈영·예비대 피해 등). 실제 차감량 반환 */
export function removeProportional(u: Units, amount: number): number {
  const total = sumUnits(u);
  if (total <= 0 || amount <= 0) return 0;
  const take = Math.min(total, Math.floor(amount));
  let removed = 0;
  for (const t of UNIT_TYPES) {
    const r = Math.min(u[t], Math.floor((u[t] / total) * take));
    u[t] -= r;
    removed += r;
  }
  for (const t of UNIT_TYPES) {
    if (removed >= take) break;
    const r = Math.min(u[t], take - removed);
    u[t] -= r;
    removed += r;
  }
  return removed;
}
