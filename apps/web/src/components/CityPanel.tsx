import { useMemo, useState } from 'react';
import { DEVELOP_COST, MAX_ATTACK_GENERALS, tradeRate, type Command, type GameView, type GeneralView } from '@ch/engine';
import { actorsOf } from './describe';

interface Props {
  view: GameView;
  cityId: string;
  orders: Command[];
  onAdd: (cmd: Command) => void;
  canCommand: boolean;
}

type Action = 'develop' | 'draft' | 'train' | 'trade' | 'search' | 'recruit' | 'move' | 'transport' | 'attack' | 'reward' | 'release';

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
  { id: 'attack', label: '출진' },
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
  const [troops, setTroops] = useState(0);
  const [tradeAction, setTradeAction] = useState<'buy' | 'sell'>('buy');
  const [target, setTarget] = useState('');
  const [to, setTo] = useState('');
  const [army, setArmy] = useState<string[]>([]);

  const gen = free.find((g) => g.id === general) ?? free[0];
  const recruitable = others.filter((g) => g.status === 'free' || (g.status === 'captive' && g.captor === view.me));
  const captives = others.filter((g) => g.status === 'captive' && g.captor === view.me);
  const rulers = new Set(view.factions.map((f) => f.ruler));

  const submit = () => {
    const needGen = !['reward', 'release', 'attack'].includes(action);
    if (needGen && !gen) return;
    const gid = gen?.id ?? '';
    let cmd: Command | null = null;
    switch (action) {
      case 'develop':
        cmd = { type: 'develop', general: gid, field };
        break;
      case 'draft':
        cmd = { type: 'draft', general: gid, amount };
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
        if (d) cmd = { type: 'transport', general: gid, to: d, gold, food, troops };
        break;
      }
      case 'attack': {
        const d = to || hostileNeighbors[0]?.id;
        const gens = army.filter((id) => free.some((g) => g.id === id));
        if (d && gens.length) cmd = { type: 'attack', generals: gens, to: d, troops, food };
        break;
      }
    }
    if (cmd) {
      onAdd(cmd);
      setArmy([]);
    }
  };

  const rate = tradeRate(city.commerce);
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
              <th></th>
              <td></td>
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

          {!['reward', 'release', 'attack'].includes(action) && (
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
              항목 (금 {DEVELOP_COST})
              <select value={field} onChange={(e) => setField(e.target.value as typeof field)}>
                <option value="agriculture">농업 (정치)</option>
                <option value="commerce">상업 (정치)</option>
                <option value="defense">성벽 (정치·무력)</option>
                <option value="loyalty">민심 (매력)</option>
              </select>
            </label>
          )}
          {action === 'draft' && (
            <label>
              징병 수 (금 {Math.ceil(amount / 10)}, 최대 {Math.floor(city.population / 20).toLocaleString()})
              <input type="number" step={100} min={100} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
            </label>
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
              <label>
                병사
                <input type="number" min={0} value={troops} onChange={(e) => setTroops(Number(e.target.value))} />
              </label>
            </div>
          )}
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
              <div className="row3">
                <label>
                  병력 (보유 {fmt(city.troops)})
                  <input type="number" min={1} value={troops} onChange={(e) => setTroops(Number(e.target.value))} />
                </label>
                <label>
                  군량 (라운드당 병력/200)
                  <input type="number" min={0} value={food} onChange={(e) => setFood(Number(e.target.value))} />
                </label>
              </div>
            </>
          )}
          {action === 'search' && <p className="muted">지력이 높을수록 숨은 인재를 찾기 쉽다.</p>}
          <button onClick={submit}>명령 추가</button>
        </div>
      )}
    </div>
  );
}
