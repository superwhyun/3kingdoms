import { useMemo, useState } from 'react';
import {
  FACILITY_LABEL,
  FACILITY_TYPES,
  SCHEME_LABEL,
  SCHEME_TYPES,
  TAX_LABEL,
  TAX_LEVELS,
  barracksDiscount,
  UNIT_LABEL,
  UNIT_TYPES,
  draftCost,
  emptyUnits,
  sumUnits,
  tradeRate,
  type Command,
  type GameView,
  type GeneralView,
  type FacilityType,
  type RoundPlan,
  type SchemeType,
  type TaxLevel,
  type UnitType,
  type Units,
} from '@ch/engine';
import { actorsOf } from './describe';
import { PlanEditor, UnitInputs, compactUnits, padPlan, presetPlan } from './PlanEditor';

interface Props {
  view: GameView;
  cityId: string;
  orders: Command[];
  onAdd: (cmd: Command) => void;
  canCommand: boolean;
}

type Action =
  | 'develop' | 'draft' | 'train' | 'trade' | 'search' | 'recruit' | 'move' | 'transport' | 'attack' | 'defense'
  | 'reward' | 'release' | 'build' | 'scheme' | 'tax' | 'governor';

const ACTIONS: { id: Action; label: string }[] = [
  { id: 'develop', label: '개발' },
  { id: 'draft', label: '징병' },
  { id: 'train', label: '훈련' },
  { id: 'trade', label: '거래' },
  { id: 'search', label: '탐색' },
  { id: 'recruit', label: '등용' },
  { id: 'reward', label: '포상' },
  { id: 'move', label: '이동' },
  { id: 'transport', label: '수송' },
  { id: 'build', label: '건설' },
  { id: 'scheme', label: '계략' },
  { id: 'tax', label: '세율' },
  { id: 'governor', label: '태수' },
  { id: 'attack', label: '출진' },
  { id: 'defense', label: '수비 전략' },
  { id: 'release', label: '포로 석방' },
];

const fmt = (n: number | null) => (n === null ? '?' : n.toLocaleString());

function StatLine({ g }: { g: GeneralView }) {
  return (
    <span className="stats">
      무{g.war} 지{g.int} 정{g.pol} 매{g.cha}
      {g.loyalty !== null && <> · 충{g.loyalty}</>}
    </span>
  );
}

