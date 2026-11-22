/**
 * tsdown 配置：把 Client 半打包为 `lib/client.js`。
 *
 * DSH 宿主 Web 客户端不会用 import map / bundler 加载插件脚本，而是在启动时
 * 安装 `window.__ModuleLoader__`，插件脚本必须以「闭包工厂」形式注册自己：
 *
 *   window.__ModuleLoader__.load({ id: <包名>, factory: (require) => {
 *     var module = { exports: {} }; var exports = module.exports;
 *     ... 打包后的 CJS 代码（仅 require 宿主冻结模块表里的模块） ...
 *     return module.exports; } });
 *
 * 该契约由 harness 的 packages/client/tsdown.client.ts 定义；本配置必须与它
 * 字节级一致，否则设置面板会静默不加载（脚本能下载但永远不进 __DSH_BOOT__）。
 * React 走 external，由宿主运行时的冻结模块表在 factory(require) 里解析。
 */
import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsdown';

const pkgName = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
).name as string;

// 与 harness 契约逐字节一致：banner 开工厂 + module/exports 序言，footer 收尾。
const banner =
  `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkgName)}, factory: (require) => {\n` +
  `var module = { exports: {} }; var exports = module.exports;`;
const footer = `return module.exports; } });`;

export default defineConfig({
  entry: ['src/client/index.ts'],
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: false,
  clean: false,
  // 只有宿主冻结模块表里的模块可以作为 require() 请求；其余一律内联。
  // tsdown 0.22 起 external 已弃用，统一用 deps.neverBundle。
  deps: {
    neverBundle: [
      'react',
      'react/jsx-runtime',
      'react-dom',
      'react-dom/client',
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-client-store',
      '@deepseek-ai/dsh-client-ui-slots',
      '@deepseek-ai/dsh-client-ui-primitives',
      '@deepseek-ai/dsh-client-ui-dockkit',
    ],
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner,
    footer,
  },
});
