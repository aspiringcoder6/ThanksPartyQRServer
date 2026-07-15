'use strict';

const fs = require('fs/promises');
const path = require('path');
const { loadLayout, normalizeEmail, normalizeId } = require('./layout');

const STORE_PATH = process.env.TABLE_ASSIGNMENTS_JSON
  ? path.resolve(process.env.TABLE_ASSIGNMENTS_JSON)
  : path.join(__dirname, 'table-assignments.json');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeTable(value) {
  return String(value || '').trim();
}

function withSizes(records) {
  const counts = new Map();
  for (const record of records) {
    counts.set(record.tableNumber, (counts.get(record.tableNumber) || 0) + 1);
  }
  return records.map(record => ({
    ...record,
    tableLabel: `Table ${record.tableNumber}`,
    tableSize: counts.get(record.tableNumber) || 0,
  }));
}

function sortRecords(records) {
  return records.sort((a, b) => {
    const ta = Number(a.tableNumber);
    const tb = Number(b.tableNumber);
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
    if (a.tableNumber !== b.tableNumber) return a.tableNumber.localeCompare(b.tableNumber);
    return (a.name || '').localeCompare(b.name || '');
  });
}

class TableStore {
  constructor(records) {
    this.records = sortRecords(withSizes(records));
    this.reindex();
  }

  static async load() {
    try {
      const stored = JSON.parse(await fs.readFile(STORE_PATH, 'utf8'));
      return new TableStore(Array.isArray(stored.records) ? stored.records : []);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      const layout = await loadLayout();
      const store = new TableStore(layout.records || []);
      await store.save();
      return store;
    }
  }

  reindex() {
    this.records = sortRecords(withSizes(this.records));
    this.bySid = new Map();
    this.byEmail = new Map();
    for (const record of this.records) {
      if (record.sid) this.bySid.set(normalizeId(record.sid), record);
      if (record.email) this.byEmail.set(normalizeEmail(record.email), record);
    }
  }

  async save() {
    await fs.writeFile(STORE_PATH, `${JSON.stringify({ records: this.records }, null, 2)}\n`);
  }

  find(participant) {
    return this.bySid.get(normalizeId(participant.sid))
      || this.byEmail.get(normalizeEmail(participant.email))
      || null;
  }

  tables() {
    const grouped = new Map();
    for (const record of this.records) {
      if (!grouped.has(record.tableNumber)) grouped.set(record.tableNumber, []);
      grouped.get(record.tableNumber).push(clone(record));
    }
    return [...grouped.entries()].map(([tableNumber, people]) => ({
      tableNumber,
      tableLabel: `Table ${tableNumber}`,
      tableSize: people.length,
      people,
    }));
  }

  async remove(sid) {
    const key = normalizeId(sid);
    const before = this.records.length;
    this.records = this.records.filter(record => normalizeId(record.sid) !== key);
    if (this.records.length === before) return null;
    this.reindex();
    await this.save();
    return true;
  }

  async upsert(participant, tableNumber) {
    const normalizedTable = normalizeTable(tableNumber);
    if (!normalizedTable) throw new Error('Table number is required');

    await this.remove(participant.sid);
    this.records.push({
      tableNumber: normalizedTable,
      tableLabel: `Table ${normalizedTable}`,
      name: participant.name,
      sid: participant.sid,
      email: participant.email,
      className: participant.fields?.Class || participant.fields?.Lớp || '',
    });
    this.reindex();
    await this.save();
    return this.find(participant);
  }
}

module.exports = {
  TableStore,
};
