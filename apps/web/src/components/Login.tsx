import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { useApp } from '../store';

export function Login() {
  const setUser = useApp((s) => s.setUser);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (mode: 'login' | 'register', e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = mode === 'login' ? await api.login(name, password) : await api.register(name, password);
      setUser(r.user, r.token);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center">
      <form className="card login" onSubmit={(e) => submit('login', e)}>
        <h1 className="title">천하삼분</h1>
        <p className="muted">비동기 턴제 삼국시대 전략 게임</p>
        <label>
          이름
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" />
        </label>
        <label>
          비밀번호
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </label>
        {error && <div className="error">{error}</div>}
        <div className="row">
          <button type="submit" disabled={busy}>로그인</button>
          <button type="button" className="secondary" disabled={busy} onClick={() => submit('register')}>
            가입
          </button>
        </div>
      </form>
    </div>
  );
}
