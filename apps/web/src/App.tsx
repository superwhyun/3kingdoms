import { useEffect, useState } from 'react';
import { api, getToken } from './api';
import { useApp } from './store';
import { Login } from './components/Login';
import { Lobby } from './components/Lobby';
import { GameScreen } from './components/GameScreen';

export function App() {
  const { user, gameId, setUser } = useApp();
  const [checking, setChecking] = useState(!!getToken());

  useEffect(() => {
    if (!getToken()) return;
    api
      .me()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null, null))
      .finally(() => setChecking(false));
  }, [setUser]);

  useEffect(() => {
    const onHash = () => {
      const m = location.hash.match(/^#game\/(\d+)$/);
      useApp.setState({ gameId: m ? Number(m[1]) : null });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (checking) return <div className="center muted">불러오는 중…</div>;
  if (!user) return <Login />;
  return gameId ? <GameScreen key={gameId} gameId={gameId} /> : <Lobby />;
}
