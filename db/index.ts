export function getDb(): never {
  throw new Error('Vercel-версия Orbit использует Supabase. D1 больше не поддерживается в этом размещении.');
}
