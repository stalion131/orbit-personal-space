import { demoTasks } from '@/lib/tasks';
import { insertTask } from '@/lib/repository';
import { guard, body, json, failure } from '@/lib/http';
export async function POST(request: Request) {
  try { guard(request); await body(request); await Promise.all(demoTasks().map(insertTask)); return json({ok: true}); } catch (error) { return failure(error); }
}
