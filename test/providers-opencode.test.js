const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { pickEntry, readAuth } = require('../src/main/providers/opencode/auth');
const {
  normalizeGoUsage,
  mapWindow,
  windowKind,
  parseResetsAt
} = require('../src/main/providers/opencode/quota');
const opencodeProvider = require('../src/main/providers/opencode');

test('pickEntry prefers opencode-go over zen', () => {
  const entry = pickEntry({
    opencode: { type: 'api', key: 'sk-zen' },
    'opencode-go': { type: 'api', key: 'sk-go' }
  });
  assert.equal(entry.provider, 'opencode-go');
  assert.equal(entry.apiKey, 'sk-go');
});

test('pickEntry falls back to zen key', () => {
  const entry = pickEntry({ opencode: { type: 'api', key: 'sk-zen' } });
  assert.equal(entry.provider, 'opencode');
  assert.equal(entry.apiKey, 'sk-zen');
});

test('readAuth loads local auth.json fixture path', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-auth-'));
  const authPath = path.join(dir, 'auth.json');
  fs.writeFileSync(authPath, JSON.stringify({
    'opencode-go': { type: 'api', key: 'sk-test-go' }
  }));
  try {
    const auth = readAuth(authPath);
    assert.equal(auth.apiKey, 'sk-test-go');
    assert.equal(auth.providerKey, 'opencode-go');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('windowKind maps rolling/weekly/monthly', () => {
  assert.equal(windowKind('rolling'), '5h');
  assert.equal(windowKind('weekly'), 'weekly');
  assert.equal(windowKind('monthly'), 'monthly');
});

test('parseResetsAt accepts ISO and epoch', () => {
  const iso = parseResetsAt('2026-08-12T12:34:06.052Z');
  assert.equal(iso, Date.parse('2026-08-12T12:34:06.052Z'));
  assert.equal(parseResetsAt(1700000000), 1700000000 * 1000);
  assert.equal(parseResetsAt(1700000000000), 1700000000000);
});

test('mapWindow normalizes percent to used/remaining on 100 scale', () => {
  const w = mapWindow('rolling', {
    status: 'ok',
    percent: 29,
    resetsAt: '2026-08-12T12:34:06.052Z'
  });
  assert.equal(w.kind, '5h');
  assert.equal(w.used, 29);
  assert.equal(w.limit, 100);
  assert.equal(w.remaining, 71);
  assert.equal(w.name, '5 小时窗口');
});

test('normalizeGoUsage builds three subscription windows', () => {
  const state = normalizeGoUsage({
    usage: {
      rolling: { status: 'ok', percent: 29, resetsAt: '2026-08-12T12:34:06.052Z' },
      weekly: { status: 'ok', percent: 44, resetsAt: '2026-08-17T00:00:00.052Z' },
      monthly: { status: 'ok', percent: 22, resetsAt: '2026-09-11T10:19:44.052Z' }
    }
  });
  assert.equal(state.provider, 'opencode');
  assert.equal(state.billingMode, 'subscription');
  assert.equal(state.planName, 'OpenCode Go');
  assert.equal(state.windows.length, 3);
  assert.deepEqual(state.windows.map((w) => w.kind), ['5h', 'weekly', 'monthly']);
  assert.equal(state.windows[0].remaining, 71);
  assert.equal(state.windows[1].used, 44);
  assert.equal(state.windows[2].used, 22);
});

test('opencode provider adapter shape', () => {
  assert.equal(opencodeProvider.id, 'opencode');
  assert.equal(opencodeProvider.displayName, 'OpenCode');
  assert.equal(opencodeProvider.capabilities.quota, true);
  assert.equal(opencodeProvider.capabilities.localLog, true);
  assert.equal(typeof opencodeProvider.fetchQuota, 'function');
  assert.equal(typeof opencodeProvider.authStatus, 'function');
});