export function CityPanel({ view, cityId, orders, onAdd, canCommand }: Props) {
  const city = view.cities.find((c) => c.id === cityId)!;
  const factions = Object.fromEntries(view.factions.map((f) => [f.id, f]));
  const isMine = view.me !== null && city.owner === view.me;
  const here = view.generals.filter((g) => g.city === cityId);
  const mine = here.filter((g) => g.status === 'active' && g.faction === view.me);
  const others = here.filter((g) => !(g.status === 'active' && g.faction === view.me));
  const used = useMemo(() => new Set(orders.flatMap(actorsOf)), [orders]);
  const free = mine.filter((g) => !used.has(g.id));

  const neighbors = view.roads[cityId].map((id) => view.cities.find((c) => c.id === id)!);
  const ownNeighbors = neighbors.filter((c) => c.owner === view.me);
  const hostileNeighbors = neighbors.filter((c) => {
    if (c.owner === view.me) return false;
    if (!c.owner || !view.me) return true;
    const key = c.owner < view.me ? `${c.owner}|${view.me}` : `${view.me}|${c.owner}`;
    return (view.relations[key]?.status ?? 'neutral') === 'neutral';
  });

  const [action, setAction] = useState<Action>('develop');
  const [general, setGeneral] = useState('');
  const [field, setField] = useState<'agriculture' | 'commerce' | 'defense' | 'loyalty'>('agriculture');
  const [amount, setAmount] = useState(1000);
  const [gold, setGold] = useState(100);
  const [food, setFood] = useState(0);
  const [sendUnits, setSendUnits] = useState<Partial<Units>>({});
  const [draftUnit, setDraftUnit] = useState<UnitType>('spear');
  const [attackPlan, setAttackPlan] = useState<RoundPlan[]>(padPlan([]));
  const [defPlan, setDefPlan] = useState<RoundPlan[]>(() =>
    city.defensePlan ? padPlan(city.defensePlan) : presetPlan(city.units ?? emptyUnits(), 'even'),
  );
  const [tradeAction, setTradeAction] = useState<'buy' | 'sell'>('buy');
  const [target, setTarget] = useState('');
  const [to, setTo] = useState('');
  const [army, setArmy] = useState<string[]>([]);
  const [facility, setFacility] = useState<FacilityType>('market');
  const [schemeKind, setSchemeKind] = useState<SchemeType>('rumor');
  const [tax, setTax] = useState<TaxLevel>(city.tax ?? 'normal');
  const [governor, setGovernor] = useState<string>(city.governor ?? '');
  const R = view.rules;
  const MAX_ATTACK_GENERALS = R.battle.maxAttackGenerals;
  const discount = barracksDiscount(city.facilities?.barracks ?? 0, R);

  const gen = free.find((g) => g.id === general) ?? free[0];
  const recruitable = others.filter((g) => g.status === 'free' || (g.status === 'captive' && g.captor === view.me));
  const captives = others.filter((g) => g.status === 'captive' && g.captor === view.me);
  const rulers = new Set(view.factions.map((f) => f.ruler));

  const submit = () => {
    const needGen = !['reward', 'release', 'attack', 'defense', 'tax', 'governor'].includes(action);
    if (needGen && !gen) return;
    const gid = gen?.id ?? '';
    let cmd: Command | null = null;
    switch (action) {
      case 'develop':
        cmd = { type: 'develop', general: gid, field };
        break;
      case 'draft':
        cmd = { type: 'draft', general: gid, amount, unit: draftUnit };
        break;
      case 'train':
        cmd = { type: 'train', general: gid };
        break;
      case 'trade':
        cmd = { type: 'trade', general: gid, action: tradeAction, gold };
        break;
      case 'search':
        cmd = { type: 'search', general: gid };
        break;
      case 'recruit': {
        const t = target || recruitable[0]?.id;
        if (t) cmd = { type: 'recruit', general: gid, target: t };
        break;
      }
      case 'reward': {
        const t = target || mine.find((g) => !rulers.has(g.id))?.id;
        if (t) cmd = { type: 'reward', target: t, gold };
        break;
      }
      case 'release': {
        const t = target || captives[0]?.id;
        if (t) cmd = { type: 'release', target: t };
        break;
      }
      case 'move': {
        const d = to || ownNeighbors[0]?.id;
        if (d) cmd = { type: 'move', general: gid, to: d };
        break;
      }
      case 'transport': {
        const d = to || ownNeighbors[0]?.id;
        if (d) cmd = { type: 'transport', general: gid, to: d, gold, food, units: compactUnits(sendUnits) };
        break;
      }
      case 'attack': {
        const d = to || hostileNeighbors[0]?.id;
        const gens = army.filter((id) => free.some((g) => g.id === id));
        if (d && gens.length) cmd = { type: 'attack', generals: gens, to: d, units: compactUnits(sendUnits), food, plan: attackPlan };
        break;
      }
      case 'defense':
        cmd = { type: 'setDefense', city: cityId, plan: defPlan };
        break;
      case 'build':
        cmd = { type: 'build', general: gid, facility };
        break;
      case 'scheme': {
        const d = to || schemeTargets[0]?.id;
        if (d) cmd = { type: 'scheme', general: gid, kind: schemeKind, to: d, ...(schemeKind === 'sow' && target ? { target } : {}) };
        break;
      }
      case 'tax':
        cmd = { type: 'setTax', city: cityId, tax };
        break;
      case 'governor':
        cmd = { type: 'appoint', city: cityId, general: governor || null };
        break;
    }
    if (cmd) {
      onAdd(cmd);
      setArmy([]);
      setSendUnits({});
    }
  };

  const rate = tradeRate(city.commerce, R);
  const schemeTargets = hostileNeighbors.filter((c) => c.owner);
  const schemeCity = view.cities.find((c) => c.id === (to || schemeTargets[0]?.id));
  const sowTargets = schemeCity ? view.generals.filter((g) => g.city === schemeCity.id && g.status === 'active' && g.faction === schemeCity.owner && !rulers.has(g.id)) : [];
  const owner = city.owner ? factions[city.owner] : null;

  return (
    <div className="panel">
      <h2>
        <span className="swatch" style={{ background: owner?.color ?? '#9a9a8a' }} /> {city.name}{' '}
        <span className="muted">{owner?.name ?? '중립'}</span>
      </h2>
      <table className="kv">
        <tbody>
          <tr>
            <th>인구</th>
            <td>{fmt(city.population)}</td>
            <th>민심</th>
            <td>{city.loyalty}</td>
          </tr>
          <tr>
            <th>농업</th>
            <td>{city.agriculture}</td>
            <th>상업</th>
            <td>{city.commerce}</td>
          </tr>
          <tr>
            <th>성벽</th>
            <td>{city.defense}</td>
            <th>병력</th>
            <td>
              {fmt(city.troops)}
              {city.intel === 'near' && <span className="muted"> (추정)</span>}
            </td>
          </tr>
          {city.units && (
            <tr>
              <td colSpan={4} className="units-line">
                {UNIT_TYPES.filter((t) => city.units![t] > 0).map((t) => (
                  <span key={t} className={`unit-tag u-${t}`}>
                    {UNIT_LABEL[t]} {city.units![t].toLocaleString()}
                  </span>
                ))}
              </td>
            </tr>
          )}
          <tr>
            <th>강</th>
            <td colSpan={3}>
              {city.rivers.length ? city.rivers.map((id) => view.cities.find((c) => c.id === id)?.name).join(', ') : '-'}
            </td>
          </tr>
          <tr>
            <th>금</th>
            <td>{fmt(city.gold)}</td>
            <th>군량</th>
            <td>{fmt(city.food)}</td>
          </tr>
          {city.training !== null && (
            <tr>
              <th>훈련</th>
              <td>{city.training}</td>
              <th>세율</th>
              <td>{city.tax ? TAX_LABEL[city.tax] : '?'}</td>
            </tr>
          )}
          {isMine && (
            <tr>
              <th>태수</th>
              <td colSpan={3}>{city.governor ? view.generals.find((g) => g.id === city.governor)?.name ?? city.governor : '없음'}</td>
            </tr>
          )}
          {city.facilities && (
            <tr>
              <th>시설</th>
              <td colSpan={3}>
                {FACILITY_TYPES.map((f) => `${FACILITY_LABEL[f]} ${city.facilities![f]}`).join(' · ')}
                {city.construction && (
                  <span className="muted">
                    {' '}
                    (건설 중: {FACILITY_LABEL[city.construction.facility]}, {city.construction.monthsLeft}개월 남음)
                  </span>
                )}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {mine.length > 0 && (
        <>
          <h3>아군 장수</h3>
          <ul className="generals">
            {mine.map((g) => (
              <li key={g.id} className={used.has(g.id) ? 'used' : ''}>
                <strong>{g.name}</strong>
                {rulers.has(g.id) && <span className="badge">군주</span>}
                <StatLine g={g} />
                {used.has(g.id) && <span className="muted"> · 명령 있음</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      {others.length > 0 && (
        <>
          <h3>그 밖의 인물</h3>
          <ul className="generals">
            {others.map((g) => (
              <li key={g.id}>
                <strong>{g.name}</strong>{' '}
                <span className="muted">
                  {g.status === 'free' ? '재야' : g.status === 'captive' ? `포로(${factions[g.captor!]?.name})` : factions[g.faction!]?.name}
                </span>{' '}
                <StatLine g={g} />
              </li>
            ))}
          </ul>
        </>
      )}

      {isMine && canCommand && (
        <div className="composer">
          <h3>명령</h3>
          <div className="chips">
            {ACTIONS.map((a) => (
              <button key={a.id} className={`chip ${action === a.id ? 'on' : ''}`} onClick={() => setAction(a.id)}>
                {a.label}
              </button>
            ))}
          </div>

          {!['reward', 'release', 'attack', 'defense', 'tax', 'governor'].includes(action) && (
            <label>
              담당 장수
              <select value={gen?.id ?? ''} onChange={(e) => setGeneral(e.target.value)}>
                {free.length === 0 && <option value="">(행동 가능한 장수 없음)</option>}
                {free.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} (무{g.war} 지{g.int} 정{g.pol} 매{g.cha})
                  </option>
                ))}
              </select>
            </label>
          )}

          {action === 'develop' && (
            <label>
              항목 (금 {R.domestic.developCost})
              <select value={field} onChange={(e) => setField(e.target.value as typeof field)}>
                <option value="agriculture">농업 (정치)</option>
                <option value="commerce">상업 (정치)</option>
                <option value="defense">성벽 (정치·무력)</option>
                <option value="loyalty">민심 (매력)</option>
              </select>
            </label>
          )}
          {action === 'draft' && (
            <>
              <label>
                병종
                <select value={draftUnit} onChange={(e) => setDraftUnit(e.target.value as UnitType)}>
                  {UNIT_TYPES.map((t) => (
                    <option key={t} value={t} disabled={t === 'navy' && city.rivers.length === 0}>
                      {UNIT_LABEL[t]} (1000명당 금 {draftCost(t, 1000, R, discount)}){t === 'navy' && city.rivers.length === 0 ? ' — 강 없음' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                징병 수 (금 {draftCost(draftUnit, amount || 0, R, discount)}, 최대 {Math.floor(city.population / R.military.draftPopDiv).toLocaleString()})
                <input type="number" step={100} min={100} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
              </label>
            </>
          )}
          {action === 'trade' && (
            <>
              <label>
                거래
                <select value={tradeAction} onChange={(e) => setTradeAction(e.target.value as 'buy' | 'sell')}>
                  <option value="buy">군량 매입 (금1 → 군량 {rate.buy.toFixed(1)})</option>
                  <option value="sell">군량 매각 (군량 {rate.sell.toFixed(1)} → 금1)</option>
                </select>
              </label>
              <label>
                금액
                <input type="number" step={10} min={10} value={gold} onChange={(e) => setGold(Number(e.target.value))} />
              </label>
            </>
          )}
          {action === 'recruit' && (
            <label>
              대상
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                {recruitable.length === 0 && <option value="">(이 도시에 등용할 인물 없음 — 탐색해 보라)</option>}
                {recruitable.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} {g.status === 'captive' ? '(포로)' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          {action === 'reward' && (
            <>
              <label>
                대상
                <select value={target} onChange={(e) => setTarget(e.target.value)}>
                  {mine
                    .filter((g) => !rulers.has(g.id))
                    .map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} (충성 {g.loyalty})
                      </option>
                    ))}
                </select>
              </label>
              <label>
                금
                <input type="number" step={10} min={10} value={gold} onChange={(e) => setGold(Number(e.target.value))} />
              </label>
            </>
          )}
          {action === 'release' && (
            <label>
              포로
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                {captives.length === 0 && <option value="">(포로 없음)</option>}
                {captives.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {(action === 'move' || action === 'transport') && (
            <label>
              목적지 (인접 아군 도시)
              <select value={to} onChange={(e) => setTo(e.target.value)}>
                {ownNeighbors.length === 0 && <option value="">(없음)</option>}
                {ownNeighbors.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {action === 'transport' && (
            <div className="row3">
              <label>
                금
                <input type="number" min={0} value={gold} onChange={(e) => setGold(Number(e.target.value))} />
              </label>
              <label>
                군량
                <input type="number" min={0} value={food} onChange={(e) => setFood(Number(e.target.value))} />
              </label>
            </div>
          )}
          {action === 'transport' && <UnitInputs value={sendUnits} onChange={setSendUnits} max={city.units ?? emptyUnits()} />}
          {action === 'attack' && (
            <>
              <label>
                목표 (인접 적·중립 도시)
                <select value={to} onChange={(e) => setTo(e.target.value)}>
                  {hostileNeighbors.length === 0 && <option value="">(공격 가능한 도시 없음)</option>}
                  {hostileNeighbors.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.owner ? factions[c.owner]?.name : '중립'}, 병력 {fmt(c.troops)})
                    </option>
                  ))}
                </select>
              </label>
              <div className="muted">출진 장수 (최대 {MAX_ATTACK_GENERALS}명, 무력 최상위가 지휘)</div>
              <div className="chips">
                {free.map((g) => (
                  <button
                    key={g.id}
                    className={`chip ${army.includes(g.id) ? 'on' : ''}`}
                    onClick={() =>
                      setArmy((a) => (a.includes(g.id) ? a.filter((x) => x !== g.id) : a.length < MAX_ATTACK_GENERALS ? [...a, g.id] : a))
                    }
                  >
                    {g.name} 무{g.war}
                  </button>
                ))}
              </div>
              <div className="muted">출진 병력</div>
              <UnitInputs value={sendUnits} onChange={setSendUnits} max={city.units ?? emptyUnits()} />
              <label>
                군량 (라운드당 출진 병력/200 소모, 10라운드 약 {Math.ceil(sumUnits({ ...emptyUnits(), ...sendUnits }) / 200) * 10})
                <input type="number" min={0} value={food} onChange={(e) => setFood(Number(e.target.value))} />
              </label>
              <h3>10라운드 공격 전략</h3>
              <PlanEditor
                plan={attackPlan}
                onChange={setAttackPlan}
                units={{ ...emptyUnits(), ...sendUnits }}
                generals={free.filter((g) => army.includes(g.id))}
              />
            </>
          )}
          {action === 'defense' && (
            <>
              <p className="muted">
                {city.defensePlan ? `현재 수비 전략: ${city.defensePlan.length}라운드 지정됨` : '현재 수비 전략: 자동 (보유 병종 비율대로 무작위 배치)'}
                . 저장한 전략은 바꿀 때까지 매 전투에 적용된다. 공격측에게 전략을 들키면 전투 리포트에서 다음 공격에 이용당할 수 있다.
              </p>
              <PlanEditor plan={defPlan} onChange={setDefPlan} units={city.units ?? emptyUnits()} generals={mine} defense />
              <div className="row">
                <button className="secondary" onClick={() => setDefPlan(presetPlan(city.units ?? emptyUnits(), 'even'))}>
                  초기화
                </button>
                <button className="secondary" onClick={() => onAdd({ type: 'setDefense', city: cityId, plan: null })}>
                  자동으로 되돌리기
                </button>
              </div>
            </>
          )}
          {action === 'search' && <p className="muted">지력이 높을수록 숨은 인재를 찾기 쉽다.</p>}
          {action === 'build' && (
            <>
              <label>
                시설
                <select value={facility} onChange={(e) => setFacility(e.target.value as FacilityType)}>
                  {FACILITY_TYPES.map((f) => {
                    const lv = city.facilities?.[f] ?? 0;
                    const max = lv >= R.facility.maxLevel;
                    return (
                      <option key={f} value={f} disabled={max}>
                        {FACILITY_LABEL[f]} {lv}→{lv + 1}단계 (금 {R.facility.cost[f] * (lv + 1)}, {R.facility.months[f]}개월){max ? ' — 최고 레벨' : ''}
                      </option>
                    );
                  })}
                </select>
              </label>
              <p className="muted small">
                시장: 수입 +{Math.round(R.facility.perLevel.market * 100)}%/단계 · 농장: 수확 +{Math.round(R.facility.perLevel.farm * 100)}%/단계 · 병영: 징병 비용 −
                {Math.round(R.facility.perLevel.barracks * 100)}%/단계 · 연병장: 훈련 +{R.facility.perLevel.drillyard}/단계. 한 번에 한 시설만 지을 수 있다.
              </p>
              {city.construction && <p className="warn">이미 {FACILITY_LABEL[city.construction.facility]}을(를) 짓고 있다.</p>}
            </>
          )}
          {action === 'scheme' && (
            <>
              <label>
                계략
                <select value={schemeKind} onChange={(e) => setSchemeKind(e.target.value as SchemeType)}>
                  {SCHEME_TYPES.map((k) => (
                    <option key={k} value={k}>
                      {SCHEME_LABEL[k]} (금 {R.scheme.cost[k]}, 기본 {R.scheme.baseChance[k]}%)
                    </option>
                  ))}
                </select>
              </label>
              <label>
                대상 도시 (인접 적 세력)
                <select value={to} onChange={(e) => setTo(e.target.value)}>
                  {schemeTargets.length === 0 && <option value="">(없음)</option>}
                  {schemeTargets.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.owner ? factions[c.owner]?.name : ''})
                    </option>
                  ))}
                </select>
              </label>
              {schemeKind === 'sow' && (
                <label>
                  이간 대상
                  <select value={target} onChange={(e) => setTarget(e.target.value)}>
                    <option value="">자동 (충성도가 가장 낮은 장수)</option>
                    {sowTargets.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <p className="muted small">
                {schemeKind === 'rumor' && `유언비어: 민심 −${R.scheme.rumorLoyalty}. `}
                {schemeKind === 'incite' && `선동: 훈련 −${R.scheme.inciteTraining}, 병력 ${Math.round(R.scheme.inciteDesertion * 100)}% 이탈. `}
                {schemeKind === 'sow' && `이간: 장수 충성 −${R.scheme.sowLoyalty} (충성이 40 미만이면 출분할 수 있다). `}
                {schemeKind === 'arson' && `방화: 군량 −${Math.round(R.scheme.arsonFood * 100)}%, 금 −${Math.round(R.scheme.arsonGold * 100)}%. `}
                성공률은 실행 장수의 지력과 대상 도시 최고 지력의 차이로 정해진다. 실패하면 {R.scheme.discoverChance}% 확률로 발각되어 우호도가 떨어진다.
              </p>
            </>
          )}
          {action === 'tax' && (
            <>
              <label>
                세율 (행동 소모 없음)
                <select value={tax} onChange={(e) => setTax(e.target.value as TaxLevel)}>
                  {TAX_LEVELS.map((t) => (
                    <option key={t} value={t}>
                      {TAX_LABEL[t]} (수입 ×{R.tax.incomeMul[t]}, 민심 {R.tax.loyaltyDelta[t] >= 0 ? '+' : ''}
                      {R.tax.loyaltyDelta[t]}/월)
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {action === 'governor' && (
            <>
              <label>
                태수 (행동 소모 없음)
                <select value={governor} onChange={(e) => setGovernor(e.target.value)}>
                  <option value="">없음 (해임)</option>
                  {mine.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} (정{g.pol} 매{g.cha})
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted small">
                태수는 매달 농업·상업 중 낮은 쪽을 정치/{R.governor.developDiv}만큼 올린다. 매력 {R.governor.loyaltyChaMin} 이상이면 민심 +1. 반란 확률 ×
                {R.governor.rebellionMul}. 태수가 도시를 떠나면 자동 해임된다.
              </p>
            </>
          )}
          {action === 'attack' && attackPlan.every((r) => r.count === 0) && (
            <p className="warn">공격 전략이 비어 있다. 프리셋을 고르거나 라운드별 투입을 입력하라.</p>
          )}
          <button onClick={submit} disabled={action === 'attack' && attackPlan.every((r) => r.count === 0)}>{action === 'defense' ? '수비 전략 저장 (명령 추가)' : '명령 추가'}</button>
        </div>
      )}
    </div>
  );
}
