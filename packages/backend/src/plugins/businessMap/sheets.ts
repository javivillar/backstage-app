import { deflateRawSync, inflateRawSync } from 'node:zlib';

/**
 * The spreadsheets of the importer, without a library: CSV, and XLSX through a minimal reader (an .xlsx is a zip:
 * read its central directory, inflate the entries, take the shared strings and the cells of each sheet). Enough for
 * plain cells: no formulas are evaluated (their cached value is read), no styles, no dates. And the other way, a
 * minimal writer (writeXlsx: text cells, a bold frozen header) for the BIA sheet the owners fill in.
 */

/** A row of a sheet: its number in the file (1-based) and its cells by column (A = 0). */
export type SheetRow = { n: number; cells: string[] };
export type Sheet = { name: string; rows: SheetRow[] };

/** The cells of a CSV text: quotes as in RFC 4180, the delimiter (, ; or tab) guessed from the first line. */
export function parseCsv(input: string): SheetRow[] {
  const text = input.replace(/^\uFEFF/, '');
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
  // text/csv is a sheet sent again as CSV (compactSheet): it keeps the name of its workbook
  if (type !== 'text/csv' && (type.includes('spreadsheetml') || /\.xlsx$/i.test(name))) throw new Error(`${name} is not a valid .xlsx file.`);
  // a sheet of an .xlsx sent again as CSV (compactSheet) keeps its name
  const sheetName = params.find(p => p.startsWith('sheet='))?.slice(6);
  let shown = 'csv';
  try {
    shown = sheetName ? decodeURIComponent(sheetName) : 'csv';
  } catch {
    shown = sheetName ?? 'csv';
  }
  return { fileName: name, format: 'csv', sheets: [{ name: shown, rows: parseCsv(buf.toString('utf8')) }] };
}

const csvCell = (c: string) => (/[",\r\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);

/**
 * One sheet of an upload as a small CSV data URL (data:text/csv;name=<file>;sheet=<sheet>;base64,…): the import reads
 * it as it read the sheet of the .xlsx, with the same row numbers (blank lines fill the gaps; a cell with line breaks
 * shifts the numbers after it). The form sends this to
 * the template instead of the whole workbook, whose base64 can pass the 10 MB the scaffolder accepts.
 */
export function compactSheet(sheet: Sheet, fileName: string): string {
  const lines: string[] = [];
  let line = 1;
  for (const r of sheet.rows) {
    while (line < r.n) {
      lines.push('');
      line++;
    }
    const text = r.cells.map(csvCell).join(',');
    lines.push(text);
    line += 1 + (text.match(/\n/g)?.length ?? 0);
  }
  // a first line without a comma would leave the delimiter to the guess: the header always has one
  if (lines.length && !lines[0].includes(',')) lines[0] += ',';
  const data = Buffer.from(lines.join('\n'), 'utf8').toString('base64');
  return `data:text/csv;name=${encodeURIComponent(fileName)};sheet=${encodeURIComponent(sheet.name)};base64,${data}`;
}

// ---------------------------------------------------------------- writing: a minimal .xlsx (no dependencies)

/** One sheet to write: its rows of text cells; the first row a bold, frozen header when header is set. */
export type SheetOut = { name: string; rows: string[][]; header?: boolean; widths?: number[] };

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** The CRC-32 of a zip entry (Excel checks it). */
export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A zip archive of these files, deflated (the reader above reads it back). */
export function zip(files: Array<{ name: string; data: Buffer }>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const packed = deflateRawSync(f.data);
    const crc = crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(0, 10); // time and date: none
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(0x0800, 8);
    head.writeUInt16LE(8, 10);
    head.writeUInt32LE(0, 12);
    head.writeUInt32LE(crc, 16);
    head.writeUInt32LE(packed.length, 20);
    head.writeUInt32LE(f.data.length, 24);
    head.writeUInt16LE(name.length, 28);
    head.writeUInt32LE(offset, 42);
    locals.push(local, name, packed);
    central.push(head, name);
    offset += local.length + name.length + packed.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

/** Text for XML: escaped, without the control characters XML does not allow. */
export function xmlText(s: string): string {
  return s
    .replace(/[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The column letters of an index: 0 → A, 27 → AB. */
export function columnName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function sheetXml(sheet: SheetOut): string {
  const views = sheet.header
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  const cols = sheet.widths?.length
    ? `<cols>${sheet.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    : '';
  const rows = sheet.rows
    .map((r, ri) => {
      const style = sheet.header && ri === 0 ? ' s="1"' : '';
      const cells = r
        .map((v, ci) => (v === '' ? '' : `<c r="${columnName(ci)}${ri + 1}" t="inlineStr"${style}><is><t xml:space="preserve">${xmlText(v)}</t></is></c>`))
        .join('');
      return `<row r="${ri + 1}">${cells}</row>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${views}${cols}<sheetData>${rows}</sheetData></worksheet>`;
}

const STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

/** A workbook of text sheets, as Excel and LibreOffice open it (inline strings, a bold frozen header). */
export function writeXlsx(sheets: SheetOut[]): Buffer {
  const xml = (s: string) => Buffer.from(s, 'utf8');
  // a sheet name: up to 31 characters, none of []:*?/\
  const names = sheets.map(s => s.name.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Sheet');
  const files = [
    {
      name: '[Content_Types].xml',
      data: xml(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
          '</Types>',
      ),
    },
    {
      name: '_rels/.rels',
      data: xml(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      ),
    },
    {
      name: 'xl/workbook.xml',
      data: xml(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
          names.map((n, i) => `<sheet name="${xmlText(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
          '</sheets></workbook>',
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: xml(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
          `<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      ),
    },
    { name: 'xl/styles.xml', data: xml(STYLES) },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: xml(sheetXml(s)) })),
  ];
  return zip(files);
}
