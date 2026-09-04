export const draftableSectionIds = ['general', 'organization', 'resources', 'explanatory', 'technology', 'safety'] as const;
export type DraftableSectionId = (typeof draftableSectionIds)[number];
export type TemplateChunk = { id: string; text: string };
export type TemplateReference = { path: string; name: string; sourceHash: string; textHash: string };
export type TemplatePreview = TemplateReference & { chunks: TemplateChunk[] };
export type PprDraft = {
  id: string; taskId: string; sourceRevision: number; sectionId: DraftableSectionId; sectionTitle: string;
  template: TemplateReference; sources: TemplateChunk[];
  paragraphs: { text: string; changed: boolean }[]; questions: string[]; warnings: string[];
};
export type SavedPprDraft = PprDraft & { version: number; createdAt: string; briefId?: string };
export const DRAFT_REVIEW_WARNING = 'Черновик требует инженерной проверки и проверки специалистом по НТД. Не использовать для производства работ без согласования.';
export const MAX_SOURCE_CHARACTERS = 12000;

export function splitTemplateText(content: string): TemplateChunk[] {
  const parts: string[] = [];
  for (const line of content.replace(/\r\n/g, '\n').split(/\n+/).map(item => item.trim()).filter(Boolean)) {
    let remaining = line;
    while (remaining.length > 1800) {
      const boundary = remaining.lastIndexOf(' ', 1800);
      const cut = boundary > 900 ? boundary : 1800;
      parts.push(remaining.slice(0, cut).trim()); remaining = remaining.slice(cut).trim();
    }
    if (remaining) parts.push(remaining);
  }
  return parts.map((text, index) => ({ id: `fragment-${index + 1}`, text }));
}

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function text(value: unknown, maximum: number) { if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new Error('Некорректный текст черновика.'); return value.trim(); }
function list(value: unknown, maximum: number, length: number) { if (!Array.isArray(value) || value.length > maximum) throw new Error('Некорректный список черновика.'); return value.map(item => text(item, length)); }
export function validDraftId(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }

// Recompute provenance on the trusted side. A model/client cannot mark changed text as unchanged.
export function markDraftParagraphs(paragraphs: string[], sources: TemplateChunk[]) {
  return paragraphs.map(value => ({ text: value, changed: !sources.some(source => source.text.trim() === value.trim()) }));
}

export function parsePprDraft(value: unknown): PprDraft {
  if (!record(value) || !validDraftId(value.id) || !validDraftId(value.taskId) || !Number.isSafeInteger(value.sourceRevision) || Number(value.sourceRevision) < 1 || !draftableSectionIds.includes(value.sectionId as DraftableSectionId) || !record(value.template)) throw new Error('Некорректные данные черновика.');
  const template = value.template;
  if (typeof template.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(template.sourceHash) || typeof template.textHash !== 'string' || !/^[a-f0-9]{64}$/.test(template.textHash)) throw new Error('Некорректная версия шаблона.');
  const path = text(template.path, 1000);
  if (/^(?:[a-z]:|[\\/])/i.test(path) || path.includes('\0') || path.split(/[\\/]/).includes('..')) throw new Error('Допускается только относительный путь шаблона.');
  if (!Array.isArray(value.sources) || !value.sources.length || value.sources.length > 8) throw new Error('Выберите от 1 до 8 фрагментов.');
  const sources = value.sources.map(item => { if (!record(item)) throw new Error('Некорректный фрагмент.'); return { id: text(item.id, 80), text: text(item.text, 1800) }; });
  if (new Set(sources.map(item => item.id)).size !== sources.length || sources.reduce((sum, item) => sum + item.text.length, 0) > MAX_SOURCE_CHARACTERS) throw new Error('Фрагментов слишком много или они повторяются.');
  if (!Array.isArray(value.paragraphs) || !value.paragraphs.length || value.paragraphs.length > 30) throw new Error('Некорректные абзацы черновика.');
  const paragraphs = value.paragraphs.map(item => { if (!record(item)) throw new Error('Некорректный абзац.'); return text(item.text, 3000); });
  if (paragraphs.reduce((sum, item) => sum + item.length, 0) > 24000) throw new Error('Черновик слишком большой.');
  return {
    id: value.id, taskId: value.taskId, sourceRevision: Number(value.sourceRevision), sectionId: value.sectionId as DraftableSectionId,
    sectionTitle: text(value.sectionTitle, 200), template: { path, name: text(template.name, 300), sourceHash: template.sourceHash, textHash: template.textHash },
    sources, paragraphs: markDraftParagraphs(paragraphs, sources), questions: list(value.questions, 15, 500),
    warnings: [...new Set([DRAFT_REVIEW_WARNING, ...list(value.warnings, 16, 500)])].slice(0, 16),
  };
}

export function hydratePprDrafts(value: unknown): SavedPprDraft[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) throw new Error('Неподдерживаемый список версий ППР.');
  return value.map(item => {
    const draft = parsePprDraft(item);
    if (!record(item) || !Number.isSafeInteger(item.version) || Number(item.version) < 1 || typeof item.createdAt !== 'string' || Number.isNaN(Date.parse(item.createdAt))) throw new Error('Некорректная сохранённая версия ППР.');
    if (item.briefId !== undefined && !validDraftId(item.briefId)) throw new Error('Некорректная редакция ТЗ черновика.');
    return { ...draft, version: Number(item.version), createdAt: item.createdAt, ...(item.briefId ? { briefId: item.briefId as string } : {}) };
  });
}

function escapeHtml(value: string) { return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!); }
export function draftHtml(draft: PprDraft | SavedPprDraft) {
  const version = 'version' in draft ? ` · версия ${draft.version}` : ' · не сохранён';
  return `<!doctype html><html lang="ru"><meta charset="utf-8"><title>${escapeHtml(draft.sectionTitle)}</title><style>body{max-width:800px;margin:40px auto;padding:24px;font:16px/1.6 Arial,sans-serif;color:#111}h1{font-size:24px}p{white-space:pre-wrap}.changed{color:#1655bd}.warning{padding:12px;border:1px solid #c88b1b;background:#fff8e7}.source{border-left:3px solid #aaa;padding-left:12px;color:#444}small{color:#666}</style><body><h1>${escapeHtml(draft.sectionTitle)}${version}</h1><p class="warning">${escapeHtml(DRAFT_REVIEW_WARNING)}</p><p><small>Шаблон: ${escapeHtml(draft.template.name)}. Синим отмечены абзацы, не совпадающие дословно с выбранными фрагментами. Это не полная разметка изменений DOCX.</small></p>${draft.paragraphs.map(item => `<p class="${item.changed ? 'changed' : ''}">${escapeHtml(item.text)}</p>`).join('')}<h2>Вопросы и проверки</h2>${[...draft.questions, ...draft.warnings].map(item => `<p>${escapeHtml(item)}</p>`).join('')}<h2>Выбранные исходные фрагменты</h2>${draft.sources.map(item => `<p class="source">${escapeHtml(item.text)}</p>`).join('')}</body></html>`;
}
