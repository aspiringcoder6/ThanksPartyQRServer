'use strict';

const express = require('express');
const cors = require('cors');
const { PARTICIPANTS, buildRegistry } = require('./qr-registry');
const { TableStore } = require('./table-store');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.SECRET || 'change-me-in-render-env';

const checkedIn = new Map();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

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
    checkedIn: checkedIn.has(participant.uid),
    checkedInAt: checkedIn.get(participant.uid)?.checkedInAt ?? null,
  };
}

function adminParticipant(participant, tableStore) {
  return {
    ...participant,
    tableInfo: tableStore.find(participant),
    checkedIn: checkedIn.has(participant.uid),
    checkedInAt: checkedIn.get(participant.uid)?.checkedInAt ?? null,
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

function adminPageHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>SOICT Party Admin</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #0f0f0f; color: #f3f4f6; font-family: Arial, sans-serif; }
    header { position: sticky; top: 0; z-index: 2; padding: 16px; background: #18181b; border-bottom: 1px solid #2f2f33; }
    h1 { margin: 0 0 12px; font-size: 20px; }
    .bar { display: flex; gap: 8px; flex-wrap: wrap; }
    input, button, select { border-radius: 8px; border: 1px solid #3f3f46; padding: 10px 12px; font: inherit; }
    input, select { background: #27272a; color: #f3f4f6; }
    button { background: #2563eb; color: white; border-color: #2563eb; cursor: pointer; }
    button.secondary { background: #27272a; border-color: #3f3f46; }
    button.danger { background: #b91c1c; border-color: #b91c1c; }
    main { padding: 16px; }
    .stats { color: #a1a1aa; margin: 0 0 14px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
    .card { border: 1px solid #2f2f33; border-radius: 8px; background: #18181b; overflow: hidden; }
    .card h2 { margin: 0; padding: 12px; font-size: 16px; background: #27272a; display: flex; justify-content: space-between; }
    .person { padding: 10px 12px; border-top: 1px solid #2f2f33; display: grid; grid-template-columns: 1fr auto; gap: 8px; }
    .name { font-weight: 700; }
    .meta { color: #a1a1aa; font-size: 12px; margin-top: 2px; }
    .status { margin-top: 10px; min-height: 20px; color: #93c5fd; }
  </style>
</head>
<body>
  <header>
    <h1>SOICT Party Table Admin</h1>
    <div class="bar">
      <input id="key" type="password" placeholder="Admin SECRET"/>
      <input id="mssv" placeholder="MSSV"/>
      <input id="table" placeholder="Table number"/>
      <button onclick="movePerson()">Add / move</button>
      <button class="secondary" onclick="removePerson()">Remove from table</button>
      <button class="danger" onclick="resetCheckins()">Reset check-ins</button>
      <button class="secondary" onclick="loadTables()">Refresh</button>
    </div>
    <div class="status" id="status"></div>
  </header>
  <main>
    <div class="stats" id="stats"></div>
    <div class="grid" id="tables"></div>
  </main>
  <script>
    const keyInput = document.getElementById('key');
    keyInput.value = localStorage.adminKey || '';
    keyInput.addEventListener('input', () => localStorage.adminKey = keyInput.value);
    const statusEl = document.getElementById('status');
    const tablesEl = document.getElementById('tables');
    const statsEl = document.getElementById('stats');

    function headers() {
      return { 'Content-Type': 'application/json', 'X-Api-Key': keyInput.value };
    }
    function status(msg) { statusEl.textContent = msg; }
    async function api(path, options = {}) {
      const res = await fetch(path, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Request failed');
      return data;
    }
    async function loadTables() {
      try {
        status('Loading...');
        const data = await api('/api/admin/tables');
        statsEl.textContent = data.participants.length + ' participants | ' + data.tables.length + ' tables';
        tablesEl.innerHTML = data.tables.map(table => '<section class="card"><h2><span>Table ' + table.tableNumber + '</span><span>' + table.tableSize + '</span></h2>' +
          table.people.map(p => '<div class="person"><div><div class="name">' + esc(p.name) + '</div><div class="meta">' + esc(p.sid) + ' | ' + esc(p.email || '') + '</div></div><button class="secondary" onclick="fillPerson(\\'' + escAttr(p.sid) + '\\', \\'' + escAttr(table.tableNumber) + '\\')">Edit</button></div>').join('') +
          '</section>').join('');
        status('Ready');
      } catch (err) { status(err.message); }
    }
    function fillPerson(sid, table) {
      document.getElementById('mssv').value = sid;
      document.getElementById('table').value = table;
    }
    async function movePerson() {
      try {
        const mssv = document.getElementById('mssv').value;
        const tableNumber = document.getElementById('table').value;
        await api('/api/admin/tables/move', { method: 'POST', body: JSON.stringify({ mssv, tableNumber }) });
        await loadTables();
      } catch (err) { status(err.message); }
    }
    async function removePerson() {
      try {
        const mssv = document.getElementById('mssv').value;
        if (!mssv) return status('Enter MSSV first');
        await api('/api/admin/tables/remove', { method: 'POST', body: JSON.stringify({ mssv }) });
        await loadTables();
      } catch (err) { status(err.message); }
    }
    async function resetCheckins() {
      if (!confirm('Reset all check-in status? This cannot be undone.')) return;
      try {
        await api('/api/admin/checkins/reset', { method: 'POST', body: '{}' });
        status('Check-ins reset');
      } catch (err) { status(err.message); }
    }
    function esc(value) {
      return String(value || '').replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
    }
    function escAttr(value) {
      return esc(value).replace(/'/g, '&#39;');
    }
    loadTables();
  </script>
</body>
</html>`;
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
    res.type('html').send(adminPageHtml());
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
    const alreadyCheckedIn = checkedIn.has(participant.uid);
    const checkedInAt = alreadyCheckedIn
      ? checkedIn.get(participant.uid).checkedInAt
      : new Date().toISOString();

    if (!alreadyCheckedIn) checkedIn.set(participant.uid, { checkedInAt });

    return res.json({
      success: true,
      alreadyCheckedIn,
      nameMismatch,
      participant: publicParticipant(participant, tableStore),
      checkedInAt,
    });
  });

  app.get('/checkin/stats', requireKey, (_, res) => {
    res.json({
      total: registry.length,
      arrived: checkedIn.size,
      remaining: registry.length - checkedIn.size,
    });
  });

  app.get('/qr-payloads', requireKey, (_, res) => {
    res.json(registry.map(p => ({
      name: p.name,
      mssv: p.sid,
      qrData: JSON.stringify({ name: p.name, mssv: p.sid }),
    })));
  });

  app.get('/api/admin/tables', requireKey, (_, res) => {
    res.json({
      tables: tableStore.tables(),
      participants: registry.map(p => publicParticipant(p, tableStore)),
    });
  });

  app.post('/api/admin/tables/move', requireKey, async (req, res) => {
    const participant = findParticipantBySid(req.body?.mssv, bySid);
    if (!participant) return res.status(404).json({ error: 'Participant not found' });

    try {
      const tableInfo = await tableStore.upsert(participant, req.body?.tableNumber);
      res.json({ success: true, participant: publicParticipant(participant, tableStore), tableInfo });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/admin/tables/remove', requireKey, async (req, res) => {
    const participant = findParticipantBySid(req.body?.mssv, bySid);
    if (!participant) return res.status(404).json({ error: 'Participant not found' });
    await tableStore.remove(participant.sid);
    res.json({ success: true, participant: publicParticipant(participant, tableStore) });
  });

  app.post('/api/admin/checkins/reset', requireKey, (_, res) => {
    checkedIn.clear();
    res.json({ success: true });
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
