import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { listScenarios } from '@ch/data';
import type { Command } from '@ch/engine';
import { AuthError, login, logout, register, userByToken, type User } from './auth';
import { openDb } from './db';
import { GameError, GameService, type GameEvent } from './games';

export interface AppOptions {
  dbPath: string;
  now?: () => number;
  /** 빌드된 웹 클라이언트 경로 (있으면 정적 서빙) */
  webDist?: string;
  logger?: boolean;
}

const Credentials = z.object({
  name: z.string().trim().min(2).max(20).regex(/^[\p{L}\p{N}_-]+$/u, '이름에는 문자·숫자·_-만 쓸 수 있다'),
  password: z.string().min(6).max(100),
});
const CreateGame = z.object({
  name: z.string().trim().min(1).max(40),
  scenarioId: z.string(),
  /** 턴 마감 시간(분). 1분 ~ 7일 */
  turnMinutes: z.number().int().min(1).max(7 * 24 * 60),
  endYear: z.number().int().min(190).max(400).optional(),
});
const Seat = z.object({ factionId: z.string() });
const Orders = z.object({ turn: z.number().int().min(0), commands: z.array(z.any()).max(200) });
const Ready = z.object({ turn: z.number().int().min(0), ready: z.boolean() });
const Message = z.object({ text: z.string().trim().min(1).max(500), to: z.string().nullable().optional() });
const IdParam = z.object({ id: z.coerce.number().int().positive() });

function bearer(req: FastifyRequest): string | undefined {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : undefined;
}

export async function buildApp(opts: AppOptions) {
  const db = openDb(opts.dbPath);
  const games = new GameService(db, opts.now);
  const app = Fastify({ logger: opts.logger ?? false });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof z.ZodError) return reply.status(400).send({ error: err.issues.map((i) => i.message).join(', ') });
    if (err instanceof GameError) return reply.status(err.status).send({ error: err.message });
    if (err instanceof AuthError) return reply.status(401).send({ error: err.message });
    app.log.error(err);
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    return reply.status(status).send({ error: status === 500 ? '서버 오류' : (err as Error).message });
  });

  const optionalUser = (req: FastifyRequest): User | null => userByToken(db, bearer(req));
  const requireUser = (req: FastifyRequest, reply: FastifyReply): User => {
    const u = optionalUser(req);
    if (!u) {
      reply.status(401);
      throw new AuthError('로그인이 필요하다');
    }
    return u;
  };

  // ── 인증 ──
  app.post('/api/register', async (req) => {
    const { name, password } = Credentials.parse(req.body);
    return register(db, name, password);
  });
  app.post('/api/login', async (req) => {
    const { name, password } = Credentials.parse(req.body);
    return login(db, name, password);
  });
  app.post('/api/logout', async (req) => {
    const t = bearer(req);
    if (t) logout(db, t);
    return { ok: true };
  });
  app.get('/api/me', async (req, reply) => ({ user: requireUser(req, reply) }));

  // ── 로비 ──
  app.get('/api/scenarios', async () => listScenarios());
  app.get('/api/games', async () => games.list());
  app.post('/api/games', async (req, reply) => {
    const user = requireUser(req, reply);
    return games.create(user, CreateGame.parse(req.body));
  });
  app.get('/api/games/:id', async (req) => games.get(IdParam.parse(req.params).id));
  app.post('/api/games/:id/seat', async (req, reply) => {
    const user = requireUser(req, reply);
    return games.takeSeat(user, IdParam.parse(req.params).id, Seat.parse(req.body).factionId);
  });
  app.delete('/api/games/:id/seat', async (req, reply) => {
    const user = requireUser(req, reply);
    return games.leaveSeat(user, IdParam.parse(req.params).id);
  });
  app.post('/api/games/:id/start', async (req, reply) => {
    const user = requireUser(req, reply);
    return games.start(user, IdParam.parse(req.params).id);
  });

  // ── 게임 진행 ──
  app.get('/api/games/:id/state', async (req) => games.view(optionalUser(req), IdParam.parse(req.params).id));
  app.put('/api/games/:id/orders', async (req, reply) => {
    const user = requireUser(req, reply);
    const body = Orders.parse(req.body);
    const v = games.submitOrders(user, IdParam.parse(req.params).id, body.turn, body.commands as Command[]);
    if (!v.ok) reply.status(422);
    return v;
  });
  app.post('/api/games/:id/ready', async (req, reply) => {
    const user = requireUser(req, reply);
    const body = Ready.parse(req.body);
    return games.setReady(user, IdParam.parse(req.params).id, body.turn, body.ready);
  });
  app.get('/api/games/:id/messages', async (req) => games.messages(optionalUser(req), IdParam.parse(req.params).id));
  app.post('/api/games/:id/messages', async (req, reply) => {
    const user = requireUser(req, reply);
    const body = Message.parse(req.body);
    return games.postMessage(user, IdParam.parse(req.params).id, body.text, body.to ?? null);
  });

  // ── 실시간 알림 (WebSocket) ──
  await app.register(websocket);
  interface Client {
    send: (data: string) => void;
    user: User | null;
    gameId: number | null;
  }
  const clients = new Set<Client>();
  games.events.on('event', (e: GameEvent) => {
    const payload = JSON.stringify(e.type === 'chat' ? { type: 'chat', gameId: e.gameId, message: e.message } : e);
    for (const c of clients) {
      if (e.type === 'lobby') {
        if (c.gameId === null) c.send(payload);
        continue;
      }
      if (c.gameId !== e.gameId) continue;
      if (e.type === 'chat' && e.recipients && !(c.user && e.recipients.includes(c.user.id))) continue;
      c.send(payload);
    }
  });
  app.get('/ws', { websocket: true }, (socket, req) => {
    const token = (req.query as { token?: string }).token;
    const client: Client = {
      send: (d) => {
        if (socket.readyState === socket.OPEN) socket.send(d);
      },
      user: userByToken(db, token),
      gameId: null,
    };
    clients.add(client);
    socket.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type?: string; gameId?: number | null };
        if (msg.type === 'sub') client.gameId = typeof msg.gameId === 'number' ? msg.gameId : null;
      } catch {
        /* 무시 */
      }
    });
    socket.on('close', () => clients.delete(client));
  });

  // ── 정적 파일 ──
  if (opts.webDist && existsSync(opts.webDist)) {
    await app.register(fastifyStatic, { root: opts.webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api') || req.url.startsWith('/ws')) return reply.status(404).send({ error: 'not found' });
      return reply.sendFile('index.html');
    });
  }

  app.addHook('onClose', async () => db.close());
  return { app, games, db };
}
