// OpenCode 凭证:只读复用 ~/.local/share/opencode/auth.json(Windows 同 XDG 路径)。
// 支持 opencode-go(订阅额度)与 opencode(Zen API Key)两种条目;优先 Go。
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_AUTH_PATH = () => path.join(os.homedir(), '.local', 'share', 'opencode', 'auth.json');

// 兼容旧路径:部分安装可能写在 %APPDATA%/opencode 或 ~/.config/opencode
function candidatePaths() {
  const home = os.homedir();
  const list = [DEFAULT_AUTH_PATH()];
  if (process.env.XDG_DATA_HOME) {
    list.push(path.join(process.env.XDG_DATA_HOME, 'opencode', 'auth.json'));
  }
  if (process.env.APPDATA) {
    list.push(path.join(process.env.APPDATA, 'opencode', 'auth.json'));
  }
  list.push(path.join(home, '.config', 'opencode', 'auth.json'));
  list.push(path.join(home, '.opencode', 'auth.json'));
  return list;
}

function pickEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  // 优先 OpenCode Go 订阅(有 5h/周/月额度窗口)
  const go = raw['opencode-go'] || raw.opencodeGo || raw.go;
  if (go && (go.key || go.apiKey || go.api_key)) {
    return {
      provider: 'opencode-go',
      type: go.type || 'api',
      apiKey: go.key || go.apiKey || go.api_key
    };
  }
  const zen = raw.opencode || raw.zen || raw['opencode-zen'];
  if (zen && (zen.key || zen.apiKey || zen.api_key)) {
    return {
      provider: 'opencode',
      type: zen.type || 'api',
      apiKey: zen.key || zen.apiKey || zen.api_key
    };
  }
  // 兜底:取第一个带 key 的条目
  const keys = Object.keys(raw);
  for (let i = 0; i < keys.length; i++) {
    const entry = raw[keys[i]];
    if (entry && (entry.key || entry.apiKey || entry.api_key)) {
      return {
        provider: keys[i],
        type: entry.type || 'api',
        apiKey: entry.key || entry.apiKey || entry.api_key
      };
    }
  }
  return null;
}

function readAuth(authPath) {
  const paths = authPath ? [authPath] : candidatePaths();
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i];
    try {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      const entry = pickEntry(raw);
      if (entry && entry.apiKey) {
        return {
          apiKey: entry.apiKey,
          providerKey: entry.provider,
          type: entry.type,
          authPath: p
        };
      }
    } catch (e) {
      /* try next path */
    }
  }
  return null;
}

module.exports = { readAuth, pickEntry, DEFAULT_AUTH_PATH, candidatePaths };
