// OpenCode Provider 适配器(accountQuota + localLog)。
// 凭证只读复用本机 OpenCode CLI auth.json;额度来自 OpenCode Go usage API;
// 本地 Token 用量来自 opencode.db session 表。
const { fetchQuota } = require('./quota');
const { readAuth } = require('./auth');
const { readLocalLog, DEFAULT_ROOT } = require('./locallog');

module.exports = {
  id: 'opencode',
  displayName: 'OpenCode',
  capabilities: {
    balance: false,
    webUsage: false,
    quota: true,
    localLog: true,
    realtimeProxy: false
  },

  authStatus() {
    const auth = readAuth();
    if (!auth || !auth.apiKey) return 'missing';
    return 'ok';
  },

  fetchQuota,

  localLogRoot(ctx) {
    return (ctx && ctx.store && ctx.store.get('providers.opencode.localLogRoot')) || DEFAULT_ROOT();
  },

  readLocalLog
};
