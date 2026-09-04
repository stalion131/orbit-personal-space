'use client';
import { useEffect, useRef, useState } from 'react';
import { workApi } from '@/lib/work-client';

export function PprConnectionStatus({ token }: { token: string | null }) {
  const [configured, setConfigured] = useState<boolean | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const active = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    workApi<{ configured: boolean }>('/api/agents/ppr-status', token, {
      signal: controller.signal,
    })
      .then((v) => setConfigured(v.configured))
      .catch(() => setConfigured(null));
    return () => controller.abort();
  }, [token]);
  return (
    <div>
      <p>
        {configured === false
          ? 'Для SOL нужен серверный OPENAI_API_KEY.'
          : configured === true
            ? 'API-ключ настроен. Можно проверить подключение без файлов и данных проекта.'
            : 'Статус подключения пока неизвестен.'}
      </p>
      <button
        className="quiet-btn"
        disabled={busy || configured !== true}
        onClick={async () => {
          if (active.current) return;
          active.current = true;
          setBusy(true);
          setMessage('');
          try {
            await workApi('/api/agents/ppr-status', token, {
              method: 'POST',
              body: JSON.stringify({ confirmConnection: true }),
            });
            setMessage('SOL ответила — подключение подтверждено.');
          } catch (e) {
            setMessage(
              e instanceof Error ? e.message : 'Подключение не подтверждено.',
            );
          } finally {
            active.current = false;
            setBusy(false);
          }
        }}
      >
        {busy ? 'Проверяю…' : 'Проверить подключение SOL'}
      </button>
      <small>Короткий тестовый вызов расходует средства API.</small>
      {message && <output className="ppr-notice">{message}</output>}
    </div>
  );
}
