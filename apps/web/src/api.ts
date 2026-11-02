import type { Command, GameView } from '@ch/engine';

export interface User {
  id: number;
  name: string;
}

export interface Seat {
  factionId: string;
  userId: number;
  userName: string;
  ready: boolean;
  alive: boolean;
}

export interface GameSummary {
  id: number;
  name: string;
  scenarioId: string;
  ownerId: number;
  status: 'lobby' | 'running' | 'finished';
  turnMinutes: number;
  deadline: number | null;
  year: number;
  month: number;
  turn: number;
  winner: string | null;
  seats: Seat[];
  factions: { id: string; name: string; color: string; alive: boolean }[];
}

export interface ScenarioInfo {
  id: string;
  name: string;
  description: string;
  factions: { id: string; name: string; color: string }[];
}

export interface ChatMessage {
  id: number;
  userName: string;
  fromFaction: string | null;
  toFaction: string | null;
  text: string;
  createdAt: number;
}

export interface StateResponse {
  game: GameSummary;
  view: GameView;
  orders: Command[];
}

export interface OrderValidation {
  ok: boolean;
  errors: { index: number; message: string }[];
}

const TOKEN_KEY = 'ch.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(t: string | null) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
  ) {
    super(message);
  }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `HTTP ${res.status}`, res.status, data);
  return data as T;
}

export const api = {
  register: (name: string, password: string) => req<{ token: string; user: User }>('POST', '/api/register', { name, password }),
  login: (name: string, password: string) => req<{ token: string; user: User }>('POST', '/api/login', { name, password }),
  logout: () => req('POST', '/api/logout'),
  me: () => req<{ user: User }>('GET', '/api/me'),
  scenarios: () => req<ScenarioInfo[]>('GET', '/api/scenarios'),
  games: () => req<GameSummary[]>('GET', '/api/games'),
  game: (id: number) => req<GameSummary>('GET', `/api/games/${id}`),
  createGame: (b: { name: string; scenarioId: string; turnMinutes: number; endYear?: number }) =>
    req<GameSummary>('POST', '/api/games', b),
  seat: (id: number, factionId: string) => req<GameSummary>('POST', `/api/games/${id}/seat`, { factionId }),
  leave: (id: number) => req<GameSummary>('DELETE', `/api/games/${id}/seat`),
  start: (id: number) => req<GameSummary>('POST', `/api/games/${id}/start`),
  state: (id: number) => req<StateResponse>('GET', `/api/games/${id}/state`),
  orders: (id: number, turn: number, commands: Command[]) =>
    req<OrderValidation>('PUT', `/api/games/${id}/orders`, { turn, commands }),
  ready: (id: number, turn: number, ready: boolean) => req<GameSummary>('POST', `/api/games/${id}/ready`, { turn, ready }),
  messages: (id: number) => req<ChatMessage[]>('GET', `/api/games/${id}/messages`),
  post: (id: number, text: string, to: string | null) => req<ChatMessage>('POST', `/api/games/${id}/messages`, { text, to }),
};

/** 서버 푸시 구독. 끊기면 자동 재연결. */
export function connectEvents(gameId: number | null, onEvent: (e: { type: string; gameId?: number }) => void): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const open = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(getToken() ?? '')}`);
    ws.onopen = () => ws?.send(JSON.stringify({ type: 'sub', gameId }));
    ws.onmessage = (m) => {
      try {
        onEvent(JSON.parse(m.data));
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      if (!closed) retry = setTimeout(open, 2000);
    };
  };
  open();
  return () => {
    closed = true;
    clearTimeout(retry);
    ws?.close();
  };
}
