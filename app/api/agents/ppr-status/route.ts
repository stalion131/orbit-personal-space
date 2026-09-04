import { authorize, body, failure, json } from '@/lib/http';
import { checkSolConnection } from '@/lib/ppr-developer-agent';
import { PPR_MODEL } from '@/lib/ppr-workspace';
import { TaskError } from '@/lib/tasks';

export const maxDuration = 30;
export async function GET(request: Request) {
  try {
    await authorize(request);
    return json({
      configured: !!process.env.OPENAI_API_KEY?.trim(),
      model: PPR_MODEL,
    });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    await authorize(request);
    if ((await body(request, 1000)).confirmConnection !== true)
      throw new TaskError('Подтвердите проверку подключения.');
    if (!process.env.OPENAI_API_KEY?.trim())
      throw new TaskError('На сервере не задан OPENAI_API_KEY.', 503);
    await checkSolConnection(
      AbortSignal.any([request.signal, AbortSignal.timeout(20000)]),
    );
    return json({ connected: true, model: PPR_MODEL });
  } catch (error) {
    return failure(error);
  }
}
