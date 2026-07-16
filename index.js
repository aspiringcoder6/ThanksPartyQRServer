'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const { PARTICIPANTS, buildRegistry } = require('./qr-registry');
const { TableStore } = require('./table-store');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.SECRET || 'change-me-in-render-env';

const checkedIn = new Map();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.use('/admin', (_, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.use('/api/admin', (_, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

function requireKey(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.key || '';
  if (key !== SECRET) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

function norm(value) {
  return String(value || '').trim().toLowerCase();
}

function simpleQrData(body) {
  if (body?.qr && typeof body.qr === 'object') return body.qr;
  if (body?.raw) {
    try { return JSON.parse(body.raw); } catch { return {}; }
  }
  return body || {};
}

function publicParticipant(participant, tableStore) {
  const tableInfo = tableStore.find(participant);
  return {
    uid: participant.uid,
    name: participant.name,
    sid: participant.sid,
    email: participant.email,
    tableInfo,
    checkedIn: checkedIn.has(norm(participant.sid)),
    checkedInAt: checkedIn.get(norm(participant.sid))?.checkedInAt ?? null,
  };
}

function adminParticipant(participant, tableStore) {
  return {
    ...participant,
    tableInfo: tableStore.find(participant),
    checkedIn: checkedIn.has(norm(participant.sid)),
    checkedInAt: checkedIn.get(norm(participant.sid))?.checkedInAt ?? null,
  };
}

function findParticipantByQr(qr, bySid) {
  const sid = qr.mssv || qr.MSSV || qr.sid || qr.id || '';
  if (!sid) return null;
  const participant = bySid.get(norm(sid));
  if (!participant) return null;

  const qrName = norm(qr.name || qr.Name || '');
  if (qrName && qrName !== norm(participant.name)) {
    return { participant, nameMismatch: true };
  }

  return { participant, nameMismatch: false };
}

function findParticipantBySid(sid, bySid) {
  return bySid.get(norm(sid)) || null;
}

function tableRecordParticipant(record, tableStore) {
  if (!record) return null;
  return {
    uid: `table:${record.sid}`,
    name: record.name,
    sid: record.sid,
    email: record.email,
    tableInfo: tableStore.find(record),
    checkedIn: checkedIn.has(norm(record.sid)),
    checkedInAt: checkedIn.get(norm(record.sid))?.checkedInAt ?? null,
  };
}

function tableViews(tableStore) {
  return tableStore.tables().map(table => ({
    ...table,
    people: table.people.map(person => ({
      ...person,
      checkedIn: checkedIn.has(norm(person.sid)),
      checkedInAt: checkedIn.get(norm(person.sid))?.checkedInAt ?? null,
    })),
  }));
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function participantsCsv(registry, tableStore) {
  const headers = [
    'MSSV',
    'Name',
    'Email',
    'GVHD',
    'Class',
    'Table',
    'Checked In',
    'Checked In At',
  ];
  const rows = registry.map(participant => {
    const tableInfo = tableStore.find(participant);
    const checked = checkedIn.get(norm(participant.sid));
    return [
      participant.sid,
      participant.name,
      participant.email,
      participant.fields?.GVHD || '',
      participant.fields?.Class || '',
      tableInfo?.tableNumber || '',
      checked ? 'TRUE' : 'FALSE',
      checked?.checkedInAt || '',
    ];
  });

  return [headers, ...rows]
    .map(row => row.map(csvEscape).join(','))
    .join('\r\n');
}

async function main() {
  const tableStore = await TableStore.load();
  const registry = await buildRegistry(SECRET);
  const bySid = new Map(registry.map(p => [norm(p.sid), p]));

  app.get('/', (_, res) => {
    res.json({
      ok: true,
      event: 'SOICT Graduation Day Thanks Party',
      participants: registry.length,
      columns: PARTICIPANTS.headers || [],
    });
  });

  app.get('/admin', (_, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
  });

  app.get('/participants', requireKey, (_, res) => {
    res.json(registry.map(p => adminParticipant(p, tableStore)));
  });

  app.post('/checkin-simple', requireKey, (req, res) => {
    const found = findParticipantByQr(simpleQrData(req.body), bySid);
    if (!found?.participant) {
      return res.status(404).json({ error: 'Participant not found' });
    }

    const { participant, nameMismatch } = found;
    const checkedKey = norm(participant.sid);
    const alreadyCheckedIn = checkedIn.has(checkedKey);
    const checkedInAt = alreadyCheckedIn
      ? checkedIn.get(checkedKey).checkedInAt
      : new Date().toISOString();

    if (!alreadyCheckedIn) checkedIn.set(checkedKey, { checkedInAt });

    return res.json({
      success: true,
      alreadyCheckedIn,
      nameMismatch,
      participant: publicParticipant(participant, tableStore),
      checkedInAt,
    });
  });

  app.get('/checkin/stats', requireKey, (_, res) => {
    const arrived = registry.filter(participant => checkedIn.has(norm(participant.sid))).length;
    res.json({
      total: registry.length,
      arrived,
      remaining: registry.length - arrived,
    });
  });

  app.get('/qr-payloads', requireKey, (_, res) => {
    res.json(registry.map(p => ({
      name: p.name,
      mssv: p.sid,
      qrData: JSON.stringify({ name: p.name, mssv: p.sid }),
    })));
  });

  app.get('/api/admin/tables', (_, res) => {
    res.json({
      tables: tableViews(tableStore),
      participants: registry.map(p => publicParticipant(p, tableStore)),
    });
  });

  app.post('/api/admin/tables/move', async (req, res) => {
    const participant = findParticipantBySid(req.body?.mssv, bySid);
    if (!participant) return res.status(404).json({ error: 'Participant not found' });

    try {
      const tableInfo = await tableStore.upsert(participant, req.body?.tableNumber);
      res.json({ success: true, participant: publicParticipant(participant, tableStore), tableInfo });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/admin/tables/remove', async (req, res) => {
    const participant = findParticipantBySid(req.body?.mssv, bySid);
    if (!participant) return res.status(404).json({ error: 'Participant not found' });
    await tableStore.remove(participant.sid);
    res.json({ success: true, participant: publicParticipant(participant, tableStore) });
  });

  app.post('/api/admin/tables/swap', async (req, res) => {
    const first = findParticipantBySid(req.body?.mssv, bySid);
    const second = findParticipantBySid(req.body?.otherMssv, bySid);
    if (!first || !second) return res.status(404).json({ error: 'Participant not found' });

    try {
      const result = await tableStore.swap(first, second);
      res.json({ success: true, result });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/admin/checkins/reset', (_, res) => {
    checkedIn.clear();
    res.json({ success: true });
  });

  app.post('/api/admin/checkins/toggle', (req, res) => {
    const sid = req.body?.mssv;
    const participant = findParticipantBySid(sid, bySid);
    const tableRecord = participant ? null : tableStore.bySid.get(norm(sid));
    if (!participant && !tableRecord) return res.status(404).json({ error: 'Participant not found' });

    const shouldCheckIn = typeof req.body?.checkedIn === 'boolean'
      ? req.body.checkedIn
      : !checkedIn.has(norm(sid));

    if (shouldCheckIn) {
      checkedIn.set(norm(sid), { checkedInAt: new Date().toISOString() });
    } else {
      checkedIn.delete(norm(sid));
    }

    const resultParticipant = participant
      ? publicParticipant(participant, tableStore)
      : tableRecordParticipant(tableRecord, tableStore);

    res.json({
      success: true,
      participant: resultParticipant,
      checkedIn: resultParticipant.checkedIn,
      checkedInAt: resultParticipant.checkedInAt,
    });
  });

  app.get('/api/admin/participants.csv', (_, res) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="participants-checkin.csv"');
    res.send(`\uFEFF${participantsCsv(registry, tableStore)}`);
  });

  app.listen(PORT, () => {
    const assignedTables = registry.filter(p => tableStore.find(p)).length;
    console.log(`SOICT Party server running on port ${PORT}`);
    console.log(`  Participants loaded: ${registry.length}`);
    console.log(`  Table assignments loaded: ${assignedTables}`);
    console.log(`  CSV columns: ${PARTICIPANTS.headers?.join(', ') || 'none'}`);
    console.log(`  SECRET set: ${SECRET !== 'change-me-in-render-env' ? 'YES' : 'NO - set SECRET env var!'}`);
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
