// 后台启动 Electron:关闭终端窗口后应用继续运行(适合日常使用)。
// 用法: npm run start:bg
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
const electronCli = path.join(
  root,
  'node_modules',
  'electron',
  'cli.js'
);

if (!fs.existsSync(electronCli)) {
  console.error('未找到 electron,请先执行: npm ci && npm approve-scripts electron koffi');
  process.exit(1);
}

// 先构建 renderer(与 npm start 的 prestart 一致)
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const build = spawn(npmCmd, ['run', 'build:renderer'], {
  cwd: root,
  stdio: 'inherit',
  shell: true
});

build.on('exit', (code) => {
  if (code !== 0) {
    console.error('renderer 构建失败,退出码', code);
    process.exit(code || 1);
  }

  const child = spawn(process.execPath, [electronCli, '.'], {
    cwd: root,
    detached: true,
    stdio: 'ignore',
    env: process.env,
    windowsHide: true
  });
  child.unref();
  console.log('AgentFlow Monitor 已在后台启动(托盘常驻)。可关闭此终端。');
  process.exit(0);
});
