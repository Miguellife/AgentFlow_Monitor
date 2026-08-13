// OpenCode Go 额度:GET https://opencode.ai/zen/go/v1/usage
// 响应示例:
// { usage: { rolling:{status,percent,resetsAt}, weekly:{...}, monthly:{...} } }
// percent = 已用百分比;limit 归一到 100(与 Codex used_percent 一致)。
const { readAuth } = require('./auth');
const { makeQuotaState } = require('../types');

const GO_USAGE_URL = 'https://opencode.ai/zen/go/v1/usage';

function parseResetsAt(value) {
  if (value == null || value === '') return Date.now();
  if (typeof value === 'number') {
    // 秒级时间戳 → ms
    return value < 1e12 ? value * 1000 : value;
  }
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : Date.now();
}

// rolling ≈ 5 小时滚动窗;weekly / monthly 按名映射
function windowKind(key) {
  const k = String(key || '').toLowerCase();
  if (k === 'rolling' || k === '5h' || k === 'five_hour' || k === 'fivehour') return '5h';
  if (k === 'weekly' || k === 'week') return 'weekly';
  if (k === 'monthly' || k === 'month') return 'monthly';
  return 'limit';
}

function windowName(kind, key) {
  if (kind === '5h') return '5 小时窗口';
  if (kind === 'weekly') return '本周额度';
  if (kind === 'monthly') return '本月额度';
  return key || null;
}

function mapWindow(key, w) {
  if (!w || typeof w !== 'object') return null;
  const used = Math.min(100, Math.max(0, Number(w.percent != null ? w.percent : w.used_percent) || 0));
  const limit = 100;
  const kind = windowKind(key);
  return {
    kind: kind,
    name: windowName(kind, key),
    used: used,
    limit: limit,
    remaining: limit - used,
    resetsAt: parseResetsAt(w.resetsAt != null ? w.resetsAt : w.reset_at || w.resetAt)
  };
}

// 归一化 Go usage 响应(纯函数,便于单测)
function normalizeGoUsage(data) {
  const usage = (data && data.usage) || data || {};
  const order = ['rolling', 'weekly', 'monthly'];
  const windows = [];
  const seen = Object.create(null);

  order.forEach(function (key) {
    if (usage[key]) {
      const win = mapWindow(key, usage[key]);
      if (win) {
        windows.push(win);
        seen[key] = true;
      }
    }
  });

  Object.keys(usage).forEach(function (key) {
    if (seen[key]) return;
    if (!usage[key] || typeof usage[key] !== 'object') return;
    if (usage[key].percent == null && usage[key].used_percent == null) return;
    const win = mapWindow(key, usage[key]);
    if (win) windows.push(win);
  });

  return makeQuotaState(
    'opencode',
    'subscription',
    windows,
    null,
    'OpenCode Go',
    null,
    Date.now()
  );
}

async function fetchQuota(ctx) {
  const auth = readAuth();
  if (!auth || !auth.apiKey) return null;
  // 仅 Go 密钥走订阅额度接口;纯 Zen 密钥暂无公开额度 API
  if (auth.providerKey && auth.providerKey !== 'opencode-go' && auth.providerKey !== 'go') {
    return makeQuotaState('opencode', 'prepaid', [], null, 'OpenCode Zen', null, Date.now());
  }
  const data = await ctx.httpGet(GO_USAGE_URL, {
    Authorization: 'Bearer ' + auth.apiKey,
    Accept: 'application/json',
    'User-Agent': 'agentflow-monitor/1.0'
  }, ctx.getProxyUrl());
  return normalizeGoUsage(data);
}

module.exports = {
  fetchQuota,
  normalizeGoUsage,
  mapWindow,
  windowKind,
  parseResetsAt,
  GO_USAGE_URL
};
