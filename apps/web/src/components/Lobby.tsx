import { useCallback, useEffect, useState } from 'react';
import { api, connectEvents, setToken, type GameSummary, type ScenarioInfo } from '../api';
import { useApp } from '../store';

const STATUS: Record<GameSummary['status'], string> = { lobby: '대기 중', running: '진행 중', finished: '종료' };

export function formatMinutes(m: number): string {
  if (m % 1440 === 0) return `${m / 1440}일`;
  if (m % 60 === 0) return `${m / 60}시간`;
  return `${m}분`;
}

export function Lobby() {
  const { user, setUser, openGame, openAdmin } = useApp();
  const [games, setGames] = useState<GameSummary[]>([]);
  const [scenarios, setScenarios] = useState<ScenarioInfo[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', scenarioId: 'y190', turnMinutes: 1440, endYear: 220 });

  const refresh = useCallback(() => {
    api.games().then(setGames).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    refresh();
    api.scenarios().then(setScenarios).catch(() => {});
    return connectEvents(null, (e) => e.type === 'lobby' && refresh());
  }, [refresh]);

  const act = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const game = games.find((g) => g.id === selected) ?? null;
  const mySeat = game?.seats.find((s) => s.userId === user!.id);

  return (
    <div className="lobby">
      <header className="topbar">
        <h1 className="title">천하삼분</h1>
        <span className="spacer" />
        <span>{user!.name}</span>
        {user!.isAdmin && (
          <button className="secondary" onClick={() => openAdmin(true)}>
            admin
          </button>
        )}
        <button
          className="secondary"
          onClick={async () => {
            await api.logout().catch(() => {});
            setToken(null);
            setUser(null, null);
          }}
        >
          로그아웃
        </button>
      </header>
      {error && <div className="error">{error}</div>}
      <div className="lobby-grid">
        <section className="card">
          <h2>게임 목록</h2>
          {games.length === 0 && <p className="muted">아직 게임이 없다. 새로 만들어 보라.</p>}
          <ul className="list">
            {games.map((g) => (
              <li key={g.id} className={g.id === selected ? 'active' : ''} onClick={() => setSelected(g.id)}>
                <strong>{g.name}</strong>
                <span className={`badge ${g.status}`}>{STATUS[g.status]}</span>
                <span className="muted">
                  {g.year}년 {g.month}월 · 플레이어 {g.seats.length} · 턴 {formatMinutes(g.turnMinutes)}
                </span>
              </li>
            ))}
          </ul>
          <h2>새 게임</h2>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              act(async () => {
                const g = await api.createGame({ ...form, name: form.name || `${user!.name}의 천하` });
                setSelected(g.id);
              });
            }}
          >
            <label>
              방 이름
              <input value={form.name} placeholder={`${user!.name}의 천하`} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label>
              시나리오
              <select value={form.scenarioId} onChange={(e) => setForm({ ...form, scenarioId: e.target.value })}>
                {scenarios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              턴 마감 시간
              <select value={form.turnMinutes} onChange={(e) => setForm({ ...form, turnMinutes: Number(e.target.value) })}>
                <option value={2}>2분 (실시간 대전)</option>
                <option value={10}>10분</option>
                <option value={60}>1시간</option>
                <option value={720}>12시간</option>
                <option value={1440}>1일</option>
              </select>
            </label>
            <label>
              종료 연도
              <input
                type="number"
                min={191}
                max={400}
                value={form.endYear}
                onChange={(e) => setForm({ ...form, endYear: Number(e.target.value) })}
              />
            </label>
            <button type="submit">만들기</button>
          </form>
        </section>

        <section className="card">
          {!game && <p className="muted">게임을 선택하라.</p>}
          {game && (
            <>
              <h2>
                {game.name} <span className={`badge ${game.status}`}>{STATUS[game.status]}</span>
              </h2>
              <p className="muted">
                {scenarios.find((s) => s.id === game.scenarioId)?.description} · 턴 마감 {formatMinutes(game.turnMinutes)}
              </p>
              <p className="muted">세력을 고르라. 플레이어가 없는 세력은 AI가 운영한다.</p>
              <div className="faction-grid">
                {game.factions.map((f) => {
                  const seat = game.seats.find((s) => s.factionId === f.id);
                  const mine = seat?.userId === user!.id;
                  return (
                    <button
                      key={f.id}
                      className={`faction ${mine ? 'mine' : ''}`}
                      style={{ borderColor: f.color }}
                      disabled={!f.alive || (!!seat && !mine) || game.status === 'finished'}
                      onClick={() => act(() => api.seat(game.id, f.id))}
                    >
                      <span className="swatch" style={{ background: f.color }} />
                      <strong>{f.name}</strong>
                      <span className="muted">{!f.alive ? '멸망' : seat ? seat.userName : 'AI'}</span>
                    </button>
                  );
                })}
              </div>
              <div className="row">
                {mySeat && game.status !== 'finished' && (
                  <button className="secondary" onClick={() => act(() => api.leave(game.id))}>
                    세력 포기
                  </button>
                )}
                {game.status === 'lobby' && game.ownerId === user!.id && (
                  <button disabled={game.seats.length === 0} onClick={() => act(() => api.start(game.id))}>
                    게임 시작
                  </button>
                )}
                <span className="spacer" />
                <button onClick={() => openGame(game.id)}>{game.status === 'lobby' ? '지도 보기' : '입장'}</button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
