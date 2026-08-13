const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const {
  rollupSessions,
  readLocalLog,
  resolveDbPath
} = require('../src/main/providers/opencode/locallog');
const opencodeProvider = require('../src/main/providers/opencode');

test('rollupSessions aggregates by local day and sums tokens', () => {
  const dayA = new Date('2026-08-11T15:00:00').getTime();
  const dayB = new Date('2026-08-12T10:00:00').getTime();
  const daily = rollupSessions([
    {
      tokens_input: 100,
      tokens_cache_read: 50,
      tokens_output: 20,
      tokens_reasoning: 5,
      time_updated: dayA
    },
    {
      tokens_input: 10,
      tokens_cache_read: 0,
      tokens_output: 2,
      tokens_reasoning: 0,
      time_updated: dayA
    },
    {
      tokens_input: 7,
      tokens_cache_read: 3,
      tokens_output: 1,
      tokens_reasoning: 0,
      time_updated: dayB
    }
  ], Date.now());

  const keyA = 'opencode:2026-08-11';
  const keyB = 'opencode:2026-08-12';
  assert.ok(daily[keyA]);
  assert.equal(daily[keyA].input, 110);
  assert.equal(daily[keyA].cached, 50);
  assert.equal(daily[keyA].output, 27); // 20+5 + 2
  assert.equal(daily[keyA].total, 110 + 50 + 27);
  assert.equal(daily[keyB].total, 7 + 3 + 1);
});

test('opencode adapter enables localLog', () => {
  assert.equal(opencodeProvider.capabilities.localLog, true);
  assert.equal(typeof opencodeProvider.readLocalLog, 'function');
});

test('readLocalLog writes snapshot usageDaily for opencode days', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-db-'));
  const dbPath = path.join(dir, 'opencode.db');
  // Minimal sqlite file via node:sqlite if available
  let created = false;
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY,
        tokens_input INTEGER, tokens_output INTEGER, tokens_reasoning INTEGER,
        tokens_cache_read INTEGER, time_updated INTEGER, time_created INTEGER
      );
    `);
    const ts = new Date('2026-08-12T12:00:00').getTime();
    db.prepare(`
      INSERT INTO session (id, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, time_updated, time_created)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('s1', 100, 20, 5, 40, ts, ts);
    db.close();
    created = true;
  } catch (e) {
    // skip if no sqlite
  }

  if (!created) {
    fs.rmSync(dir, { recursive: true, force: true });
    return;
  }

  const storeData = { usageDaily: { 'opencode:2099-01-01': { total: 999 } }, 'data.historyDays': 365 };
  const store = {
    get(k) {
      if (k === 'providers.opencode.localLogRoot') return dbPath;
      if (k === 'usageDaily') return storeData.usageDaily;
      if (k === 'data.historyDays') return storeData['data.historyDays'];
      return undefined;
    },
    set(k, v) {
      if (k === 'usageDaily') storeData.usageDaily = v;
    }
  };

  try {
    assert.equal(resolveDbPath(store), dbPath);
    const records = await readLocalLog({ store }, { retainAll: true });
    assert.ok(records.length >= 1);
    assert.ok(storeData.usageDaily['opencode:2026-08-12']);
    assert.equal(storeData.usageDaily['opencode:2026-08-12'].input, 100);
    assert.equal(storeData.usageDaily['opencode:2026-08-12'].cached, 40);
    assert.equal(storeData.usageDaily['opencode:2026-08-12'].output, 25);
    // stale day removed
    assert.equal(storeData.usageDaily['opencode:2099-01-01'], undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
