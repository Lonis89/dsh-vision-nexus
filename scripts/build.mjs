/**
 * dsh-vision-nexus 构建编排
 * ============================================================
 * 与 DSH 标准插件一致：`tsc`（Host/Client TS → lib/*.js）后由 `tsdown`
 * 把 Client 入口打包成宿主可识别的 `window.__ModuleLoader__.load` 工厂
 * （`lib/client.js`）。React 走 external，由 `dsh.client.inject` 运行时提供。
 *
 * 本脚本顺序执行两步并校验产物存在与 Client 包装格式；不手写模块包装（交给
 * tsdown 的 banner/footer 输出，与 DSH harness 的 __ModuleLoader__ 契约对齐）。
 * 发布时执行 `npm run build`（Node ^22.19 || >=24）。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const lib = path.join(root, 'lib');

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    console.error(`[dsh-vision-nexus] 构建步骤失败：${cmd} ${args.join(' ')} (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
}

function main() {
  // 1) TypeScript 编译（Host + Client 源码）。
  run('tsc', ['-p', 'tsconfig.json']);
  // 2) tsdown 打包 Client 半 → lib/client.js（__ModuleLoader__ 工厂）。
  run('tsdown', ['--config', 'tsdown.config.ts']);
  // 3) 校验关键产物。
  const required = [
    path.join(lib, 'index.js'),
    path.join(lib, 'client.js'),
  ];
  const missing = required.filter((p) => !existsSync(p));
  if (missing.length) {
    console.error('[dsh-vision-nexus] 缺少构建产物：', missing.join(', '));
    process.exit(1);
  }

  // 4) 校验 Client 半的 __ModuleLoader__ 包装契约（防止退回成普通 ESM 而静默不加载）。
  const clientSrc = readFileSync(path.join(lib, 'client.js'), 'utf8');
  const pkgName = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).name;
  const contract = [
    [new RegExp(`window\\.__ModuleLoader__\\.load\\s*\\(\\s*\\{[\\s\\S]*?id\\s*:\\s*${JSON.stringify(pkgName)}`), 'loader.load(id)'],
    [/factory\s*:\s*\(require\)\s*=>/, 'factory(require)'],
    [/var module\s*=\s*\{\s*exports\s*:\s*\{\s*\}\s*\}/, 'module init'],
    [/var exports\s*=\s*module\.exports/, 'exports alias'],
    [/return module\.exports\s*;/, 'return module.exports'],
  ];
  const broken = contract.filter(([re]) => !re.test(clientSrc)).map(([, label]) => label);
  if (broken.length) {
    console.error('[dsh-vision-nexus] lib/client.js 缺少 __ModuleLoader__ 包装契约：', broken.join(', '));
    console.error('[dsh-vision-nexus] 请检查 tsdown.config.ts 的 format=cjs 与 banner/footer 配置。');
    process.exit(1);
  }

  console.log('[dsh-vision-nexus] 构建完成：lib/index.js + lib/client.js 就绪（Client 包装契约校验通过）。');
}

main();
