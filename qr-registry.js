'use strict';

const crypto = require('crypto');
const PARTICIPANTS = require('./participants');

function makeUid(secret, index, participant) {
  const key = participant.email
    || participant.sid
    || participant.name
    || JSON.stringify(participant.fields);

  return crypto.createHmac('sha256', secret)
    .update(`${index}:${key}`)
    .digest('hex')
    .slice(0, 24);
}

function buildRegistry(secret) {
  return PARTICIPANTS.map((participant, index) => ({
    ...participant.fields,
    uid: makeUid(secret, index, participant),
    rowNumber: participant.rowNumber,
    fields: participant.fields,
    name: participant.name,
    sid: participant.sid,
    phone: participant.phone,
    email: participant.email,
  }));
}

function hmacHex(secret, data) {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

function safeEqualHex(a, b) {
  if (!/^[a-f0-9]{64}$/i.test(a) || !/^[a-f0-9]{64}$/i.test(b)) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

function buildQRPayload(secret, participant) {
  const payload = JSON.stringify({ ...participant.fields, uid: participant.uid });
  return JSON.stringify({ payload, sig: hmacHex(secret, payload) });
}

module.exports = {
  PARTICIPANTS,
  buildQRPayload,
  buildRegistry,
  hmacHex,
  safeEqualHex,
};
