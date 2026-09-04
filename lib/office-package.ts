import { unzipSync, strFromU8 } from 'fflate';
import { DOMParser, type Document } from '@xmldom/xmldom';

export function officeXml(text: string): Document {
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error('DTD и XML-сущности в документе запрещены.');
  return new DOMParser({
    onError: () => {
      throw new Error('Некорректная структура XML.');
    },
  }).parseFromString(text, 'application/xml');
}

export function officePackage(bytes: Uint8Array, format: 'DOCX' | 'XLSX') {
  let count = 0,
    size = 0;
  const seen = new Set<string>();
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter: (entry) => {
        if (
          ++count > 1500 ||
          (size += entry.originalSize) > 60_000_000 ||
          entry.originalSize > 12_000_000 ||
          /(^\/|\\|(^|\/)\.\.($|\/))/.test(entry.name) ||
          seen.has(entry.name)
        )
          throw new Error('Небезопасный архив Office.');
        seen.add(entry.name);
        if (/vbaProject|activeX|embeddings\//i.test(entry.name))
          throw new Error('Встроенные объекты запрещены.');
        return true;
      },
    });
  } catch {
    throw new Error(
      `${format} повреждён, защищён паролем, слишком велик после распаковки или содержит неподдерживаемые объекты.`,
    );
  }
  if (!entries['[Content_Types].xml'])
    throw new Error(`Файл не является ${format}.`);
  for (const [name, value] of Object.entries(entries)) {
    if (!name.endsWith('.xml') && !name.endsWith('.rels')) continue;
    const doc = officeXml(strFromU8(value));
    if (
      name === '[Content_Types].xml' &&
      /macroEnabled|vbaProject/i.test(strFromU8(value))
    )
      throw new Error('Документы с макросами запрещены.');
    if (name.endsWith('.rels'))
      for (const relation of Array.from(
        doc.getElementsByTagNameNS('*', 'Relationship'),
      )) {
        if (
          relation.getAttribute('TargetMode') === 'External' &&
          !(
            relation.getAttribute('Type')?.endsWith('/hyperlink') &&
            /^(https?:\/\/|mailto:)/i.test(
              relation.getAttribute('Target') || '',
            )
          )
        )
          throw new Error(
            `Внешние связи с файлами в ${format} запрещены. Сохраните копию без связей.`,
          );
      }
  }
  return entries;
}
