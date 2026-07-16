'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_FINAL_CSV = path.join(__dirname, 'participantsFinal.csv');
const DEFAULT_CSV = path.join(__dirname, 'participants.csv');
const CSV_PATH = process.env.PARTICIPANTS_CSV
  ? path.resolve(process.env.PARTICIPANTS_CSV)
  : fs.existsSync(DEFAULT_FINAL_CSV)
    ? DEFAULT_FINAL_CSV
    : DEFAULT_CSV;

const NAME_FIELDS = ['Name', 'Full Name', 'Full name', 'Ho ten', 'Họ tên SV/HV', 'Họ tên', 'Ho ten SV/HV'];
const ID_FIELDS = ['MSSV', 'Student ID', 'StudentID', 'SID', 'ID'];
const EMAIL_FIELDS = ['Email', 'E-mail', 'Mail'];
const PHONE_FIELDS = ['Phone', 'Phone Number', 'SDT'];
const PARTICIPATE_FIELDS = ['Participate', 'Participant', 'Attending'];
const IDENTITY_FIELDS = [
  ...NAME_FIELDS,
  ...ID_FIELDS,
  ...EMAIL_FIELDS,
  ...PHONE_FIELDS,
].map(field => field.toLowerCase());

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }

  row.push(field);
  rows.push(row);
  return rows;
}

function cleanHeader(value) {
  return String(value ?? '').replace(/^\uFEFF/, '').trim();
}

function cleanCell(value) {
  return String(value ?? '').trim();
}

function findField(fields, candidates) {
  const normalized = new Map(
    Object.keys(fields).map(key => [key.toLowerCase(), key])
  );

  for (const candidate of candidates) {
    const key = normalized.get(candidate.toLowerCase());
    if (key && fields[key]) return fields[key];
  }

  return '';
}

function isParticipating(value) {
  return ['true', 'yes', 'y', '1', 'x'].includes(
    String(value ?? '').trim().toLowerCase()
  );
}

function loadParticipants() {
  const csv = fs.readFileSync(CSV_PATH, 'utf8');
  const rows = parseCsv(csv);
  if (!rows.length) return [];

  const headers = rows[0].map(cleanHeader);
  const activeColumns = headers
    .map((name, index) => ({ name, index }))
    .filter(column => column.name);
  const hasIdentityColumns = activeColumns.some(column =>
    IDENTITY_FIELDS.includes(column.name.toLowerCase())
  );
  const hasParticipateColumn = activeColumns.some(column =>
    PARTICIPATE_FIELDS.map(field => field.toLowerCase()).includes(column.name.toLowerCase())
  );

  const participants = [];

  rows.slice(1).forEach((cells, index) => {
    const fields = {};

    for (const column of activeColumns) {
      fields[column.name] = cleanCell(cells[column.index]);
    }

    const name = findField(fields, NAME_FIELDS);
    const sid = findField(fields, ID_FIELDS);
    const email = findField(fields, EMAIL_FIELDS);
    const phone = findField(fields, PHONE_FIELDS);
    const participate = findField(fields, PARTICIPATE_FIELDS);

    if (hasIdentityColumns) {
      if (![name, sid, email, phone].some(Boolean)) return;
    } else if (!Object.values(fields).some(Boolean)) {
      return;
    }

    if (hasParticipateColumn && !isParticipating(participate)) return;

    const rowNumber = index + 2;
    participants.push({
      rowNumber,
      fields,
      name,
      sid,
      email,
      phone,
    });
  });

  participants.headers = activeColumns.map(column => column.name);
  participants.csvPath = CSV_PATH;
  return participants;
}

module.exports = loadParticipants();
