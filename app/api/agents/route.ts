import { authorize, failure, json } from '@/lib/http';

export async function GET(request: Request) {
  try {
    await authorize(request);
    return json({ agents: [{
      id: 'task_triage_agent',
      name: 'ИИ-разбор задач',
      description: 'Расставляет приоритеты и предлагает следующий шаг.',
      status: process.env.OPENAI_API_KEY?.trim() ? 'ready' : 'setup_required',
    }] });
  } catch (error) {
    return failure(error);
  }
}
