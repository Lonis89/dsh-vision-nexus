/**
 * 配置归一化 + 审计脱敏测试。纯逻辑，验证钳制与安全边界。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfig, DEFAULTS } from '../lib/config.js';
import { redactError, digestArgs, beginAudit, noteDegrade } from '../lib/audit.js';

test('resolveConfig：缺省项用默认值', () => {
  const c = resolveConfig(undefined);
  assert.equal(c.sessionConcurrency, DEFAULTS.sessionConcurrency);
  assert.equal(c.preprocessMaxEdgePx, 1280);
});

test('resolveConfig：越界值被钳制', () => {
  const c = resolveConfig({
    preprocessQuality: 999,
    sessionConcurrency: 0,
    taskTimeoutMs: 1,
    vlBackends: [],
  });
  assert.equal(c.preprocessQuality, 100);
  assert.ok(c.sessionConcurrency >= 1);
  assert.ok(c.taskTimeoutMs >= 1000);
});

test('redactError：URL 与 Bearer 令牌被脱敏', () => {
  const msg = 'call https://api.secret.com/v1 failed with Bearer sk-live-ABC123';
  const out = redactError(new Error(msg));
  assert.ok(!out.includes('api.secret.com'));
  assert.ok(!out.includes('sk-live-ABC123'));
});

test('digestArgs：长数组 / 长字符串被截断，不爆审计体积', () => {
  const d = digestArgs({ ids: Array.from({ length: 500 }, (_, i) => i), text: 'x'.repeat(5000) });
  assert.ok(JSON.stringify(d).length < 5000);
});

test('noteDegrade：降级链被记录', () => {
  const draft = beginAudit({} );
  noteDegrade(draft, 'local-cv', 'custom-vl', 'test hop');
  assert.ok(Array.isArray(draft.degradeChain));
  assert.equal(draft.degradeChain.length, 1);
});
