'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useRef, useState } from 'react';
import type { RuntimeConfig } from './runtime';

type SessionState = {
  loading: boolean;
  mode: 'local' | 'supabase';
  accessToken: string | null;
  email: string;
  error: string;
};

export function useOrbitSession() {
  const client = useRef<SupabaseClient | null>(null);
  const [state, setState] = useState<SessionState>({ loading: true, mode: 'local', accessToken: null, email: '', error: '' });

  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};
    async function initialize() {
      try {
        const response = await fetch('/api/config', { cache: 'no-store' });
        const config = await response.json() as RuntimeConfig & { error?: string };
        if (!response.ok) throw new Error(config.error || 'Не удалось прочитать настройки хранилища.');
        if (config.mode === 'local') {
          if (active) setState({ loading: false, mode: 'local', accessToken: null, email: '', error: '' });
          return;
        }
        const supabase = createClient(config.supabaseUrl, config.publishableKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        });
        client.current = supabase;
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (active) setState({ loading: false, mode: 'supabase', accessToken: data.session?.access_token ?? null, email: data.session?.user.email ?? '', error: '' });
        const listener = supabase.auth.onAuthStateChange((_event, session) => {
          if (active) setState({ loading: false, mode: 'supabase', accessToken: session?.access_token ?? null, email: session?.user.email ?? '', error: '' });
        });
        unsubscribe = () => listener.data.subscription.unsubscribe();
      } catch (error) {
        if (active) setState(current => ({ ...current, loading: false, error: error instanceof Error ? error.message : 'Ошибка настройки входа.' }));
      }
    }
    void initialize();
    return () => { active = false; unsubscribe(); };
  }, []);

  async function signIn(email: string, password: string) {
    if (!client.current) throw new Error('Supabase ещё не готов.');
    const { error } = await client.current.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async function signUp(email: string, password: string) {
    if (!client.current) throw new Error('Supabase ещё не готов.');
    const { data, error } = await client.current.auth.signUp({ email, password });
    if (error) throw error;
    return !!data.session;
  }

  async function signOut() {
    if (!client.current) return;
    const { error } = await client.current.auth.signOut();
    if (error) throw error;
  }

  return { ...state, signIn, signUp, signOut };
}
