import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePprDraft, markDraftParagraphs, splitTemplateText, draftHtml, hydratePprDrafts } from '../lib/ppr-drafts.ts';

const fixture = () => ({
  id: '7245378a-7cbe-4b8c-a67a-215ed9649148', taskId: '34277d84-b73f-49e9-88f3-f6767fe0ee83', sourceRevision: 3,
  sectionId: 'general', sectionTitle: '1. Общая часть', template: { path: 'templates/ppr.docx', name: 'ppr.docx', sourceHash: 'a'.repeat(64), textHash: 'b'.repeat(64) },
  sources: [{ id: 'fragment-1', text: 'Общий абзац шаблона.' }], paragraphs: [{ text: 'Общий абзац шаблона.', changed: true }, { text: 'Новый текст.', changed: false }], questions: [], warnings: [],
});
test('The service determines unchanged and changed paragraphs, ignoring caller flags', () => {
  const draft = parsePprDraft(fixture());
  assert.deepEqual(draft.paragraphs.map(item => item.changed), [false, true]);
  assert.ok(draft.warnings.some(item => item.includes('инженерной проверки')));
  assert.equal(markDraftParagraphs(['Изменённый абзац'], draft.sources)[0].changed, true);
  assert.equal(markDraftParagraphs(['Новый текст '], draft.sources)[0].text, 'Новый текст ', 'Editing must preserve spaces as they are typed.');
});
test('Fragment split preserves content, stable ids and maximum length', () => {
  const content = 'Секция\n' + 'слово '.repeat(1000);
  const chunks = splitTemplateText(content);
  assert.ok(chunks.every(item => item.text.length <= 1800));
  assert.equal(chunks.map(item => item.text).join(' ').replace(/\s+/g, ' '), content.trim().replace(/\s+/g, ' '));
  assert.deepEqual(splitTemplateText(content), chunks);
});
test('Limits and source path validation reject unsafe or oversized drafts', () => {
  for (const path of ['../secret', 'C:\\secret', '/secret', '\\server\\secret']) assert.throws(() => parsePprDraft({ ...fixture(), template: { ...fixture().template, path } }));
  assert.throws(() => parsePprDraft({ ...fixture(), sources: Array.from({ length: 9 }, (_, i) => ({ id: `f${i}`, text: 'x' })) }));
  assert.throws(() => parsePprDraft({ ...fixture(), sources: [{ id: 'same', text: 'a' }, { id: 'same', text: 'b' }] }));
  assert.throws(() => parsePprDraft({ ...fixture(), sources: Array.from({ length: 8 }, (_, i) => ({ id: `f${i}`, text: 'x'.repeat(1800) })) }));
  assert.throws(() => parsePprDraft({ ...fixture(), paragraphs: [] }));
  assert.throws(() => parsePprDraft({ ...fixture(), sectionId: 'graphics' }));
});
test('HTML export escapes model text and preserves blue styling and source comparison', () => {
  const draft = parsePprDraft({ ...fixture(), paragraphs: [{ text: '<script>alert(1)</script>', changed: false }] });
  const html = draftHtml(draft);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('<p class="changed">'));
  assert.ok(html.includes('Выбранные исходные фрагменты'));
});
test('Old tasks default to no drafts; saved versions survive a JSON round trip', () => {
  assert.deepEqual(hydratePprDrafts(undefined), []);
  const draft = { ...parsePprDraft(fixture()), version: 1, createdAt: '2026-09-04T10:00:00.000Z' };
  assert.deepEqual(hydratePprDrafts(JSON.parse(JSON.stringify([draft]))), [draft]);
  assert.throws(() => hydratePprDrafts([{ ...draft, version: 0 }]));
});
