'use client';

import { useState } from 'react';
import { Command, LoaderCircle, LockKeyhole, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function LoginScreen({ onSignIn, onSignUp, setupError = '' }: {
  onSignIn: (email: string, password: string) => Promise<void>;
  onSignUp: (email: string, password: string) => Promise<boolean>;
  setupError?: string;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(setupError);
  const [notice, setNotice] = useState('');

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (register) {
        const signedIn = await onSignUp(email.trim(), password);
        if (!signedIn) setNotice('Проверьте почту и подтвердите регистрацию, затем войдите.');
      } else await onSignIn(email.trim(), password);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось войти.');
    } finally { setBusy(false); }
  }

  return <main className="auth-shell">
    <section className="auth-card">
      <div className="auth-brand"><span><Command size={24}/></span>orbit<i>.</i></div>
      <div className="auth-icon"><LockKeyhole size={22}/></div>
      <p className="auth-kicker">ЛИЧНОЕ ПРОСТРАНСТВО</p>
      <h1>{register ? 'Создайте аккаунт' : 'С возвращением'}<span>.</span></h1>
      <p>Ваши задачи доступны только после входа.</p>
      <form onSubmit={submit}>
        <label htmlFor="auth-email">Email<Input id="auth-email" type="email" autoComplete="email" required value={email} disabled={busy} onChange={event => setEmail(event.target.value)}/></label>
        <label htmlFor="auth-password">Пароль<Input id="auth-password" type="password" minLength={8} autoComplete={register ? 'new-password' : 'current-password'} required value={password} disabled={busy} onChange={event => setPassword(event.target.value)}/></label>
        {(error || setupError) && <div className="auth-message error-message" role="alert">{error || setupError}</div>}
        {notice && <div className="auth-message success-message">{notice}</div>}
        <Button className="primary-button auth-submit" type="submit" disabled={busy}>{busy && <LoaderCircle className="spin"/>}{register ? 'Зарегистрироваться' : 'Войти'}</Button>
      </form>
      <Button variant="ghost" className="auth-switch" onClick={() => { setRegister(value => !value); setError(''); setNotice(''); }} disabled={busy}>{register ? 'У меня уже есть аккаунт' : 'Создать новый аккаунт'}</Button>
      <div className="auth-safe"><ShieldCheck size={16}/>Доступ к каждой задаче ограничен владельцем аккаунта.</div>
    </section>
  </main>;
}
