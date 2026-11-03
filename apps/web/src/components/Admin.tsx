import { useCallback, useEffect, useMemo, useState } from 'react';
import { FACILITY_LABEL, SCHEME_LABEL, TAX_LABEL, UNIT_LABEL, diffRules, type Rules } from '@ch/engine';

/** 하위 키(병종·시설·계략·세율) 이름 */
const KEY_LABEL: Record<string, string> = { ...UNIT_LABEL, ...FACILITY_LABEL, ...SCHEME_LABEL, ...TAX_LABEL };
import { api, type AdminUser, type GameSummary } from '../api';
import { useApp } from '../store';

type Tab = 'defaults' | 'game' | 'users';

type Tree = { [k: string]: number | Tree };

function getAt(obj: unknown, path: string[]): unknown {
  return path.reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

function setAt<T>(obj: T, path: string[], value: number): T {
  const out = structuredClone(obj) as Record<string, unknown>;
  let cur = out;
  for (const k of path.slice(0, -1)) cur = cur[k] as Record<string, unknown>;
  cur[path[path.length - 1]] = value;
  return out as T;
}

/** 규칙 트리 편집기. base와 다른 값은 강조하고, 항목별로 base 값으로 되돌릴 수 있다 */
function RulesEditor({
  value,
  base,
  defaults,
  labels,
  onChange,
}: {
  value: Rules;
  base: Rules;
  defaults: Rules;
  labels: Record<string, string>;
  onChange: (r: Rules) => void;
}) {
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const render = (node: Tree, path: string[]): React.ReactNode =>
    Object.entries(node).map(([k, v]) => {
      const p = [...path, k];
      const key = p.join('.');
      const label = labels[key] ?? KEY_LABEL[k] ?? k;
      if (typeof v === 'object') {
        const isTop = path.length === 0;
        const shown = isTop ? (open[key] ?? false) || !!filter : true;
        const changed = Object.keys(diffRules(getAt(base, p), v)).length > 0;
        return (
          <div key={key} className={isTop ? 'rule-group' : 'rule-sub'}>
            {isTop ? (
              <button className="rule-head" onClick={() => setOpen({ ...open, [key]: !shown })}>
                {shown ? '▾' : '▸'} {label} {changed && <span className="badge changed">변경</span>}
              </button>
            ) : (
              <div className="rule-subhead">{label}</div>
            )}
            {shown && <div className="rule-body">{render(v, p)}</div>}
          </div>
        );
      }
      if (filter && !`${key} ${label}`.toLowerCase().includes(filter.toLowerCase())) return null;
      const baseV = getAt(base, p) as number;
      const defV = getAt(defaults, p) as number;
      const changed = v !== baseV;
      return (
        <div key={key} className={`rule-row ${changed ? 'changed' : ''}`}>
          <span className="rule-label" title={key}>
            {label}
          </span>
          <input
            type="number"
            step="any"
            min={0}
            value={v}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n >= 0) onChange(setAt(value, p, n));
            }}
          />
          <span className="muted small rule-hint">
            {changed ? `원래 ${baseV}` : ''}
            {defV !== baseV && !changed ? `기본 ${defV}` : ''}
          </span>
          {changed && (
            <button className="link" onClick={() => onChange(setAt(value, p, baseV))}>
              되돌리기
            </button>
          )}
        </div>
      );
    });

  return (
    <div className="rules-editor">
      <input placeholder="항목 검색" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {render(value as unknown as Tree, [])}
    </div>
  );
}

