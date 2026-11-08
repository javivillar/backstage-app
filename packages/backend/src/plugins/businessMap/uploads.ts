import { randomUUID } from 'node:crypto';

/**
 * The files of the import, held by Backstage between the preview and the template: the form sends the template a
 * reference of a few bytes (a data URL of type application/x-business-model-upload naming it) instead of the file,
 * so the size of a workbook never meets a body limit of the scaffolder. Held in memory for an hour; the preview route
 * and the scaffolder action run in the same Backstage process (one replica). After a restart the preview is run again.
 */
const TTL_MS = 60 * 60 * 1000;
const MAX_HELD = 50;
const TYPE = 'application/x-business-model-upload';
const REF = /^data:application\/x-business-model-upload;name=([0-9a-f-]{36});base64,/;
const held = new Map<string, { data: string; expires: number }>();

function prune(now: number) {
  for (const [id, e] of held) if (e.expires < now) held.delete(id);
  while (held.size >= MAX_HELD) held.delete(held.keys().next().value as string);
}

/** Holds a file (a data URL) and gives the reference the template gets in its place. */
export function stageUpload(data: string, now = Date.now()): string {
  prune(now);
  const id = randomUUID();
  held.set(id, { data, expires: now + TTL_MS });
  return `data:${TYPE};name=${id};base64,${Buffer.from(id, 'utf8').toString('base64')}`;
}

/** The file a reference names (any other value is the file itself). */
export function resolveUpload(file: string, now = Date.now()): string {
  const m = REF.exec(file);
  if (!m) return file;
  const e = held.get(m[1]);
  if (!e || e.expires < now) {
    throw new Error('Backstage no longer holds the uploaded file (it keeps it an hour, or it restarted): go back to the preview and run it again.');
  }
  return e.data;
}
