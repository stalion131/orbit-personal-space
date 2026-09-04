import { authorize, body, failure, json } from '@/lib/http';
import { requirePprProject } from '@/lib/ppr-project-access';
import { TaskError, event, type Task } from '@/lib/tasks';
import { saveTask } from '@/lib/repository';
import { saveCloudTask } from '@/lib/supabase-repository';
import {
  assembleDocx,
  compareDocx,
  decodeFile,
  extractFile,
  hashBytes,
  inspectDocx,
} from '@/lib/ppr-docx';
import {
  applyProposals,
  autoFillProposals,
  contractTkProposals,
  proposalKey,
  PPR_MODEL,
  readPprWorkspace,
  verifiedProposals,
  proposalsWithKnownPositions,
  hasSignatoryPosition,
  type BriefField,
} from '@/lib/ppr-workspace';
import { isBriefApproved, readWorkBrief } from '@/lib/work-brief';
import {
  draftPprSection,
  extractPprBrief,
  checkSolConnection,
} from '@/lib/ppr-developer-agent';
import { draftableSectionIds, type DraftableSectionId } from '@/lib/ppr-drafts';
import {
  SOURCE_BATCH_COUNT,
  SOURCE_BATCH_TEXT,
  sourceBatchIssue,
  readSourcePurpose,
} from '@/lib/work-sources';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const access = await authorize(request);
    await requirePprProject(access, (await context.params).id);
    return json({
      model: PPR_MODEL,
      configured: !!process.env.OPENAI_API_KEY?.trim(),
      fileLimit: 2500000,
      storage: 'device',
      sourcePolicy: 'read-only-no-persistent-copy',
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const access = await authorize(request),
      { id } = await context.params;
    const task = await requirePprProject(access, id);
    const data = await body(request, 4_000_000);
    if (data.revision !== task.revision)
      throw new TaskError(
        'Проект изменился. Обновите его перед действием.',
        409,
      );
    const workspace = structuredClone(readPprWorkspace(task.pprWorkspace));
    const now = new Date().toISOString();
    const registerFiles = (
      files: { name: string; hash: string }[],
      category: 'source' | 'draft',
    ) => {
      const documents = [...task.workProject.documents];
      for (const file of files) {
        const id = `file-${file.hash}`;
        // Older saved registries truncated IDs to 60 characters. Recognize
        // these without renaming/removing existing user-visible records.
        if (!documents.some((d) => d.id === id || d.id === id.slice(0, 60)))
          documents.push({
            id,
            name: file.name.slice(0, 180),
            category,
            version:
              category === 'draft' ? 'Word · история версий' : 'Исходный файл',
            status: category === 'draft' ? 'review' : 'available',
            updatedAt: now,
          });
      }
      if (documents.length > 100)
        throw new TaskError('В реестре достигнут лимит 100 файлов.', 409);
      return { ...task.workProject, documents };
    };
    const modelConsent = () => {
      if (data.confirmDataTransfer !== true)
        throw new TaskError(
          'Подтвердите отправку выбранного текста и ТЗ в OpenAI.',
        );
      if (!process.env.OPENAI_API_KEY?.trim())
        throw new TaskError(
          'Нужен серверный OPENAI_API_KEY с доступом к gpt-5.6-sol. Подписка Codex не заменяет API-ключ.',
          503,
        );
    };
    const approval = () => {
      if (!isBriefApproved(task, task.workProject))
        throw new TaskError('Сначала утвердите актуальную редакцию ТЗ.', 409);
      return task.briefApprovals!.at(-1)!;
    };
    const commit = async (
      title: string,
      extra: Partial<Task> = {},
      response: Record<string, unknown> = {},
    ) => {
      let checked;
      try {
        checked = readPprWorkspace(workspace);
      } catch {
        throw new TaskError(
          'Превышен лимит истории: 10 разборов, 40 Word-версий или объём правок. Сохраните резервную копию.',
          409,
        );
      }
      if (Buffer.byteLength(JSON.stringify(checked)) > 700000)
        throw new TaskError(
          'История проекта достигла лимита MVP 700 КБ. Скачайте резервную копию.',
          409,
        );
      const next = {
        ...task,
        ...extra,
        pprWorkspace: checked,
        revision: task.revision + 1,
        updatedAt: now,
        events: [
          ...task.events,
          event(title, 'Рабочее пространство ППР', 'Вы'),
        ],
      };
      if (Buffer.byteLength(JSON.stringify(next.pprDrafts || [])) > 500000)
        throw new TaskError('Достигнут лимит текстовых версий 500 КБ.', 409);
      const payload = { ...response, task: next };
      if (Buffer.byteLength(JSON.stringify(payload)) > 4_000_000)
        throw new TaskError(
          'Файл вместе с историей превышает размер ответа. Соберите меньшую часть документа. Версия не сохранялась.',
          413,
        );
      if (access.mode === 'supabase')
        await saveCloudTask(access.client, next, task.revision);
      else await saveTask(next, task.revision);
      return json(payload, 201);
    };
    // File operations intentionally have no access to server paths or remote URLs.
    if (data.op === 'probe') {
      if (data.confirmConnection !== true)
        throw new TaskError(
          'Подтвердите тестовый вызов SOL без данных проекта.',
        );
      if (!process.env.OPENAI_API_KEY?.trim())
        throw new TaskError('На сервере не задан OPENAI_API_KEY.', 503);
      await checkSolConnection(
        AbortSignal.any([request.signal, AbortSignal.timeout(20000)]),
      );
      return json({ connected: true, model: PPR_MODEL });
    }
    if (data.op === 'inspect') {
      const file = decodeFile(data.file);
      const extracted = await extractFile(file, 500000);
      const document = /\.docx$/i.test(file.name)
        ? inspectDocx(file.bytes)
        : null;
      const payload = {
        file: extracted,
        paragraphs: document?.paragraphs || [],
      };
      if (Buffer.byteLength(JSON.stringify(payload)) > 4_000_000)
        throw new TaskError(
          'Превышен объём предпросмотра. Загрузите часть документа.',
          413,
        );
      return json(payload);
    }
    if (data.op === 'analyze' || data.op === 'extract_tk') {
      if (data.op === 'analyze') modelConsent();
      if (
        !Array.isArray(data.files) ||
        !data.files.length ||
        data.files.length > SOURCE_BATCH_COUNT
      )
        throw new TaskError(
          `Выберите от 1 до ${SOURCE_BATCH_COUNT} исходных файлов.`,
        );
      const files = [];
      const decoded = data.files.map((value) => ({
        ...decodeFile(value),
        purpose: readSourcePurpose((value as { purpose?: unknown })?.purpose),
      }));
      const issue = sourceBatchIssue(
        decoded.map((f) => ({ name: f.name, size: f.bytes.length })),
      );
      if (issue) throw new TaskError(issue);
      // Content identity is independent of the filename. Re-reading a source
      // never creates a new physical file or another registry record.
      const uniqueFiles = new Map<string, (typeof decoded)[number]>();
      for (const value of decoded) {
        const hash = hashBytes(value.bytes);
        const previous = uniqueFiles.get(hash);
        if (previous && previous.purpose !== value.purpose)
          throw new TaskError(
            'Один исходный файл выбран с разным назначением. Оставьте один вариант.',
          );
        if (!previous) uniqueFiles.set(hash, value);
      }
      for (const value of uniqueFiles.values())
        files.push({
          ...(await extractFile(
            value,
            /\.pdf$/i.test(value.name) ? 100000 : SOURCE_BATCH_TEXT,
          )),
          purpose: value.purpose,
        });
      if (
        files.reduce((n, f) => n + f.characters, 0) > SOURCE_BATCH_TEXT
      )
        throw new TaskError(
          'Сократите пакет до 300 000 знаков.',
        );
      const output =
        data.op === 'extract_tk'
          ? { proposals: [], questions: [], warnings: [] }
          : await extractPprBrief(
              task.workProject,
              files,
              workspace,
              AbortSignal.any([request.signal, AbortSignal.timeout(55000)]),
            );
      const candidates = [...contractTkProposals(files), ...output.proposals];
      const validated = verifiedProposals(candidates, files).filter((p) => {
        try {
          const next = applyProposals(
            task.workProject,
            readWorkBrief(task.workProject.brief, task.workProject),
            [p],
          );
          readWorkBrief(next.brief, next);
          return (
            next.objectName.length <= 240 &&
            next.objectAddress.length <= 300 &&
            next.workType.length <= 300
          );
        } catch {
          return false;
        }
      });
      const proposals = proposalsWithKnownPositions(
        validated,
        readWorkBrief(task.workProject.brief, task.workProject),
      );
      const autoFill =
        data.autoFill === true
          ? autoFillProposals(task.workProject, proposals)
          : null;
      workspace.analyses.push({
        id: crypto.randomUUID(),
        at: now,
        revision: task.revision + 1,
        model: PPR_MODEL,
        ...(data.op === 'extract_tk' ? { method: 'contract_tk' as const } : {}),
        files: files.map(({ hash, name, size, characters, purpose }) => ({
          hash,
          name,
          size,
          characters,
          purpose,
        })),
        proposals,
        questions: output.questions.map((s) => s.slice(0, 500)).slice(0, 15),
        warnings: [
          ...(autoFill?.warnings || []),
          ...(proposals.length !== candidates.length
            ? [
                'Исключены предложения без проверяемой цитаты, с неверным значением, ФИО без известной должности или подменой строительных сторон из договора на разработку ППР.',
              ]
            : []),
          ...files.flatMap((f) =>
            f.warnings.map((w) => `${f.name}: ${w}`.slice(0, 500)),
          ),
          ...output.warnings.map((s) => s.slice(0, 500)),
        ].slice(0, 15),
        applied: autoFill?.applied || [],
      });
      return commit(
        data.op === 'extract_tk'
          ? 'Из договора извлечён перечень ТК для проверки'
          : 'SOL подготовила предложения для ТЗ',
        {
          workProject: {
            ...(autoFill?.project || task.workProject),
            documents: registerFiles(files, 'source').documents,
          },
        },
      );
    }
    if (data.op === 'apply') {
      const analysis = workspace.analyses.find((a) => a.id === data.analysisId);
      if (!analysis || analysis.revision !== task.revision)
        throw new TaskError(
          'Разбор устарел или уже применён. Выполните новый разбор по актуальному ТЗ.',
          409,
        );
      if (
        !Array.isArray(data.fields) ||
        !data.fields.length ||
        data.fields.length > 60 ||
        new Set(data.fields).size !== data.fields.length
      )
        throw new TaskError('Выберите поля для заполнения.');
      if (data.fields.some((f) => analysis.applied.includes(f)))
        throw new TaskError('Выбранные значения уже сохранены в ТЗ.', 409);
      const proposals = data.fields.map((f) =>
        analysis.proposals.find(
          (p) => proposalKey(p) === f && !analysis.applied.includes(f),
        ),
      );
      if (proposals.some((p) => !p))
        throw new TaskError('Поле отсутствует в проверенном разборе.');
      const project = applyProposals(
        task.workProject,
        readWorkBrief(task.workProject.brief, task.workProject),
        proposals.filter((p) => !!p),
      );
      project.brief = readWorkBrief(project.brief, project);
      for (const side of ['contractor', 'customer'] as const) {
        if (
          data.fields.includes(`brief.${side}.fullName`) &&
          !hasSignatoryPosition(project.brief[side].position)
        )
          throw new TaskError(
            'ФИО нельзя применить без должности. Выберите также проверенное предложение должности или оставьте оба поля пустыми.',
          );
      }
      analysis.applied.push(...(data.fields as BriefField[]));
      analysis.revision = task.revision + 1;
      return commit('Применены выбранные предложения для ТЗ', {
        workProject: project,
      });
    }
    if (data.op === 'generate') {
      modelConsent();
      const approved = approval();
      if (!draftableSectionIds.includes(data.sectionId as DraftableSectionId))
        throw new TaskError(
          'Этот раздел разрабатывается вручную или другой ролью.',
        );
      if ((task.pprDrafts?.length || 0) >= 20)
        throw new TaskError(
          'Достигнут лимит 20 текстовых версий проекта.',
          409,
        );
      const file = decodeFile(data.file);
      if (!/\.docx$/i.test(file.name))
        throw new TaskError('Выберите базовый DOCX.');
      const extracted = await extractFile(file, 500000);
      if (
        !Array.isArray(data.blocks) ||
        !data.blocks.length ||
        data.blocks.length > 8 ||
        new Set(data.blocks).size !== data.blocks.length
      )
        throw new TaskError('Выберите от 1 до 8 фрагментов шаблона.');
      const sources = data.blocks.map((id) =>
        extracted.blocks.find((b) => b.id === id),
      );
      if (
        sources.some((s) => !s || s.text.length > 1800) ||
        sources.reduce((n, s) => n + (s?.text.length || 0), 0) > 12000
      )
        throw new TaskError(
          'Фрагмент слишком длинный: максимум 1800 знаков, всего 12 000.',
        );
      const template = {
        path: `uploads/${extracted.hash}.docx`,
        name: file.name,
        sourceHash: extracted.hash,
        textHash: hashBytes(
          Buffer.from(extracted.blocks.map((b) => b.text).join('\n')),
        ),
      };
      const draft = await draftPprSection(
        task,
        data.sectionId as DraftableSectionId,
        template,
        sources.filter((s) => !!s),
        AbortSignal.any([request.signal, AbortSignal.timeout(55000)]),
      );
      const saved = {
        ...draft,
        briefId: approved.id,
        createdAt: now,
        version:
          Math.max(
            0,
            ...(task.pprDrafts || [])
              .filter((d) => d.sectionId === draft.sectionId)
              .map((d) => d.version),
          ) + 1,
      };
      return commit('SOL подготовила новую версию раздела', {
        pprDrafts: [...(task.pprDrafts || []), saved],
      });
    }
    if (data.op === 'assemble') {
      const approved = approval();
      if (data.confirmAssembly !== true)
        throw new TaskError(
          'Подтвердите границы замены и сохранение остальных частей шаблона.',
        );
      const file = decodeFile(data.file);
      if (!/\.docx$/i.test(file.name))
        throw new TaskError('Нужен DOCX-шаблон.');
      const parentHash = hashBytes(file.bytes);
      if (
        !Array.isArray(data.sections) ||
        !data.sections.length ||
        data.sections.length > 6
      )
        throw new TaskError('Выберите разделы для сборки.');
      const seen = new Set<string>();
      const sections = data.sections.map((s) => {
        const draft = task.pprDrafts?.find((d) => d.id === s?.draftId);
        if (
          !draft ||
          draft.briefId !== approved.id ||
          seen.has(draft.sectionId)
        )
          throw new TaskError(
            'Раздел повторяется или подготовлен по другой редакции ТЗ.',
            409,
          );
        if (
          draft.template.sourceHash !== parentHash &&
          !workspace.versions.some(
            (v) => v.hash === parentHash && v.briefId === approved.id,
          )
        )
          throw new TaskError(
            'Базовый файл отличается от шаблона раздела. Выберите исходную или сохранённую Word-версию.',
            409,
          );
        if (typeof s.start !== 'string' || typeof s.end !== 'string')
          throw new TaskError('Задайте границы раздела.');
        seen.add(draft.sectionId);
        return {
          draftId: draft.id,
          start: s.start,
          end: s.end,
          paragraphs: draft.paragraphs,
        };
      });
      const output = assembleDocx(file.bytes, sections);
      if (output.length > 2500000)
        throw new TaskError(
          'Собранный DOCX превышает лимит 2,5 МБ. Разделите документ.',
        );
      const version = {
        id: crypto.randomUUID(),
        hash: hashBytes(output),
        name: `PPR-v${workspace.versions.length + 1}-draft.docx`,
        at: now,
        parentHash,
        kind: 'assembled' as const,
        briefId: approved.id,
        draftIds: sections.map((s) => s.draftId),
      };
      workspace.versions.push(version);
      return commit(
        'Собран DOCX для инженерной проверки',
        { workProject: registerFiles([version], 'draft') },
        {
          file: {
            name: version.name,
            base64: Buffer.from(output).toString('base64'),
            hash: version.hash,
          },
        },
      );
    }
    if (data.op === 'correct') {
      const baseline = workspace.versions.find((v) => v.id === data.versionId);
      if (!baseline) throw new TaskError('Выберите исходную Word-версию.');
      const original = decodeFile(data.original),
        corrected = decodeFile(data.file);
      if (!/\.docx$/i.test(original.name) || !/\.docx$/i.test(corrected.name))
        throw new TaskError('Для сравнения нужны два DOCX.');
      if (hashBytes(original.bytes) !== baseline.hash)
        throw new TaskError(
          'Исходный файл не совпадает с выбранной версией.',
          409,
        );
      const hash = hashBytes(corrected.bytes);
      if (workspace.versions.some((v) => v.hash === hash))
        throw new TaskError('Этот файл уже сохранён в истории.', 409);
      const changes = compareDocx(original.bytes, corrected.bytes);
      if (
        changes.length > 40 ||
        changes.some((c) => c.before.length > 3000 || c.after.length > 3000)
      )
        throw new TaskError(
          'Для разбора правок загрузите меньшую часть: до 40 изменений по 3000 знаков. Исправленный файл на компьютере не менялся.',
        );
      const version = {
        ...baseline,
        id: crypto.randomUUID(),
        hash,
        parentHash: baseline.hash,
        name: corrected.name,
        at: now,
        kind: 'corrected' as const,
      };
      workspace.versions.push(version);
      workspace.experience.push({
        id: crypto.randomUUID(),
        versionId: version.id,
        at: now,
        changes,
        rule: '',
        confirmedAt: null,
      });
      return commit('Загружена исправленная Word-версия', {
        workProject: registerFiles([version], 'draft'),
      });
    }
    if (data.op === 'confirm_experience') {
      const experience = workspace.experience.find(
        (e) => e.id === data.experienceId,
      );
      if (!experience || experience.confirmedAt)
        throw new TaskError('Правки не найдены или уже подтверждены.', 409);
      if (
        typeof data.rule !== 'string' ||
        !data.rule.trim() ||
        data.rule.length > 1500 ||
        !Array.isArray(data.indices) ||
        data.indices.length > 40 ||
        new Set(data.indices).size !== data.indices.length
      )
        throw new TaskError('Опишите правило и выберите примеры.');
      const changes = data.indices.map((i) =>
        Number.isSafeInteger(i) ? experience.changes[i] : undefined,
      );
      if (!changes.length || changes.some((c) => !c))
        throw new TaskError('Выберите хотя бы одну существующую правку.');
      experience.changes = changes.filter((c) => !!c);
      experience.rule = data.rule.trim();
      experience.confirmedAt = now;
      return commit('Подтверждён опыт правок для этого проекта');
    }
    throw new TaskError('Неизвестное действие.');
  } catch (error) {
    if (error instanceof TaskError) return failure(error);
    // Parser errors are deliberately bounded and do not contain source text or provider payloads.
    return json(
      {
        error:
          error instanceof Error &&
          /^(DOCX|Файл|Выберите|Размер|DTD|Небезопасный|Макросы|Внешние|В DOCX|Более|Текст|TXT|Конец|Диапазоны|В диапазоне|Для сравнения)/.test(
            error.message,
          )
            ? error.message.slice(0, 300)
            : 'Не удалось обработать документ. Проверьте формат файла и повторите действие.',
      },
      400,
    );
  }
}
