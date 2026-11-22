/**
 * 第四轮审计修复回归测试：
 *  - runMode 在能力判定中真正生效（remote-only 禁用本地 CV / local-only 禁用远端）
 *  - 非像素工具 glance/ground 不再因 localCv 可用被误判 capable
 *  - dispose + 同名重建后，旧任务的 release 不误伤新会话槽位（并发超发竞态）
 *  - 脱敏正则覆盖 sk_live_ / 裸 token= / api-key= 形态
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { Scheduler } from '../lib/scheduler.js';
import { SessionManager } from '../lib/session.js';
import { resolveConfig } from '../lib/config.js';
import { redactError } from '../lib/audit.js';

/** 构造一个只满足 capabilities() 所需依赖的 Scheduler。
 *  getLocalCv() 返回带 available 布尔的替身；wasmOcr 传带 effective 的替身。 */
function makeScheduler(configOverrides, { localAvailable = true, wasmEffective = false } = {}) {
  const config = resolveConfig(configOverrides);
  const deps = {
    getConfig: () => config,
    getLocalCv: () => ({ available: localAvailable }),
    wasmOcr: { effective: wasmEffective },
    // capabilities() 不读取以下字段，给最小占位即可。
    sessions: {}, artifacts: {}, audit: {}, remoteVl: {}, baseDir: os.tmpdir(),
  };
  return new Scheduler(deps);
}

test('capabilities：auto 模式 + 本地可用 → 像素类 capable，mode=full', async () => {
  const cap = await makeScheduler({ runMode: 'auto', enabled: true }).capabilities();
  assert.equal(cap.localCv, true);
  assert.equal(cap.mode, 'full');
  assert.ok(cap.capableTools.includes('vision_detect'));
});

test('capabilities：remote-only → localCv=false，像素类工具全部 disabled', async () => {
  const cap = await makeScheduler({ runMode: 'remote-only', enabled: true }).capabilities();
  assert.equal(cap.localCv, false);
  assert.equal(cap.mode, 'route-only');
  assert.ok(!cap.capableTools.includes('vision_detect'), '像素类工具应被禁用');
});

test('capabilities：local-only 且无远端无 wasm → glance/ground 不误判 capable', async () => {
  const cap = await makeScheduler({
    runMode: 'local-only', enabled: true, vlBackends: [], builtinVlEnabled: false,
  }, { localAvailable: true, wasmEffective: false }).capabilities();
  assert.equal(cap.localCv, true, '本地 CV 确实可用');
  assert.ok(!cap.capableTools.includes('vision_glance'), 'glance 不应因 localCv 可用就 capable');
  assert.ok(!cap.capableTools.includes('vision_ground'), 'ground 不应因 localCv 可用就 capable');
});

test('capabilities：配置了有效远端后端 → glance/ground capable', async () => {
  const cap = await makeScheduler({
    runMode: 'auto', enabled: true,
    vlBackends: [{
      id: 'b1', label: '主', priority: 10, keyRef: 'KEY_1',
      baseURL: 'https://api.example.com/v1', model: 'm', enabled: true,
    }],
  }, { localAvailable: false }).capabilities();
  assert.ok(cap.capableTools.includes('vision_glance'));
  assert.ok(cap.capableTools.includes('vision_ground'));
});

test('capabilities：remote-only + keyRef 为空的后端不计入远端能力', async () => {
  const cap = await makeScheduler({
    runMode: 'remote-only', enabled: true,
    vlBackends: [{
      id: 'b1', label: '主', priority: 10, keyRef: '',
      baseURL: 'https://api.example.com/v1', model: 'm', enabled: true,
    }],
    builtinVlEnabled: false,
  }, { localAvailable: true }).capabilities();
  assert.equal(cap.customVlBackends, 0);
  assert.ok(!cap.capableTools.includes('vision_glance'));
});

test('SessionManager：dispose + 同名重建后旧 release 不误减新会话 running', async () => {
  const base = await os.tmpdir();
  const cfg = resolveConfig({ sessionConcurrency: 1 });
  const sm = new SessionManager(base, () => cfg);
  const key = 'reuse-key';

  // 会话1：占用一个槽位
  const slot1 = await sm.acquire(key);
  assert.equal(sm.load().runningTasks, 1);

  // dispose：从 Map 删除 state1（slot1 尚未 release）
  sm.disposeSession(key);
  assert.equal(sm.load().runningTasks, 0, 'dispose 后 Map 里已无该会话');

  // 同名重建：state2 入 Map，占用一个新槽位
  const slot2 = await sm.acquire(key);
  assert.equal(sm.load().runningTasks, 1, '新会话占 1 个槽');

  // 旧任务完成：slot1.release() 不应触碰 state2
  slot1.release();
  assert.equal(sm.load().runningTasks, 1, '旧 release 不应把新会话的 running 减到 0');

  slot2.release();
  assert.equal(sm.load().runningTasks, 0);
});

test('redactError：sk_live_ / 裸 token= / api-key= 形态被脱敏', () => {
  const cases = [
    'auth failed sk_live_AbCdEf1234567890',
    'request token=supersecrettoken123 failed',
    'header api-key=abcdef123456 rejected',
  ];
  for (const msg of cases) {
    const out = redactError(new Error(msg));
    assert.ok(out.includes('<redacted>'), `应脱敏: ${msg} => ${out}`);
    assert.ok(!/sk_live_[A-Za-z0-9]{6,}|token=supersecret|api-key=abcdef/.test(out),
      `不应残留明文: ${out}`);
  }
});
