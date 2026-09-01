import { json } from '@/lib/http';
import { runtimeConfig } from '@/lib/runtime';

export async function GET() {
  try {
    return json(runtimeConfig());
  } catch {
    return json({ error: 'Облачное хранилище настроено не полностью.' }, 503);
  }
}
