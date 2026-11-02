import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Command } from '@ch/engine';
import { api, connectEvents, type ChatMessage, type StateResponse } from '../api';
import { useApp } from '../store';
import { MapView } from './MapView';
import { CityPanel } from './CityPanel';
import { describe } from './describe';
import { formatMinutes } from './Lobby';

type Tab = 'city' | 'orders' | 'diplomacy' | 'log' | 'chat';

function useCountdown(deadline: number | null): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!deadline) return '-';
  const s = Math.max(0, Math.floor((deadline - now) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}시간 ${m}분` : `${m}분 ${sec}초`;
}

export function GameScreen({ gameId }: { gameId: number }) {
  const { user, openGame } = useApp();
  const [data, setData] = useState<StateResponse | null>(null);
  const [orders, setOrders] = useState<Command[]>([]);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [saved, setSaved] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('city');
  const [error, setError] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newTurn, setNewTurn] = useState(false);
  const turnRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.state(gameId);
      setData(r);
      if (turnRef.current !== r.view.turn) {
        if (turnRef.current !== null) setNewTurn(true);
        turnRef.current = r.view.turn;
        setOrders(r.orders);
        setErrors({});
        setSaved(true);
      }
      setSelected((s) => s ?? r.view.cities.find((c) => c.owner === r.view.me)?.id ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [gameId]);

  const loadMessages = useCallback(() => {
    api.messages(gameId).then(setMessages).catch(() => {});
  }, [gameId]);

  useEffect(() => {
    load();
    loadMessages();
    return connectEvents(gameId, (e) => {
      if (e.type === 'chat') loadMessages();
      else load();
    });
  }, [gameId, load, loadMessages]);

  const save = useCallback(
    async (next: Command[]) => {
      if (!data) return;
      setOrders(next);
      setSaved(false);
      try {
        await api.orders(gameId, data.view.turn, next);
        setErrors({});
        setSaved(true);
      } catch (e) {
        const body = (e as { body?: { errors?: { index: number; message: string }[] } }).body;
        if (body?.errors) setErrors(Object.fromEntries(body.errors.map((x) => [x.index, x.message])));
        else setError((e as Error).message);
      }
    },
    [data, gameId],
  );

  const countdown = useCountdown(data?.game.deadline ?? null);
  const highlight = useMemo(() => new Set<string>(), []);

  if (!data) return <div className="center muted">{error || '불러오는 중…'}</div>;
  const { view, game } = data;
  const me = view.me;
  const myFaction = view.factions.find((f) => f.id === me);
  const mySeat = game.seats.find((s) => s.userId === user!.id);
  const canCommand = game.status === 'running' && !!myFaction?.alive;
  const winner = view.factions.find((f) => f.id === view.winner);
  const hasErrors = Object.keys(errors).length > 0;

  return (
    <div className="game">
      <header className="topbar">
        <button className="secondary" onClick={() => openGame(null)}>
          ← 로비
        </button>
        <h1 className="title small">{game.name}</h1>
        <span className="date">
          {view.year}년 {view.month}월
        </span>
        {myFaction && (
          <span className="me">
            <span className="swatch" style={{ background: myFaction.color }} />
            {myFaction.name} {!myFaction.alive && '(멸망)'}
          </span>
        )}
        <span className="spacer" />
        {game.status === 'running' && (
          <>
            <span className="muted">
              마감까지 {countdown} (턴 주기 {formatMinutes(game.turnMinutes)})
            </span>
            <span className="seats">
              {game.seats.map((s) => (
                <span key={s.factionId} className={`seat ${s.ready ? 'ready' : ''}`} title={s.ready ? '턴 종료함' : '명령 입력 중'}>
                  {s.userName}
                </span>
              ))}
            </span>
            {mySeat && canCommand && (
              <button
                className={mySeat.ready ? 'secondary' : ''}
                disabled={!saved || hasErrors}
                onClick={() => api.ready(gameId, view.turn, !mySeat.ready).then(load).catch((e) => setError(e.message))}
              >
                {mySeat.ready ? '턴 종료 취소' : '턴 종료'}
              </button>
            )}
          </>
        )}
        {game.status === 'lobby' && <span className="muted">방장이 게임을 시작하기를 기다리는 중</span>}
        {game.status === 'finished' && <span className="badge finished">종료 — 승자: {winner?.name ?? '없음'}</span>}
      </header>
      {error && (
        <div className="error" onClick={() => setError('')}>
          {error}
        </div>
      )}
      {newTurn && (
        <div className="notice" onClick={() => { setNewTurn(false); setTab('log'); }}>
          새 달이 되었다. 지난달 기록을 확인하라 →
        </div>
      )}
      <div className="game-grid">
        <div className="map-wrap">
          <MapView view={view} selected={selected} onSelect={(id) => { setSelected(id); setTab('city'); }} highlight={highlight} />
          <div className="legend">
            {view.factions
              .filter((f) => f.alive)
              .map((f) => (
                <span key={f.id}>
                  <span className="swatch" style={{ background: f.color }} />
                  {f.name} {f.cities}
                </span>
              ))}
          </div>
        </div>
        <aside className="side">
          <nav className="tabs">
            {(
              [
                ['city', '도시'],
                ['orders', `명령 (${orders.length})`],
                ['diplomacy', `외교${view.proposals.some((p) => p.to === me) ? ' •' : ''}`],
                ['log', '기록'],
                ['chat', '대화'],
              ] as [Tab, string][]
            ).map(([id, label]) => (
              <button key={id} className={`tab ${tab === id ? 'on' : ''}`} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </nav>
          {tab === 'city' && selected && (
            <CityPanel
              key={selected}
              view={view}
              cityId={selected}
              orders={orders}
              canCommand={canCommand && !mySeat?.ready}
              onAdd={(cmd) => save([...orders, cmd])}
            />
          )}
          {tab === 'orders' && (
            <div className="panel">
              <h2>이번 달 명령</h2>
              <p className="muted">
                {saved ? (hasErrors ? '오류가 있는 명령이 있어 저장되지 않았다.' : '저장됨') : '저장 중…'} 명령은 턴 종료 시 모든
                세력이 동시에 실행한다. 외교 → 내정 → 이동·수송 → 출진 순.
              </p>
              {orders.length === 0 && <p className="muted">명령이 없다. 지도에서 아군 도시를 선택하라.</p>}
              <ol className="orders">
                {orders.map((c, i) => (
                  <li key={i} className={errors[i] ? 'bad' : ''}>
                    <span>{describe(c, view)}</span>
                    {errors[i] && <div className="error-inline">{errors[i]}</div>}
                    {canCommand && !mySeat?.ready && (
                      <button className="link" onClick={() => save(orders.filter((_, j) => j !== i))}>
                        삭제
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}
          {tab === 'diplomacy' && (
            <Diplomacy
              data={data}
              orders={orders}
              canCommand={canCommand && !mySeat?.ready}
              onAdd={(cmd) => save([...orders, cmd])}
            />
          )}
          {tab === 'log' && (
            <div className="panel">
              <h2>지난달 기록</h2>
              {view.log.length === 0 && <p className="muted">기록이 없다.</p>}
              <ul className="log">
                {view.log.map((l, i) => (
                  <li key={i} className={`log-${l.kind}`} onClick={() => l.city && setSelected(l.city)}>
                    {l.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {tab === 'chat' && <Chat gameId={gameId} data={data} messages={messages} onSent={loadMessages} />}
        </aside>
      </div>
    </div>
  );
}

function Diplomacy({
  data,
  orders,
  canCommand,
  onAdd,
}: {
  data: StateResponse;
  orders: Command[];
  canCommand: boolean;
  onAdd: (c: Command) => void;
}) {
  const { view, game } = data;
  const me = view.me;
  const [gold, setGold] = useState(200);
  const myCities = view.cities.filter((c) => c.owner === me);
  const [from, setFrom] = useState(myCities[0]?.id ?? '');
  const name = (id: string) => view.factions.find((f) => f.id === id)?.name ?? id;
  const answered = new Set(orders.filter((o) => o.type === 'respond').map((o) => (o as { proposal: number }).proposal));

  if (!me) return <div className="panel muted">관전 중이다.</div>;
  return (
    <div className="panel">
      <h2>받은 제안</h2>
      {view.proposals.filter((p) => p.to === me).length === 0 && <p className="muted">없음</p>}
      <ul className="list plain">
        {view.proposals
          .filter((p) => p.to === me)
          .map((p) => (
            <li key={p.id}>
              {name(p.from)}: {p.kind === 'alliance' ? '동맹' : '정전(12개월)'} 제안
              {canCommand && !answered.has(p.id) && (
                <>
                  <button onClick={() => onAdd({ type: 'respond', proposal: p.id, accept: true })}>수락</button>
                  <button className="secondary" onClick={() => onAdd({ type: 'respond', proposal: p.id, accept: false })}>
                    거절
                  </button>
                </>
              )}
              {answered.has(p.id) && <span className="muted"> (응답 예약됨)</span>}
            </li>
          ))}
      </ul>
      <h2>세력 관계</h2>
      <label>
        공물 보낼 도시 / 금액
        <div className="row">
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            {myCities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} (금 {c.gold})
              </option>
            ))}
          </select>
          <input type="number" min={50} step={50} value={gold} onChange={(e) => setGold(Number(e.target.value))} />
        </div>
      </label>
      <table className="rel">
        <thead>
          <tr>
            <th>세력</th>
            <th>플레이어</th>
            <th>관계</th>
            <th>우호</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {view.factions
            .filter((f) => f.alive && f.id !== me)
            .map((f) => {
              const key = f.id < me ? `${f.id}|${me}` : `${me}|${f.id}`;
              const rel = view.relations[key] ?? { status: 'neutral', friendship: 30, truceUntil: null };
              const seat = game.seats.find((s) => s.factionId === f.id);
              const pending = view.proposals.some((p) => p.from === me && p.to === f.id);
              return (
                <tr key={f.id}>
                  <td>
                    <span className="swatch" style={{ background: f.color }} /> {f.name} ({f.cities})
                  </td>
                  <td>{seat ? seat.userName : 'AI'}</td>
                  <td>
                    {rel.status === 'alliance' ? '동맹' : rel.status === 'truce' ? `정전(~${(rel.truceUntil ?? 0) - view.turn}개월)` : '-'}
                  </td>
                  <td>{rel.friendship}</td>
                  <td className="actions">
                    {canCommand && (
                      <>
                        {rel.status === 'neutral' && !pending && (
                          <>
                            <button className="link" onClick={() => onAdd({ type: 'propose', to: f.id, kind: 'alliance' })}>
                              동맹
                            </button>
                            <button className="link" onClick={() => onAdd({ type: 'propose', to: f.id, kind: 'truce' })}>
                              정전
                            </button>
                          </>
                        )}
                        {rel.status === 'truce' && !pending && (
                          <button className="link" onClick={() => onAdd({ type: 'propose', to: f.id, kind: 'alliance' })}>
                            동맹
                          </button>
                        )}
                        {rel.status !== 'neutral' && (
                          <button className="link danger" onClick={() => onAdd({ type: 'break', to: f.id })}>
                            파기
                          </button>
                        )}
                        {from && (
                          <button className="link" onClick={() => onAdd({ type: 'tribute', from, to: f.id, gold })}>
                            공물
                          </button>
                        )}
                      </>
                    )}
                    {pending && <span className="muted">제안 대기</span>}
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}

function Chat({
  gameId,
  data,
  messages,
  onSent,
}: {
  gameId: number;
  data: StateResponse;
  messages: ChatMessage[];
  onSent: () => void;
}) {
  const [text, setText] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const name = (id: string | null) => (id ? data.view.factions.find((f) => f.id === id)?.name ?? id : '관전');
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  return (
    <div className="panel chat">
      <ul className="messages">
        {messages.map((m) => (
          <li key={m.id} className={m.toFaction ? 'whisper' : ''}>
            <span className="who">
              {m.userName}({name(m.fromFaction)}){m.toFaction && ` → ${name(m.toFaction)}`}
            </span>{' '}
            {m.text}
          </li>
        ))}
        <div ref={endRef} />
      </ul>
      {error && <div className="error">{error}</div>}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          api
            .post(gameId, text, to || null)
            .then(() => {
              setText('');
              setError('');
              onSent();
            })
            .catch((err) => setError(err.message));
        }}
      >
        <select value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">전체</option>
          {data.game.seats
            .filter((s) => s.factionId !== data.view.me)
            .map((s) => (
              <option key={s.factionId} value={s.factionId}>
                귓속말: {name(s.factionId)}
              </option>
            ))}
        </select>
        <input value={text} maxLength={500} onChange={(e) => setText(e.target.value)} placeholder="메시지" />
        <button type="submit">보내기</button>
      </form>
    </div>
  );
}
