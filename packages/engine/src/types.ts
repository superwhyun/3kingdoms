import type { UnitType, Units } from './units';

export type { UnitType, Units } from './units';

export type FactionId = string;
export type CityId = string;
export type GeneralId = string;

export interface CityState {
  id: CityId;
  name: string;
  x: number;
  y: number;
  owner: FactionId | null;
  population: number;
  agriculture: number;
  commerce: number;
  defense: number;
  /** 민심 0-100 */
  loyalty: number;
  gold: number;
  food: number;
  /** 병종별 병력 */
  units: Units;
  /** 훈련도 0-100 (도시 공용) */
  training: number;
  /** 상시 수비 전략 (null이면 자동) */
  defensePlan: RoundPlan[] | null;
}

/** 전투 1라운드 배치 계획 */
export interface RoundPlan {
  /** 지휘 장수. null이면 해당 병종 적성이 가장 높은 장수 */
  general: GeneralId | null;
  unit: UnitType;
  count: number;
}

export interface BattleSide {
  general: GeneralId | null;
  unit: UnitType;
  count: number;
  loss: number;
}

export interface BattleRound {
  round: number;
  att: BattleSide | null;
  def: BattleSide | null;
  /** 수비 예비대가 입은 피해 (수비 대기 라운드 또는 압도당한 라운드) */
  reserveLoss: number;
  /** 공격 예비대가 입은 피해 (공격측이 압도당한 라운드) */
  attReserveLoss: number;
  wallDamage: number;
  attRemaining: number;
  defRemaining: number;
}

export type BattleOutcome = 'captured' | 'withdrawn' | 'starved' | 'annihilated';

export interface BattleReport {
  turn: number;
  city: CityId;
  attacker: FactionId;
  defender: FactionId | null;
  river: boolean;
  attackerGenerals: GeneralId[];
  defenderGenerals: GeneralId[];
  attackerStart: Units;
  defenderStart: Units;
  attackerEnd: Units;
  defenderEnd: Units;
  attackerPlan: RoundPlan[];
  defenderPlan: RoundPlan[];
  /** 수비측이 자동 계획을 썼는지 */
  defenderAuto: boolean;
  wallStart: number;
  wallEnd: number;
  rounds: BattleRound[];
  outcome: BattleOutcome;
}

export type GeneralStatus = 'active' | 'free' | 'hidden' | 'captive';

export interface GeneralState {
  id: GeneralId;
  name: string;
  war: number;
  int: number;
  pol: number;
  cha: number;
  /** active일 때 소속 세력 */
  faction: FactionId | null;
  city: CityId;
  status: GeneralStatus;
  /** 충성도 0-100 (active일 때만 의미) */
  loyalty: number;
  /** captive일 때 억류한 세력 */
  captor: FactionId | null;
  /** captive일 때 포로가 되기 전 소속 */
  formerFaction: FactionId | null;
  /** 병종 적성 보정 */
  apt?: Partial<Record<UnitType, number>>;
}

export interface FactionState {
  id: FactionId;
  name: string;
  color: string;
  ruler: GeneralId;
  alive: boolean;
}

export type RelationStatus = 'neutral' | 'alliance' | 'truce';

export interface Relation {
  status: RelationStatus;
  /** 우호도 0-100 */
  friendship: number;
  /** truce일 때 만료 턴 (이 턴 해결 후 해제) */
  truceUntil: number | null;
}

export type ProposalKind = 'alliance' | 'truce';

export interface Proposal {
  id: number;
  from: FactionId;
  to: FactionId;
  kind: ProposalKind;
  /** 제안이 생성된 턴 */
  turn: number;
}

export type LogKind = 'domestic' | 'military' | 'diplomacy' | 'economy' | 'personnel' | 'system';

export interface LogEntry {
  turn: number;
  year: number;
  month: number;
  kind: LogKind;
  text: string;
  /** 볼 수 있는 세력. 빈 배열이면 전체 공개 */
  visibleTo: FactionId[];
  city?: CityId;
}

export interface GameState {
  version: 2;
  scenarioId: string;
  year: number;
  month: number;
  /** 0부터 시작하는 진행 턴 번호 */
  turn: number;
  endYear: number;
  rng: number;
  cities: Record<CityId, CityState>;
  generals: Record<GeneralId, GeneralState>;
  factions: Record<FactionId, FactionState>;
  roads: Record<CityId, CityId[]>;
  /** 강을 끼는 도로 */
  rivers: Record<CityId, CityId[]>;
  relations: Record<string, Relation>;
  proposals: Proposal[];
  nextProposalId: number;
  /** 직전 턴 해결 시 발생한 로그 */
  log: LogEntry[];
  /** 직전 턴의 전투 상세 */
  battles: BattleReport[];
  finished: boolean;
  winner: FactionId | null;
}

export type DevelopField = 'agriculture' | 'commerce' | 'defense' | 'loyalty';

export type Command =
  | { type: 'develop'; general: GeneralId; field: DevelopField }
  | { type: 'draft'; general: GeneralId; amount: number; unit: UnitType }
  | { type: 'train'; general: GeneralId }
  | { type: 'trade'; general: GeneralId; action: 'buy' | 'sell'; gold: number }
  | { type: 'search'; general: GeneralId }
  | { type: 'recruit'; general: GeneralId; target: GeneralId }
  | { type: 'reward'; target: GeneralId; gold: number }
  | { type: 'release'; target: GeneralId }
  | { type: 'move'; general: GeneralId; to: CityId }
  | { type: 'transport'; general: GeneralId; to: CityId; gold: number; food: number; units: Partial<Units> }
  | { type: 'attack'; generals: GeneralId[]; to: CityId; units: Partial<Units>; food: number; plan: RoundPlan[] }
  | { type: 'setDefense'; city: CityId; plan: RoundPlan[] | null }
  | { type: 'propose'; to: FactionId; kind: ProposalKind }
  | { type: 'respond'; proposal: number; accept: boolean }
  | { type: 'break'; to: FactionId }
  | { type: 'tribute'; from: CityId; to: FactionId; gold: number };

export type CommandType = Command['type'];

export type Orders = Record<FactionId, Command[]>;
