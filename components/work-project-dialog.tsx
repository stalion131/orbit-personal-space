'use client';
/* oxlint-disable react-compiler/effect-set-state */
import { useEffect, useRef, useState } from 'react';
import { Bot, Send, LoaderCircle } from 'lucide-react';
import { workApi } from '@/lib/work-client';
import { briefForAgent } from '@/lib/work-brief';
import type { Task, WorkProject } from '@/lib/tasks';
import type { PprDeveloperResult } from '@/lib/ppr-agent-types';

export function WorkProjectDialog({
  task,
  project,
  token,
  dirty,
}: {
  task: Task;
  project: WorkProject;
  token: string | null;
  dirty: boolean;
}) {
  const [question, setQuestion] = useState(''),
    [consentFor, setConsentFor] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [messages, setMessages] = useState<
    { question: string; answer: string; result: PprDeveloperResult }[]
  >([]);
  const controller = useRef<AbortController | null>(null);
  const context = JSON.stringify({
    id: task.id,
    revision: task.revision,
    project,
    question,
  });
  const consent = consentFor === context;
  const setConsent = (value: boolean) => setConsentFor(value ? context : '');
  useEffect(() => {
    controller.current?.abort();
  }, [context]);
  useEffect(() => () => controller.current?.abort(), []);
  const send = async () => {
    if (!consent || dirty || busy || project.documentType !== 'ppr') return;
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setError('');
    setConsent(false);
    const text =
      question.trim() || 'Какие данные нужно уточнить перед разработкой ППР?';
    try {
      const { result } = await workApi<{ result: PprDeveloperResult }>(
        '/api/agents/ppr-developer',
        token,
        {
          method: 'POST',
          signal: request.signal,
          body: JSON.stringify({
            taskId: task.id,
            revision: task.revision,
            question: text,
            dialogue: messages
              .slice(-4)
              .map((m) => ({ question: m.question, answer: m.answer })),
            confirmDataTransfer: true,
          }),
        },
      );
      if (!request.signal.aborted) {
        setMessages((v) => [
          ...v,
          { question: text, answer: result.overview, result },
        ]);
        setQuestion('');
      }
    } catch (e) {
      if (!request.signal.aborted)
        setError(e instanceof Error ? e.message : 'Не удалось получить ответ.');
    } finally {
      if (controller.current === request) setBusy(false);
    }
  };
  return (
    <aside className="project-dialog" id="project-dialog">
      <header>
        <span className="eyebrow">ОДНА ПРОФЕССИОНАЛЬНАЯ РОЛЬ</span>
        <h2>
          <Bot />
          Диалог по проекту
        </h2>
        <p>Разработчик ППР · исходные данные и состав разделов</p>
      </header>
      <div className="dialog-messages">
        {!messages.length && (
          <div className="dialog-intro">
            <Bot />
            <strong>Начнём с ваших вводных</strong>
            <p>
              Сохраните ТЗ и задайте вопрос. Агент увидит введённые сведения, но
              не содержимое файлов.
            </p>
            <button
              className="quiet-btn"
              onClick={() =>
                setQuestion(
                  'Каких исходных данных не хватает и что нужно запросить у Подрядчика?',
                )
              }
            >
              Что ещё нужно уточнить?
            </button>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i}>
            <p className="message-user">{m.question}</p>
            <div className="message-agent">
              <small>Разработчик ППР</small>
              <p>{m.answer}</p>
              {!!m.result.questions.length && (
                <details>
                  <summary>Вопросы · {m.result.questions.length}</summary>
                  {m.result.questions.map((q, j) => (
                    <p key={j}>{q}</p>
                  ))}
                </details>
              )}
              {!!m.result.sections.length && (
                <details>
                  <summary>Карта разделов</summary>
                  {m.result.sections.map((s) => (
                    <p key={s.title}>
                      <strong>{s.title}</strong>
                      <br />
                      {s.rationale}
                    </p>
                  ))}
                </details>
              )}
              <details>
                <summary>Ограничения и проверки</summary>
                {[...m.result.missingInformation, ...m.result.warnings].map(
                  (w, j) => (
                    <p key={j}>{w}</p>
                  ),
                )}
              </details>
            </div>
          </div>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          aria-label="Сообщение разработчику ППР"
          rows={3}
          maxLength={2000}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={busy}
          placeholder="Уточнить задачу или обсудить следующий раздел…"
        />
        <details className="dialog-transfer">
          <summary>Какие данные отправятся в OpenAI</summary>
          <p>
            Описание этой задачи, паспорт, ТЗ, названия реестра, ваш вопрос и
            последние четыре обмена сообщениями. Файлы и рабочая папка не
            передаются.
          </p>
          <pre>
            {JSON.stringify(
              {
                task: task.description,
                project: {
                  object: project.objectName,
                  address: project.objectAddress,
                  customer: project.customer,
                  responsible: project.responsible,
                  workType: project.workType,
                },
                brief: briefForAgent(project),
                documents: project.documents.map((d) => d.name),
              },
              null,
              2,
            )}
          </pre>
        </details>
        <label className="consent">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            disabled={dirty || busy || project.documentType !== 'ppr'}
          />
          Разрешаю отправить показанные данные для этого ответа.
        </label>
        {dirty && <p className="hint">Сначала сохраните изменения ТЗ.</p>}
        {project.documentType === 'tk' && (
          <p className="hint">
            Разработчик ТК пока не подключён. Эта роль остаётся отдельной.
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="primary-btn"
          disabled={!consent || dirty || busy || project.documentType !== 'ppr'}
        >
          {busy ? <LoaderCircle className="spin" /> : <Send />}
          {busy ? 'Готовим ответ…' : 'Отправить'}
        </button>
        <small className="hint">
          Диалог хранится в текущем окне. Ответы не изменяют ТЗ автоматически.
        </small>
      </form>
    </aside>
  );
}
