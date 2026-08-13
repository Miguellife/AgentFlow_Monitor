// Codex 账户额度采集:GET https://chatgpt.com/backend-api/wham/usage(需代理)。
// 凭证只读(CLI 自己保活刷新,见 auth.js 头注);401 由上层判 expired。
const { readAuth } = require('./auth');
const { makeQuotaState } = require('../types');

// windows 换算规则:18000s→'5h',604800s→'weekly',其他按秒数推断为 'limit'。
function windowKind(seconds) {
  const sec = Number(seconds) || 0;
  if (sec === 18000) return '5h';
  if (sec === 604800) return 'weekly';
  // 约 30 天窗口(OpenAI 偶发用 2592000 / 2419200)
  if (sec >= 2419200 && sec <= 2764800) return 'monthly';
  // 容差:4.5h~5.5h 也认作 5h;6~8 天认作 weekly
  if (sec >= 16200 && sec <= 19800) return '5h';
  if (sec >= 518400 && sec <= 691200) return 'weekly';
  return 'limit';
}

function defaultWindowName(kind) {
  if (kind === '5h') return '5 小时窗口';
  if (kind === 'weekly') return '本周额度';
  if (kind === 'monthly') return '本月额度';
  return null;
}

// used_percent 语义:即"已用百分比"。
// limit 归一为 100,剩余 = 100 - used_percent。
// (曾按"剩余"理解,会导致未使用的窗口被误显示为耗尽斜纹条)
// name 保留限额名称(如 additional_rate_limits 的 "GPT-5.3-Codex-Spark");
// 主窗口与未命名窗口用 defaultWindowName 兜底(本周额度/5 小时窗口/本月额度)。
function mapWindow(w, name) {
  const used = Math.min(100, Math.max(0, Number(w.used_percent) || 0));
  const limit = 100;
  let resetsAt = null;
  if (w.reset_at) resetsAt = Number(w.reset_at) * 1000;
  else if (w.reset_after_seconds) resetsAt = Date.now() + Number(w.reset_after_seconds) * 1000;
  else resetsAt = Date.now();
  const kind = windowKind(Number(w.limit_window_seconds));
  return {
    kind: kind,
    name: name || defaultWindowName(kind),
    used: used,
    limit: limit,
    remaining: limit - used,
    resetsAt: resetsAt
  };
}

// 归一化 wham/usage 响应(纯函数)。处理 secondary_window:null、additional_rate_limits[] 合并进 windows(保留 limit_name)。
function normalizeWhamUsage(data) {
  const windows = [];
  const rate = data && data.rate_limit;
  if (rate && rate.primary_window) windows.push(mapWindow(rate.primary_window));
  if (rate && rate.secondary_window) windows.push(mapWindow(rate.secondary_window));
  ((data && data.additional_rate_limits) || []).forEach(function (limit) {
    if (limit && limit.rate_limit && limit.rate_limit.primary_window) {
      windows.push(mapWindow(limit.rate_limit.primary_window, limit.limit_name));
    }
  });

  let balance = null;
  if (data && data.credits && data.credits.has_credits) {
    balance = { total: Number(data.credits.balance) || 0, granted: null, toppedUp: null, currency: 'USD' };
  }

  return makeQuotaState(
    'codex',
    'subscription',
    windows,
    balance,
    (data && data.plan_type) || null,
    null,
    Date.now()
  );
}

async function fetchQuota(ctx) {
  const auth = readAuth();
  if (!auth || !auth.accessToken) return null;
  const data = await ctx.httpGet('https://chatgpt.com/backend-api/wham/usage', {
    'Authorization': 'Bearer ' + auth.accessToken,
    'ChatGPT-Account-Id': auth.accountId,
    'User-Agent': 'codex_cli_rs/0.46.0'
  }, ctx.getProxyUrl());
  return normalizeWhamUsage(data);
}

module.exports = { normalizeWhamUsage, fetchQuota, mapWindow, windowKind, defaultWindowName };
