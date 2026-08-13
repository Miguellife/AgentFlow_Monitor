// OpenCode 本地用量:只读 ~/.local/share/opencode/opencode.db 的 session 表。
// session 存的是会话累计 token,每次全量按日聚合后覆盖 usageDaily['opencode:YYYY-MM-DD']
// (不累加,避免重复计数)。优先 node:sqlite,不可用时回退 sql.js。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { filterUsageDaily } = require('../../core/usage-retention');

const DEFAULT_DB_PATH = () => path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
const DEFAULT_ROOT = () => path.dirname(DEFAULT_DB_PATH());

const SESSION_SQL = `
  SELECT tokens_input, tokens_output, tokens_reasoning, tokens_cache_read,
         time_updated, time_created
  FROM session
`;

function candidateDbPaths() {
  const list = [DEFAULT_DB_PATH()];
  if (process.env.XDG_DATA_HOME) {
    list.push(path.join(process.env.XDG_DATA_HOME, 'opencode', 'opencode.db'));
  }
  if (process.env.APPDATA) {
    list.push(path.join(process.env.APPDATA, 'opencode', 'opencode.db'));
  }
  list.push(path.join(os.homedir(), '.config', 'opencode', 'opencode.db'));
  return list;
}

function resolveDbPath(store) {
  const override = store && store.get('providers.opencode.localLogRoot');
  if (override) {
    try {
      if (fs.existsSync(override) && fs.statSync(override).isFile()) return override;
    } catch (e) { /* fall through */ }
    return path.join(override, 'opencode.db');
  }
  const paths = candidateDbPaths();
  for (let i = 0; i < paths.length; i++) {
    try {
      if (fs.existsSync(paths[i])) return paths[i];
    } catch (e) { /* next */ }
  }
  return paths[0];
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function localDayStr(tsMs) {
  const d = new Date(tsMs);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

// 纯函数:session 行 → 按日聚合 { 'opencode:date': {input,cached,output,total} }
function rollupSessions(rows, nowMs) {
  const daily = Object.create(null);
  const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  (rows || []).forEach(function (row) {
    const ts = Number(row.time_updated || row.time_created) || 0;
    if (!ts || ts < Date.UTC(2000, 0, 1) || ts > now + 86400000) return;
    const input = Number(row.tokens_input) || 0;
    const cached = Number(row.tokens_cache_read) || 0;
    const output = (Number(row.tokens_output) || 0) + (Number(row.tokens_reasoning) || 0);
    const total = input + cached + output;
    if (total <= 0 && input <= 0 && output <= 0) return;
    const key = 'opencode:' + localDayStr(ts);
    const prev = daily[key] || { input: 0, cached: 0, output: 0, total: 0 };
    daily[key] = {
      input: prev.input + input,
      cached: prev.cached + cached,
      output: prev.output + output,
      total: prev.total + total
    };
  });
  return daily;
}

function readWithNodeSqlite(dbPath) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare(SESSION_SQL).all();
  } finally {
    try { db.close(); } catch (e) { /* ignore */ }
  }
}

function readWithSqlJs(dbPath) {
  // sql.js 是同步 WASM API,但 init 可能返回 Promise——这里用已缓存的同步实例。
  // 首次调用前必须 await ensureSqlJs().
  if (!readWithSqlJs._SQL) {
    throw new Error('sql.js not initialized');
  }
  const SQL = readWithSqlJs._SQL;
  const fileBuffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(fileBuffer);
  try {
    const result = db.exec(SESSION_SQL);
    if (!result || !result[0]) return [];
    const cols = result[0].columns;
    return result[0].values.map(function (vals) {
      const row = {};
      cols.forEach(function (c, i) { row[c] = vals[i]; });
      return row;
    });
  } finally {
    try { db.close(); } catch (e) { /* ignore */ }
  }
}

let sqlJsInit = null;
function ensureSqlJs() {
  if (readWithSqlJs._SQL) return Promise.resolve(readWithSqlJs._SQL);
  if (sqlJsInit) return sqlJsInit;
  sqlJsInit = Promise.resolve()
    .then(function () { return require('sql.js'); })
    .then(function (initSqlJs) {
      const init = initSqlJs && initSqlJs.default ? initSqlJs.default : initSqlJs;
      // Locate wasm next to package
      let wasmPath = null;
      try {
        // sql.js exports only dist entry; derive package root from resolved module path
        const resolved = require.resolve('sql.js');
        wasmPath = path.join(path.dirname(resolved), 'sql-wasm.wasm');
        if (!fs.existsSync(wasmPath)) {
          wasmPath = path.join(path.dirname(resolved), '..', 'dist', 'sql-wasm.wasm');
        }
      } catch (e) { /* optional */ }
      return init(wasmPath && fs.existsSync(wasmPath)
        ? { locateFile: function () { return wasmPath; } }
        : undefined);
    })
    .then(function (SQL) {
      readWithSqlJs._SQL = SQL;
      return SQL;
    })
    .catch(function (err) {
      sqlJsInit = null;
      throw err;
    });
  return sqlJsInit;
}

async function readSessionRows(dbPath) {
  if (!dbPath || !fs.existsSync(dbPath)) return [];
  try {
    return readWithNodeSqlite(dbPath);
  } catch (e1) {
    try {
      await ensureSqlJs();
      return readWithSqlJs(dbPath);
    } catch (e2) {
      return [];
    }
  }
}

async function readLocalLog(ctx, opts) {
  const store = ctx && ctx.store;
  const requestedNowMs = opts && opts.nowMs;
  const parsedNowMs = Number(requestedNowMs);
  const nowMs = requestedNowMs !== null
    && requestedNowMs !== undefined
    && Number.isFinite(parsedNowMs)
    ? parsedNowMs
    : Date.now();

  const dbPath = resolveDbPath(store);
  const rows = await readSessionRows(dbPath);
  let daily = rollupSessions(rows, nowMs);
  if (!(opts && opts.retainAll)) {
    daily = filterUsageDaily(daily, store && store.get('data.historyDays'), nowMs);
  }

  if (store) {
    const usageDaily = store.get('usageDaily') || {};
    Object.keys(usageDaily).forEach(function (key) {
      if (key.indexOf('opencode:') === 0) delete usageDaily[key];
    });
    Object.keys(daily).forEach(function (key) {
      usageDaily[key] = daily[key];
    });
    store.set('usageDaily', usageDaily);
  }

  return Object.keys(daily).map(function (key) {
    const day = key.slice('opencode:'.length);
    const u = daily[key];
    return {
      provider: 'opencode',
      date: day,
      model: 'opencode',
      inputTokens: u.input,
      outputTokens: u.output,
      cachedTokens: u.cached,
      cost: 0,
      currency: 'USD',
      ts: new Date(day + 'T12:00:00').getTime()
    };
  });
}

module.exports = {
  readLocalLog,
  rollupSessions,
  resolveDbPath,
  DEFAULT_ROOT,
  DEFAULT_DB_PATH,
  candidateDbPaths
};
