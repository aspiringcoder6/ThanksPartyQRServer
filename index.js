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

const registry = buildRegistry(SECRET);
const byUid = new Map(registry.map(p => [p.uid, p]));

app.use(cors());
app.use(express.json());

// Pass as header: X-Api-Key: <SECRET>
function requireKey(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.key || '';
  if (key !== SECRET) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

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

app.post('/checkin', requireKey, (req, res) => {
  const { payload, sig } = req.body || {};

  if (!payload || !sig) {
    return res.status(400).json({ error: 'Missing payload or sig' });
  }

  const expected = hmacHex(SECRET, payload);
  if (!safeEqualHex(expected, sig)) {
    return res.status(403).json({ error: 'Invalid signature' });
  }

  let data;
  try {
    data = JSON.parse(payload);
  } catch {
    return res.status(400).json({ error: 'Malformed payload' });
  }

  const participant = byUid.get(data.uid);
  if (!participant) {
    return res.status(404).json({ error: 'Participant not found' });
  }

  if (checkedIn.has(data.uid)) {
    const info = checkedIn.get(data.uid);
    return res.status(409).json({
      error: 'already_checked_in',
      participant,
      checkedInAt: info.checkedInAt,
    });
  }

  const checkedInAt = new Date().toISOString();
  checkedIn.set(data.uid, { checkedInAt });

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
    qrData: buildQRPayload(SECRET, p),
  }));
  res.json(payloads);
});

app.listen(PORT, () => {
  console.log(`SOICT Party server running on port ${PORT}`);
  console.log(`  Participants loaded: ${registry.length}`);
  console.log(`  CSV columns: ${PARTICIPANTS.headers?.join(', ') || 'none'}`);
  console.log(`  SECRET set: ${SECRET !== 'change-me-in-render-env' ? 'YES' : 'NO - set SECRET env var!'}`);
});