export function Admin() {
  const { user, openAdmin } = useApp();
  const [tab, setTab] = useState<Tab>('defaults');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setError('');
    setNotice('');
    try {
      await fn();
      setNotice(ok);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="lobby">
      <header className="topbar">
        <button className="secondary" onClick={() => openAdmin(false)}>
          ← 로비
        </button>
        <h1 className="title small">관리자</h1>
        <span className="spacer" />
        <span>{user!.name}</span>
      </header>
      <nav className="tabs admin-tabs">
        {(
          [
            ['defaults', '기본 규칙'],
            ['game', '게임별 규칙'],
            ['users', '사용자'],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button key={id} className={`tab ${tab === id ? 'on' : ''}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>
      <div className="admin-body">
        {error && <div className="error">{error}</div>}
        {notice && <div className="ok">{notice}</div>}
        {tab === 'defaults' && <DefaultsTab act={act} />}
        {tab === 'game' && <GameTab act={act} />}
        {tab === 'users' && <UsersTab act={act} />}
      </div>
    </div>
  );
}

type Act = (fn: () => Promise<unknown>, ok: string) => Promise<void>;

function DefaultsTab({ act }: { act: Act }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.admin.rules>> | null>(null);
  const [draft, setDraft] = useState<Rules | null>(null);
  const load = useCallback(() => {
    api.admin.rules().then((r) => {
      setData(r);
      setDraft(r.effective);
    });
  }, []);
  useEffect(load, [load]);
  const dirty = useMemo(() => (data && draft ? Object.keys(diffRules(data.effective, draft)).length > 0 : false), [data, draft]);
  if (!data || !draft) return <p className="muted">불러오는 중…</p>;
  const overrideCount = JSON.stringify(data.overrides).match(/:\s*-?\d/g)?.length ?? 0;
  return (
    <section className="card">
      <p className="muted">
        새로 만드는 게임에 적용되는 규칙이다. 이미 만들어진 게임은 영향을 받지 않는다(게임별 규칙 탭에서 따로 수정). 현재 기본값에서 바뀐 항목: {overrideCount}개.
      </p>
      <div className="row">
        <button disabled={!dirty} onClick={() => act(async () => { await api.admin.saveRules(diffRules(data.defaults, draft)); load(); }, '기본 규칙을 저장했다.')}>
          저장
        </button>
        <button className="secondary" disabled={!dirty} onClick={() => setDraft(data.effective)}>
          편집 취소
        </button>
        <span className="spacer" />
        <button
          className="secondary"
          onClick={() => {
            if (confirm('모든 항목을 엔진 기본값으로 되돌릴까?')) act(async () => { await api.admin.saveRules({}); load(); }, '엔진 기본값으로 되돌렸다.');
          }}
        >
          전체 초기화
        </button>
      </div>
      <RulesEditor value={draft} base={data.effective} defaults={data.defaults} labels={data.labels} onChange={setDraft} />
    </section>
  );
}

function GameTab({ act }: { act: Act }) {
  const [games, setGames] = useState<GameSummary[]>([]);
  const [id, setId] = useState<number | null>(null);
  const [data, setData] = useState<Awaited<ReturnType<typeof api.admin.gameRules>> | null>(null);
  const [defaults, setDefaults] = useState<Rules | null>(null);
  const [draft, setDraft] = useState<Rules | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.games().then((g) => {
      setGames(g);
      setId((cur) => cur ?? g.find((x) => x.status !== 'finished')?.id ?? g[0]?.id ?? null);
    });
    api.admin.rules().then((r) => setDefaults(r.defaults));
  }, []);
  const load = useCallback(() => {
    if (id === null) return;
    setError('');
    api.admin
      .gameRules(id)
      .then((r) => {
        setData(r);
        setDraft(r.rules);
      })
      .catch((e) => {
        setData(null);
        setDraft(null);
        setError(e.message);
      });
  }, [id]);
  useEffect(load, [load]);
  const game = games.find((g) => g.id === id);
  const dirty = data && draft ? Object.keys(diffRules(data.rules, draft)).length > 0 : false;

  return (
    <section className="card">
      <label>
        게임
        <select value={id ?? ''} onChange={(e) => setId(Number(e.target.value))}>
          {games.map((g) => (
            <option key={g.id} value={g.id}>
              #{g.id} {g.name} ({g.status === 'lobby' ? '대기' : g.status === 'running' ? `진행 ${g.year}년 ${g.month}월` : '종료'})
            </option>
          ))}
        </select>
      </label>
      {error && <div className="error">{error}</div>}
      {game && data && draft && defaults && (
        <>
          <p className="muted">변경 사항은 이 게임의 다음 턴 해결부터 적용된다. 강조 표시는 현재 게임 값과 다른 항목이다.</p>
          <div className="row">
            <button
              disabled={!dirty || game.status === 'finished'}
              onClick={() => act(async () => { await api.admin.patchGameRules(game.id, diffRules(data.rules, draft)); load(); }, `#${game.id} 규칙을 저장했다.`)}
            >
              저장
            </button>
            <button className="secondary" disabled={!dirty} onClick={() => setDraft(data.rules)}>
              편집 취소
            </button>
            <span className="spacer" />
            {game.status === 'running' && (
              <button
                className="secondary"
                onClick={() => {
                  if (confirm('지금 이 턴을 강제로 해결할까? 명령을 내지 않은 플레이어는 AI가 대신한다.'))
                    act(() => api.admin.resolve(game.id), '턴을 강제로 해결했다.');
                }}
              >
                턴 강제 해결
              </button>
            )}
          </div>
          <RulesEditor value={draft} base={data.rules} defaults={defaults} labels={data.labels} onChange={setDraft} />
        </>
      )}
    </section>
  );
}

function UsersTab({ act }: { act: Act }) {
  const { user } = useApp();
  const [users, setUsers] = useState<AdminUser[]>([]);
  useEffect(() => {
    api.admin.users().then(setUsers);
  }, []);
  return (
    <section className="card">
      <table className="rel">
        <thead>
          <tr>
            <th>#</th>
            <th>이름</th>
            <th>가입</th>
            <th>admin</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.id}</td>
              <td>
                {u.name} {u.id === user!.id && <span className="muted">(나)</span>}
              </td>
              <td className="muted">{new Date(u.createdAt).toLocaleDateString()}</td>
              <td>
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={u.isAdmin}
                    onChange={(e) =>
                      act(async () => setUsers(await api.admin.setAdmin(u.id, e.target.checked)), `${u.name}: admin ${e.target.checked ? '부여' : '해제'}`)
                    }
                  />
                </label>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
