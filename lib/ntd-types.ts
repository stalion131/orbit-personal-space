export type NtdRecord = {
  id: string;
  sheet: string;
  row: number;
  fields: Record<string, string>;
};
export type NtdLibrary = {
  schema: 'orbit-ntd-roadmap-v1';
  name: string;
  hash: string;
  importedAt: string;
  records: NtdRecord[];
  permits: NtdRecord[];
  warnings: string[];
};
export type NtdLibraryReply = {
  version: number;
  library: NtdLibrary | null;
  mode: 'local' | 'supabase';
};
export function safeNtdUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
