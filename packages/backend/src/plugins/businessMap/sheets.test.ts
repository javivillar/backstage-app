import { deflateRawSync } from 'node:zlib';
import { columnOf, parseCsv, readUpload, readXlsx, compactSheet, writeXlsx, crc32, columnName } from './sheets';

/** A tiny zip writer for the tests: deflated entries, CRC left 0 (the reader does not check it). */
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = deflateRawSync(Buffer.from(text, 'utf8'));
    const n = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(Buffer.byteLength(text), 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(Buffer.byteLength(text), 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    centrals.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

/** A made-up workbook: one sheet "Model" with shared, inline and numeric cells. */
function workbook(rows: string[][], sheetName = 'Model'): Buffer {
  const shared: string[] = [];
  const cell = (v: string, r: number, c: number) => {
    const ref = `${String.fromCharCode(65 + c)}${r}`;
    if (v === '') return '';
    if (/^\d+(\.\d+)?$/.test(v) && !v.endsWith('.0')) return `<c r="${ref}"><v>${v}</v></c>`;
    shared.push(v);
    return `<c r="${ref}" t="s"><v>${shared.length - 1}</v></c>`;
  };
  const sheetRows = rows.map((r, i) => `<row r="${i + 1}">${r.map((v, c) => cell(v, i + 1, c)).join('')}</row>`).join('');
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return zip({
    '[Content_Types].xml': '<Types/>',
    'xl/workbook.xml': `<workbook xmlns:r="r"><sheets><sheet name="Notes" sheetId="1" r:id="rId2"/><sheet name="${sheetName}" sheetId="2" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="ws" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="ws" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${sheetRows}</sheetData></worksheet>`,
    'xl/worksheets/sheet2.xml': '<worksheet><sheetData><row r="1"><c r="B1" t="inlineStr"><is><t>made up</t></is></c></row></sheetData></worksheet>',
    'xl/sharedStrings.xml': `<sst>${shared.map(s => `<si><t>${esc(s)}</t></si>`).join('')}</sst>`,
  });
}

describe('parseCsv', () => {
  it('reads quotes, semicolons and empty lines', () => {
    const rows = parseCsv('\uFEFFID;Title;Owner\n1;"Sell; and ""ship""";\n\n2;"Two\nlines";x\n');
    expect(rows.map(r => r.cells)).toEqual([
      ['ID', 'Title', 'Owner'],
      ['1', 'Sell; and "ship"', ''],
      ['2', 'Two\nlines', 'x'],
    ]);
    expect(rows.map(r => r.n)).toEqual([1, 2, 4]);
  });
});

describe('readXlsx', () => {
  it('reads the sheets in workbook order, shared, inline and numeric cells', () => {
    const sheets = readXlsx(workbook([['ID', 'Title'], ['1.0', 'Plan & build'], ['', ''], ['1.1', 'Two']]));
    expect(sheets.map(s => s.name)).toEqual(['Notes', 'Model']);
    expect(sheets[0].rows[0].cells).toEqual(['', 'made up']);
    expect(sheets[1].rows.map(r => r.cells)).toEqual([['ID', 'Title'], ['1.0', 'Plan & build'], ['1.1', 'Two']]);
    expect(sheets[1].rows.map(r => r.n)).toEqual([1, 2, 4]);
  });
  it('knows the columns', () => {
    expect(columnOf('A1')).toBe(0);
    expect(columnOf('AB7')).toBe(27);
  });
});

describe('readUpload', () => {
  it('tells xlsx from csv by content, decodes the name', () => {
    const x = readUpload(`data:application/octet-stream;name=My%20model.xlsx;base64,${workbook([['ID']]).toString('base64')}`, 'upload');
    expect(x.format).toBe('xlsx');
    expect(x.fileName).toBe('My model.xlsx');
    const c = readUpload(`data:text/csv;name=m.csv;base64,${Buffer.from('ID,Title\n1,A').toString('base64')}`);
    expect(c.format).toBe('csv');
    expect(c.sheets[0].rows[1].cells).toEqual(['1', 'A']);
  });
  it('refuses an old .xls', () => {
    expect(() => readUpload(`data:application/vnd.ms-excel;base64,${Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0]).toString('base64')}`, 'old.xls')).toThrow('.xls');
  });
});

describe('compactSheet', () => {
  it('reads back as the same sheet: its name, row numbers, cells with commas, quotes and line breaks', () => {
    const sheet = {
      name: 'Combined',
      rows: [
        { n: 1, cells: ['PCF ID', 'Hierarchy ID', 'Name'] },
        { n: 2, cells: ['10002', '1.0', 'Develop Vision, and "Strategy"'] },
        { n: 5, cells: ['10017', '1.1.1', ''] },
        // a cell with a line break takes two lines of the CSV: the rows after it are numbered one more
        { n: 6, cells: ['10014', '1.1', 'Two\nlines'] },
      ],
    };
    const back = readUpload(compactSheet(sheet, 'PCF Cross Industry.xlsx'));
    expect(back.format).toBe('csv');
    expect(back.fileName).toBe('PCF Cross Industry.xlsx');
    // empty cells at the end of a row are left out
    const trimmed = sheet.rows.map(r => ({ n: r.n, cells: r.n === 5 ? ['10017', '1.1.1'] : r.cells }));
    expect(back.sheets).toEqual([{ name: 'Combined', rows: trimmed }]);
  });
  it('leaves out the formatted empty cells up to the far right of a sheet', () => {
    const wide = { name: 'S', rows: [{ n: 1, cells: ['ID', 'Title', ...Array(16000).fill('')] }, { n: 2, cells: ['1.0', 'A', ...Array(16000).fill('')] }] };
    expect(compactSheet(wide, 'w.xlsx').length).toBeLessThan(200);
  });
});

describe('writeXlsx', () => {
  it('writes a workbook the reader reads back: sheets, cells, empty cells, XML characters', () => {
    const buf = writeXlsx([
      { name: 'BIA', header: true, widths: [10, 40], rows: [['ID', 'Process', 'Notes'], ['6.3.2', 'Repair <fast> & "well"', ''], ['6.3.3', '', 'Línea\ndos']] },
      { name: 'Guide', rows: [['Criticality', 'critical, important, standard']] },
    ]);
    const sheets = readXlsx(buf);
    expect(sheets.map(s => s.name)).toEqual(['BIA', 'Guide']);
    expect(sheets[0].rows).toEqual([
      { n: 1, cells: ['ID', 'Process', 'Notes'] },
      { n: 2, cells: ['6.3.2', 'Repair <fast> & "well"'] },
      { n: 3, cells: ['6.3.3', '', 'Línea\ndos'] },
    ]);
    expect(sheets[1].rows[0].cells[1]).toBe('critical, important, standard');
  });
  it('the CRC-32 and the column names', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    expect([columnName(0), columnName(25), columnName(26), columnName(27), columnName(701), columnName(702)]).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  });
});

