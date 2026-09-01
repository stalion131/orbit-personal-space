import { env } from 'cloudflare:workers';

export type RuntimeConfig =
  | { mode: 'local' }
  | { mode: 'supabase'; supabaseUrl: string; publishableKey: string };

export function runtimeConfig(): RuntimeConfig {
  const supabaseUrl = typeof env.SUPABASE_URL === 'string' ? env.SUPABASE_URL.trim() : '';
  const publishableKey = (
    typeof env.SUPABASE_PUBLISHABLE_KEY === 'string'
      ? env.SUPABASE_PUBLISHABLE_KEY
      : typeof env.SUPABASE_ANON_KEY === 'string'
        ? env.SUPABASE_ANON_KEY
        : ''
  ).trim();

  if (!supabaseUrl && !publishableKey) return { mode: 'local' };
  if (!supabaseUrl || !publishableKey) throw new Error('Supabase настроен не полностью. Нужны URL и publishable key.');

  const url = new URL(supabaseUrl);
  if (url.protocol !== 'https:') throw new Error('Supabase URL должен использовать HTTPS.');
  return { mode: 'supabase', supabaseUrl: url.origin, publishableKey };
}
