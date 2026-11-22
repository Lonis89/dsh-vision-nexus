/**
 * Client 包装契约测试：确保 lib/client.js 是 DSH 可加载的 __ModuleLoader__ 工厂，
 * 且能在模拟宿主里真正执行并导出 name/apply/inject。防止退回普通 ESM 而静默失效。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const clientPath = path.join(root, 'lib', 'client.js');
const name = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).name;

function loadFactory(src) {
  let captured = null;
  const sandbox = {
    window: { __ModuleLoader__: { load: (spec) => { captured = spec; } } },
    console, Symbol, Object,
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'client.js' });
  return captured;
}

test('client.js：包含 __ModuleLoader__ 工厂注册（非普通 ESM）', () => {
  const src = readFileSync(clientPath, 'utf8');
  assert.match(src, /window\.__ModuleLoader__\.load\s*\(\s*\{/);
  assert.match(src, new RegExp(`id\\s*:\\s*${JSON.stringify(name)}`));
  assert.match(src, /factory\s*:\s*\(require\)\s*=>/);
  assert.match(src, /var module\s*=\s*\{\s*exports\s*:\s*\{\s*\}\s*\}/);
  assert.match(src, /var exports\s*=\s*module\.exports/);
  assert.match(src, /return module\.exports\s*;/);
  assert.doesNotMatch(src, /^import\s+[^;]+\s+from\s/m, '不允许顶层 ESM import');
});

test('client.js：模拟宿主加载，导出 name/apply/inject', () => {
  const src = readFileSync(clientPath, 'utf8');
  const spec = loadFactory(src);
  assert.ok(spec, 'loader.load 未被调用');
  assert.equal(spec.id, name);
  assert.equal(typeof spec.factory, 'function');
  const onlyReact = (id) => {
    if (id === 'react') return React;
    throw new Error(`unexpected require: ${id}`);
  };
  const mod = spec.factory(onlyReact);
  assert.equal(mod.name, name);
  assert.equal(typeof mod.apply, 'function');
  assert.ok(Array.isArray(mod.inject));
});
