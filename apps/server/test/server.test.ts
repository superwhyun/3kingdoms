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

  it('requires auth for mutations', async () => {
    const { app } = await setup();
    expect((await call(app, 'POST', '/api/games', undefined, { name: 'x', scenarioId: 'y190', turnMinutes: 5 })).status).toBe(401);
  });
});
