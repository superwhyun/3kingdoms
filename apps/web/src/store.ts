import { create } from 'zustand';
import { setToken, type User } from './api';

interface AppState {
  user: User | null;
  gameId: number | null;
  setUser: (u: User | null, token?: string | null) => void;
  openGame: (id: number | null) => void;
}

function initialGame(): number | null {
  const m = location.hash.match(/^#game\/(\d+)$/);
  return m ? Number(m[1]) : null;
}

export const useApp = create<AppState>((set) => ({
  user: null,
  gameId: initialGame(),
  setUser: (user, token) => {
    if (token !== undefined) setToken(token);
    set({ user });
  },
  openGame: (gameId) => {
    location.hash = gameId ? `game/${gameId}` : '';
    set({ gameId });
  },
}));
