export type RuntimeConfig =
  | { mode: 'local' }
  | { mode: 'supabase'; supabaseUrl: string; publishableKey: string };

export function runtimeConfig(): RuntimeConfig {
  const supabaseUrl = typeof process.env.SUPABASE_URL === 'string' ? process.env.SUPABASE_URL.trim() : '';
  const publishableKey = (
    typeof process.env.SUPABASE_PUBLISHABLE_KEY === 'string'
      ? process.env.SUPABASE_PUBLISHABLE_KEY
      : typeof process.env.SUPABASE_ANON_KEY === 'string'
        ? process.env.SUPABASE_ANON_KEY
        : ''
  ).trim();

  if (!supabaseUrl && !publishableKey) return { mode: 'local' };
  if (!supabaseUrl || !publishableKey) throw new Error('Supabase настроен не полностью. Нужны URL и publishable key.');

  const url = new URL(supabaseUrl);
  if (url.protocol !== 'https:') throw new Error('Supabase URL должен использовать HTTPS.');
  return { mode: 'supabase', supabaseUrl: url.origin, publishableKey };
}
