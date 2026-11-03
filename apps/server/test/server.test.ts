import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';

let clock = 1_000_000;
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

async function setup() {
  clock = 1_000_000;
  const a = await buildApp({ dbPath: ':memory:', now: () => clock });
  apps.push(a);
  return a;
}

afterEach(async () => {
  while (apps.length) await apps.pop()!.app.close();
});

type Inject = Awaited<ReturnType<typeof buildApp>>['app'];
async function call(app: Inject, method: string, url: string, token?: string, body?: unknown) {
  const res = await app.inject({
    method: method as 'GET',
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(body !== undefined ? { payload: body as object } : {}),
  });
  return { status: res.statusCode, body: res.json() };
}

describe('server', () => {
  it('two players play a turn end to end', async () => {
    const { app } = await setup();
    const a = await call(app, 'POST', '/api/register', undefined, { name: '조조팬', password: 'secret1' });
    const b = await call(app, 'POST', '/api/register', undefined, { name: 'liubeifan', password: 'secret2' });
    expect(a.status).toBe(200);
    const ta = a.body.token as string;
    const tb = b.body.token as string;

    expect((await call(app, 'POST', '/api/register', undefined, { name: '조조팬', password: 'xxxxxx' })).status).toBe(401);
    expect((await call(app, 'POST', '/api/login', undefined, { name: '조조팬', password: 'wrong!!' })).status).toBe(401);

    const g = await call(app, 'POST', '/api/games', ta, { name: '테스트', scenarioId: 'y190', turnMinutes: 60 });
    expect(g.status).toBe(200);
    const id = g.body.id;
    expect((await call(app, 'POST', `/api/games/${id}/seat`, ta, { factionId: 'caocao' })).status).toBe(200);
    expect((await call(app, 'POST', `/api/games/${id}/seat`, tb, { factionId: 'caocao' })).status).toBe(409);
    expect((await call(app, 'POST', `/api/games/${id}/seat`, tb, { factionId: 'liubei' })).status).toBe(200);
    expect((await call(app, 'POST', `/api/games/${id}/start`, tb)).status).toBe(403);
    expect((await call(app, 'POST', `/api/games/${id}/start`, ta)).status).toBe(200);

    // 남의 장수 명령 → 422
    const bad = await call(app, 'PUT', `/api/games/${id}/orders`, ta, { turn: 0, commands: [{ type: 'train', general: 'guan_yu' }] });
    expect(bad.status).toBe(422);

    const ok = await call(app, 'PUT', `/api/games/${id}/orders`, ta, {
      turn: 0,
      commands: [{ type: 'develop', general: 'xun_yu', field: 'commerce' }],
    });
    expect(ok.status).toBe(200);

    const st = await call(app, 'GET', `/api/games/${id}/state`, ta);
    expect(st.body.view.me).toBe('caocao');
    expect(st.body.orders.length).toBe(1);
    const enemyCity = st.body.view.cities.find((c: { id: string }) => c.id === 'pingyuan');
    expect(enemyCity.gold).toBeNull();

    await call(app, 'POST', `/api/games/${id}/ready`, ta, { turn: 0, ready: true });
    let s = await call(app, 'GET', `/api/games/${id}`, ta);
    expect(s.body.turn).toBe(0);
    await call(app, 'POST', `/api/games/${id}/ready`, tb, { turn: 0, ready: true });
    s = await call(app, 'GET', `/api/games/${id}`, ta);
    expect(s.body.turn).toBe(1);
    expect(s.body.month).toBe(2);
    expect(s.body.seats.every((x: { ready: boolean }) => !x.ready)).toBe(true);

    const after = await call(app, 'GET', `/api/games/${id}/state`, ta);
    expect(after.body.view.log.some((l: { text: string }) => l.text.includes('순욱'))).toBe(true);
    const otherView = await call(app, 'GET', `/api/games/${id}/state`, tb);
    expect(otherView.body.view.log.some((l: { text: string }) => l.text.includes('순욱'))).toBe(false);

    // 지난 턴 명령 거부
    expect((await call(app, 'PUT', `/api/games/${id}/orders`, ta, { turn: 0, commands: [] })).status).toBe(409);
  });

  it('resolves by deadline with AI substitution', async () => {
    const { app, games } = await setup();
    const a = await call(app, 'POST', '/api/register', undefined, { name: 'solo', password: 'secret1' });
    const t = a.body.token;
    const g = await call(app, 'POST', '/api/games', t, { name: 'solo', scenarioId: 'y190', turnMinutes: 10 });
    await call(app, 'POST', `/api/games/${g.body.id}/seat`, t, { factionId: 'sunjian' });
    await call(app, 'POST', `/api/games/${g.body.id}/start`, t);
    expect(games.tick()).toBe(0);
    clock += 10 * 60_000;
    expect(games.tick()).toBe(1);
    const s = await call(app, 'GET', `/api/games/${g.body.id}`, t);
    expect(s.body.turn).toBe(1);
    expect(s.body.deadline).toBe(clock + 10 * 60_000);
  });

  it('chat: public and whisper visibility', async () => {
    const { app } = await setup();
    const [a, b, c] = await Promise.all(
      ['aaa', 'bbb', 'ccc'].map((n) => call(app, 'POST', '/api/register', undefined, { name: n, password: 'secret1' })),
    );
    const g = await call(app, 'POST', '/api/games', a.body.token, { name: 'chat', scenarioId: 'y190', turnMinutes: 60 });
    const id = g.body.id;
    await call(app, 'POST', `/api/games/${id}/seat`, a.body.token, { factionId: 'caocao' });
    await call(app, 'POST', `/api/games/${id}/seat`, b.body.token, { factionId: 'liubei' });
    await call(app, 'POST', `/api/games/${id}/seat`, c.body.token, { factionId: 'sunjian' });
    await call(app, 'POST', `/api/games/${id}/messages`, a.body.token, { text: '모두 안녕' });
    await call(app, 'POST', `/api/games/${id}/messages`, a.body.token, { text: '유비만 보라', to: 'liubei' });
    const mb = await call(app, 'GET', `/api/games/${id}/messages`, b.body.token);
    const mc = await call(app, 'GET', `/api/games/${id}/messages`, c.body.token);
    expect(mb.body.length).toBe(2);
    expect(mc.body.length).toBe(1);
  });

  it('defense plan + attack: battle report visible only to the two parties', async () => {
    const { app } = await setup();
    const [a, b, c] = await Promise.all(
      ['atk', 'dfn', 'obs'].map((n) => call(app, 'POST', '/api/register', undefined, { name: n, password: 'secret1' })),
    );
    const g = await call(app, 'POST', '/api/games', a.body.token, { name: 'war', scenarioId: 'y190', turnMinutes: 60 });
    const id = g.body.id;
    await call(app, 'POST', `/api/games/${id}/seat`, a.body.token, { factionId: 'yuanshao' });
    await call(app, 'POST', `/api/games/${id}/seat`, b.body.token, { factionId: 'liubei' });
    await call(app, 'POST', `/api/games/${id}/seat`, c.body.token, { factionId: 'sunjian' });
    await call(app, 'POST', `/api/games/${id}/start`, a.body.token);

    const defPlan = [{ general: 'guan_yu', unit: 'spear', count: 2000 }];
    expect(
      (await call(app, 'PUT', `/api/games/${id}/orders`, b.body.token, { turn: 0, commands: [{ type: 'setDefense', city: 'pingyuan', plan: defPlan }] })).status,
    ).toBe(200);
    const atk = {
      type: 'attack',
      generals: ['yan_liang'],
      to: 'pingyuan',
      units: { spear: 2000 },
      food: 1000,
      plan: [{ general: null, unit: 'spear', count: 1000 }],
    };
    expect((await call(app, 'PUT', `/api/games/${id}/orders`, a.body.token, { turn: 0, commands: [atk] })).status).toBe(200);
    for (const t of [a, b, c]) await call(app, 'POST', `/api/games/${id}/ready`, t.body.token, { turn: 0, ready: true });

    const va = (await call(app, 'GET', `/api/games/${id}/state`, a.body.token)).body.view;
    const vb = (await call(app, 'GET', `/api/games/${id}/state`, b.body.token)).body.view;
    const vc = (await call(app, 'GET', `/api/games/${id}/state`, c.body.token)).body.view;
    expect(va.turn).toBe(1);
    expect(va.battles).toHaveLength(1);
    expect(va.battles[0].defenderPlan[0]).toEqual(defPlan[0]);
    expect(vb.battles).toHaveLength(1);
    expect(vc.battles).toHaveLength(0);
    // 수비 계획은 본인에게만
    expect(vb.cities.find((x: { id: string }) => x.id === 'pingyuan').defensePlan).toHaveLength(1);
    expect(va.cities.find((x: { id: string }) => x.id === 'pingyuan').defensePlan).toBeNull();
  });

  it('admin: first user is admin, can grant admin, edit default and per-game rules', async () => {
    const { app } = await setup();
    const a = await call(app, 'POST', '/api/register', undefined, { name: 'boss', password: 'secret1' });
    const b = await call(app, 'POST', '/api/register', undefined, { name: 'pleb', password: 'secret1' });
    expect(a.body.user.isAdmin).toBe(true);
    expect(b.body.user.isAdmin).toBe(false);
    const ta = a.body.token;
    const tb = b.body.token;

    expect((await call(app, 'GET', '/api/admin/rules', tb)).status).toBe(403);
    expect((await call(app, 'PUT', '/api/admin/rules', ta, { overrides: { battle: { nope: 1 } } })).status).toBe(400);
    const put = await call(app, 'PUT', '/api/admin/rules', ta, { overrides: { battle: { k: 0.4, siegeWallMul: 5 } } });
    expect(put.status).toBe(200);
    // 기본값과 같은 항목은 저장되지 않는다
    expect(put.body.overrides).toEqual({ battle: { k: 0.4 } });

    // 새 게임은 그 시점의 기본 규칙을 복사한다
    const g = await call(app, 'POST', '/api/games', tb, { name: 'r', scenarioId: 'y190', turnMinutes: 60 });
    const st = await call(app, 'GET', `/api/games/${g.body.id}/state`, tb);
    expect(st.body.view.rules.battle.k).toBe(0.4);
    await call(app, 'PUT', '/api/admin/rules', ta, { overrides: {} });
    const st2 = await call(app, 'GET', `/api/games/${g.body.id}/state`, tb);
    expect(st2.body.view.rules.battle.k).toBe(0.4);

    // 게임별 규칙 수정
    expect((await call(app, 'PATCH', `/api/admin/games/${g.body.id}/rules`, tb, { patch: { battle: { k: 0.3 } } })).status).toBe(403);
    const gp = await call(app, 'PATCH', `/api/admin/games/${g.body.id}/rules`, ta, { patch: { economy: { incomeDiv: 1 } } });
    expect(gp.status).toBe(200);
    expect(gp.body.rules.economy.incomeDiv).toBe(1);
    expect(gp.body.rules.battle.k).toBe(0.4);

    // 권한 부여·해제
    const users = await call(app, 'POST', `/api/admin/users/${b.body.user.id}`, ta, { isAdmin: true });
    expect(users.body.find((u: { name: string }) => u.name === 'pleb').isAdmin).toBe(true);
    expect((await call(app, 'GET', '/api/admin/users', tb)).status).toBe(200);
    expect((await call(app, 'POST', `/api/admin/users/${b.body.user.id}`, tb, { isAdmin: false })).status).toBe(200);
    expect((await call(app, 'POST', `/api/admin/users/${a.body.user.id}`, ta, { isAdmin: false })).status).toBe(400);
    expect((await call(app, 'GET', '/api/me', ta)).body.user.isAdmin).toBe(true);
  });

  it('admin can force-resolve a running game', async () => {
    const { app } = await setup();
    const a = await call(app, 'POST', '/api/register', undefined, { name: 'boss', password: 'secret1' });
    const g = await call(app, 'POST', '/api/games', a.body.token, { name: 'f', scenarioId: 'y190', turnMinutes: 600 });
    await call(app, 'POST', `/api/games/${g.body.id}/seat`, a.body.token, { factionId: 'caocao' });
    await call(app, 'POST', `/api/games/${g.body.id}/start`, a.body.token);
    const r = await call(app, 'POST', `/api/admin/games/${g.body.id}/resolve`, a.body.token);
    expect(r.body.turn).toBe(1);
  });

  it('requires auth for mutations', async () => {
    const { app } = await setup();
    expect((await call(app, 'POST', '/api/games', undefined, { name: 'x', scenarioId: 'y190', turnMinutes: 5 })).status).toBe(401);
  });
});
