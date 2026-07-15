'use strict';

const express = require('express');
const cors = require('cors');
const {
  PARTICIPANTS,
  buildQRPayload,
  buildRegistry,
  hmacHex,
  safeEqualHex,
} = require('./qr-registry');

const app = express();
const PORT = process.env.PORT || 3000;

// Set the SECRET env var in Render's dashboard.
// All QR codes are signed with this key; the Android app uses the same key to
// verify scans before calling the check-in endpoint.
const SECRET = process.env.SECRET || 'change-me-in-render-env';

// Maps uid -> { checkedInAt: ISO string }.
// This resets on each redeploy, which is fine for a one-day event.
const checkedIn = new Map();

app.use(cors());
app.use(express.json());

// Pass as header: X-Api-Key: <SECRET>
function requireKey(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.key || '';
  if (key !== SECRET) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

function verifyScan(payload, sig) {
  if (!payload || !sig) {
    return { status: 400, body: { error: 'Missing payload or sig' } };
  }

  const expected = hmacHex(SECRET, payload);
  if (!safeEqualHex(expected, sig)) {
    return { status: 403, body: { error: 'Invalid signature' } };
  }

  try {
    return { data: JSON.parse(payload) };
  } catch {
    return { status: 400, body: { error: 'Malformed payload' } };
  }
}

async function main() {
  const registry = await buildRegistry(SECRET);
  const byUid = new Map(registry.map(p => [p.uid, p]));

  app.get('/', (_, res) => {
    res.json({
      ok: true,
      event: 'SOICT Graduation Day Thanks Party',
      participants: registry.length,
      columns: PARTICIPANTS.headers || [],
    });
  });

  app.get('/participants', requireKey, (_, res) => {
    const list = registry.map(p => ({
      ...p,
      checkedIn: checkedIn.has(p.uid),
      checkedInAt: checkedIn.get(p.uid)?.checkedInAt ?? null,
    }));
    res.json(list);
  });

  app.post('/scan/preview', requireKey, (req, res) => {
    const { payload, sig } = req.body || {};
    const verified = verifyScan(payload, sig);
    if (verified.status) return res.status(verified.status).json(verified.body);

    const participant = byUid.get(verified.data.uid);
    if (!participant) {
      return res.status(404).json({ error: 'Participant not found' });
    }

    return res.json({
      participant,
      checkedIn: checkedIn.has(participant.uid),
      checkedInAt: checkedIn.get(participant.uid)?.checkedInAt ?? null,
    });
  });

  app.post('/checkin', requireKey, (req, res) => {
    const { payload, sig } = req.body || {};
    const verified = verifyScan(payload, sig);
    if (verified.status) return res.status(verified.status).json(verified.body);

    const participant = byUid.get(verified.data.uid);
    if (!participant) {
      return res.status(404).json({ error: 'Participant not found' });
    }

    if (checkedIn.has(verified.data.uid)) {
      const info = checkedIn.get(verified.data.uid);
      return res.status(409).json({
        error: 'already_checked_in',
        participant,
        checkedInAt: info.checkedInAt,
      });
    }

    const checkedInAt = new Date().toISOString();
    checkedIn.set(verified.data.uid, { checkedInAt });

    return res.json({ success: true, participant, checkedInAt });
  });

  app.get('/checkin/stats', requireKey, (_, res) => {
    res.json({
      total: registry.length,
      arrived: checkedIn.size,
      remaining: registry.length - checkedIn.size,
    });
  });

  app.get('/qr-payloads', requireKey, (_, res) => {
    const payloads = registry.map(p => ({
      uid: p.uid,
      name: p.name,
      email: p.email,
      sid: p.sid,
      fields: p.fields,
      tableInfo: p.tableInfo,
      qrData: buildQRPayload(SECRET, p),
    }));
    res.json(payloads);
  });

  app.listen(PORT, () => {
    const assignedTables = registry.filter(p => p.tableInfo).length;
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
