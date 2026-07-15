'use strict';

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const LAYOUT_PATH = process.env.LAYOUT_XLSX
  ? path.resolve(process.env.LAYOUT_XLSX)
  : path.join(__dirname, 'layout.xlsx');

function decodeXml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function colIndex(ref) {
  const letters = ref.match(/[A-Z]+/)?.[0] || 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

function sharedStringText(xml) {
  return [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
    .map(match => decodeXml(match[1]))
    .join('');
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeId(value) {
  return normalize(value);
}

function normalizeEmail(value) {
  return normalize(value);
}

function valueAt(row, index) {
  return String(row[index] ?? '').trim();
}

function isTableNumber(value) {
  return /^\d+$/.test(String(value || '').trim());
}

function parseSheets(workbookXml, relsXml) {
  const relMap = Object.fromEntries(
    [...relsXml.matchAll(/<Relationship Id="([^"]+)"[^>]*Target="([^"]+)"/g)]
      .map(match => [match[1], `xl/${match[2].replace(/^\//, '')}`])
  );

  return [...workbookXml.matchAll(/<sheet name="([^"]+)" sheetId="[^"]+" r:id="(rId\d+)"\/>/g)]
    .map(match => ({ name: decodeXml(match[1]), file: relMap[match[2]] }))
    .filter(sheet => sheet.file);
}

function parseRows(xml, sharedStrings) {
  return [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map(rowMatch => {
    const row = [];

    for (const cell of rowMatch[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cell[1];
      const body = cell[2];
      const ref = attrs.match(/r="([^"]+)"/)?.[1] || 'A';
      const type = attrs.match(/t="([^"]+)"/)?.[1] || '';
      const valueMatch = body.match(/<v>([\s\S]*?)<\/v>/);
      const inlineMatch = body.match(/<t[^>]*>([\s\S]*?)<\/t>/);
      let value = '';

      if (type === 's' && valueMatch) {
        value = sharedStrings[Number(valueMatch[1])] || '';
      } else if (inlineMatch) {
        value = decodeXml(inlineMatch[1]);
      } else if (valueMatch) {
        value = decodeXml(valueMatch[1]);
      }

      row[colIndex(ref)] = String(value).trim();
    }

    return row;
  });
}

async function loadWorkbookRows() {
  if (!fs.existsSync(LAYOUT_PATH)) {
    return { sheets: [], rowsBySheet: new Map() };
  }

  const zip = await JSZip.loadAsync(fs.readFileSync(LAYOUT_PATH));
  const sharedStringsFile = zip.file('xl/sharedStrings.xml');
  const sharedStringsXml = sharedStringsFile ? await sharedStringsFile.async('string') : '';
  const sharedStrings = [...sharedStringsXml.matchAll(/<si[\s\S]*?<\/si>/g)]
    .map(match => sharedStringText(match[0]));
  const workbookXml = await zip.file('xl/workbook.xml').async('string');
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const sheets = parseSheets(workbookXml, relsXml);
  const rowsBySheet = new Map();

  for (const sheet of sheets) {
    const file = zip.file(sheet.file);
    if (!file) continue;
    rowsBySheet.set(sheet.name, parseRows(await file.async('string'), sharedStrings));
  }

  return { sheets, rowsBySheet };
}

function buildTableIndex(rows) {
  const records = [];
  let currentTable = '';

  for (const row of rows.slice(1)) {
    const first = valueAt(row, 0);
    const second = valueAt(row, 1);
    const sid = valueAt(row, 2);
    const email = valueAt(row, 3);
    const className = valueAt(row, 4);

    if (isTableNumber(first)) {
      currentTable = first;
    }

    const name = isTableNumber(first) ? second : (first || second);
    if (!currentTable || (!sid && !email && !name)) continue;

    records.push({
      tableNumber: currentTable,
      tableLabel: `Table ${currentTable}`,
      name,
      sid,
      email,
      className,
    });
  }

  const tableSizes = records.reduce((counts, record) => {
    counts.set(record.tableNumber, (counts.get(record.tableNumber) || 0) + 1);
    return counts;
  }, new Map());
  const bySid = new Map();
  const byEmail = new Map();

  for (const record of records) {
    const info = {
      ...record,
      tableSize: tableSizes.get(record.tableNumber) || 0,
    };
    if (record.sid) bySid.set(normalizeId(record.sid), info);
    if (record.email) byEmail.set(normalizeEmail(record.email), info);
  }

  return { bySid, byEmail, records };
}

let cachedLayout = null;

async function loadLayout() {
  if (cachedLayout) return cachedLayout;

  const { sheets, rowsBySheet } = await loadWorkbookRows();
  const tableSheet = sheets.find(sheet => normalize(sheet.name).includes('chia')) || sheets[0];
  const tableRows = tableSheet ? rowsBySheet.get(tableSheet.name) || [] : [];
  const tableIndex = buildTableIndex(tableRows);

  cachedLayout = {
    path: LAYOUT_PATH,
    sheetNames: sheets.map(sheet => sheet.name),
    tableSheet: tableSheet?.name || '',
    ...tableIndex,
  };
  return cachedLayout;
}

function findTableInfo(layout, participant) {
  return layout.bySid.get(normalizeId(participant.sid))
    || layout.byEmail.get(normalizeEmail(participant.email))
    || null;
}

module.exports = {
  findTableInfo,
  loadLayout,
};
