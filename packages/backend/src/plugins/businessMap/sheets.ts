import { inflateRawSync } from 'node:zlib';

/**
 * The spreadsheets of the importer, without a library: CSV, and XLSX through a minimal reader (an .xlsx is a zip:
 * read its central directory, inflate the entries, take the shared strings and the cells of each sheet). Enough for
 * plain cells: no formulas are evaluated (their cached value is read), no styles, no dates.
 */

/** A row of a sheet: its number in the file (1-based) and its cells by column (A = 0). */
export type SheetRow = { n: number; cells: string[] };
export type Sheet = { name: string; rows: SheetRow[] };

/** The cells of a CSV text: quotes as in RFC 4180, the delimiter (, ; or tab) guessed from the first line. */
export function parseCsv(input: string): SheetRow[] {
  const text = input.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const count = (c: string) => first.split(c).length - 1;
  const candidates = [',', ';', '\t'];
  const delimiter = candidates.reduce((best, c) => (count(c) > count(best) ? c : best), ',');
  const rows: SheetRow[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let start = 1;
  const endRow = () => {
    cells.push(cell);
    if (cells.some(c => c.trim() !== '')) rows.push({ n: start, cells });
    cells = [];
    cell = '';
    start = line;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else {
        if (ch === '\n') line++;
        cell += ch;
      }
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) {
      cells.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      line++;
      endRow();
    } else cell += ch;
  }
  if (cell !== '' || cells.length) endRow();
  return rows;
}

/** The files of a zip archive by name (stored or deflated entries; no zip64, no encryption). */
export function unzip(buf: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('The file is not a valid .xlsx (no zip directory).');
  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let k = 0; k < entries; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('The file is not a valid .xlsx (broken zip directory).');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLength = buf.readUInt16LE(p + 28);
    const extraLength = buf.readUInt16LE(p + 30);
    const commentLength = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLength);
    p += 46 + nameLength + extraLength + commentLength;
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error(`The file is not a valid .xlsx (entry ${name}).`);
    const data = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(data, data + size);
    if (method === 0) out.set(name, Buffer.from(raw));
    else if (method === 8) out.set(name, inflateRawSync(raw));
    else throw new Error(`The .xlsx uses a compression this reader does not know (${method}): save it again, or as .csv.`);
  }
  return out;
}

export function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#([0-9]+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

const attrs = (s: string) => {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = decodeXml(m[2]);
  return out;
};

/** The text of a string item: every <t> run, without the phonetic runs. */
const textOf = (xml: string) =>
  [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => decodeXml(m[1])).join('');

/** Column index of a cell reference: A1 → 0, AB7 → 27. */
export function columnOf(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref.toUpperCase())?.[0] ?? '';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** A number as the sheet shows it, without binary noise (6.3000000000000007 → 6.3). */
const tidyNumber = (v: string) => {
  const x = Number(v);
  return Number.isFinite(x) ? String(Number(x.toPrecision(12))) : v;
};

function readSheet(xml: string, shared: string[]): SheetRow[] {
  const rows: SheetRow[] = [];
  let next = 1;
  for (const r of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const n = Number(attrs(r[1]).r) || next;
    next = n + 1;
    const cells: string[] = [];
    let col = 0;
    for (const c of (r[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = attrs(c[1]);
      if (a.r) col = columnOf(a.r);
      const body = c[2] ?? '';
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = '';
      if (a.t === 's') value = shared[Number(v)] ?? '';
      else if (a.t === 'inlineStr') value = textOf(body);
      else if (a.t === 'str' || a.t === 'e') value = decodeXml(v ?? '');
      else if (a.t === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
      else if (v !== undefined) value = tidyNumber(v);
      while (cells.length < col) cells.push('');
      cells[col] = value;
      col++;
    }
    if (cells.some(x => x.trim() !== '')) rows.push({ n, cells });
  }
  return rows;
}

/** The sheets of an .xlsx, in the order of the workbook. */
export function readXlsx(buf: Buffer): Sheet[] {
  const files = unzip(buf);
  const text = (name: string) => files.get(name)?.toString('utf8');
  const workbook = text('xl/workbook.xml');
  if (!workbook) throw new Error('The file is not a valid .xlsx (no xl/workbook.xml).');
  const shared = [...(text('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => textOf(m[1]));
  const targets = new Map<string, string>();
  for (const m of (text('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const a = attrs(m[1]);
    if (a.Id && a.Target) targets.set(a.Id, a.Target.startsWith('/') ? a.Target.slice(1) : `xl/${a.Target}`);
  }
  const sheets: Sheet[] = [];
  let index = 0;
  for (const m of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    index++;
    const a = attrs(m[1]);
    const id = a['r:id'] ?? Object.entries(a).find(([k]) => k.endsWith(':id'))?.[1];
    const path = (id && targets.get(id)) ?? `xl/worksheets/sheet${index}.xml`;
    const xml = text(path);
    if (xml !== undefined) sheets.push({ name: a.name ?? `Sheet${index}`, rows: readSheet(xml, shared) });
  }
  return sheets;
}

/** An uploaded file: a data URL (data:<type>;name=<file>;base64,<data>) or plain base64. */
export type Upload = { fileName: string; format: 'csv' | 'xlsx'; sheets: Sheet[] };

export function readUpload(file: string, fileName?: string): Upload {
  const m = /^data:([^;,]*)((?:;[^;,]*)*),([\s\S]*)$/.exec(file.trim());
  const type = (m?.[1] ?? '').toLowerCase();
  const params = (m?.[2] ?? '').split(';').filter(Boolean);
  const named = params.find(p => p.startsWith('name='))?.slice(5);
  const base64 = m ? params.includes('base64') : true;
  const payload = m ? m[3] : file;
  const buf = base64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8');
  let name = fileName && fileName !== 'upload' ? fileName : named ?? 'upload';
  try {
    name = decodeURIComponent(name);
  } catch {
    // a name that is not URL-encoded stays as it is
  }
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0xe011cfd0) throw new Error(`${name} is an old Excel file (.xls): save it as .xlsx or .csv.`);
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50) return { fileName: name, format: 'xlsx', sheets: readXlsx(buf) };
  if (type.includes('spreadsheetml') || /\.xlsx$/i.test(name)) throw new Error(`${name} is not a valid .xlsx file.`);
  return { fileName: name, format: 'csv', sheets: [{ name: 'csv', rows: parseCsv(buf.toString('utf8')) }] };
}
