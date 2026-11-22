/**
 * 配置模型测试：默认值 / 校验 / 脱敏导出 / 导入 / 差异计算。
 * 纯逻辑，无宿主 / 网络 / Python 依赖。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULTS, draftFrom, validate, diffFields,
  exportConfigText, parseImport, newBackendRow,
} from '../lib/client/settingsModel.js';

test('draftFrom：空输入补齐全部默认值', () => {
  const d = draftFrom(undefined);
  for (const key of Object.keys(DEFAULTS)) {
    assert.ok(key in d, `缺少默认字段 ${key}`);
  }
  assert.equal(d.enabled, true);
  assert.equal(d.preprocessMaxEdgePx, 1280);
  assert.equal(d.preprocessQuality, 82);
  assert.deepEqual(d.panelAllowedHosts, []);
});

test('draftFrom：panelAllowedHosts 作为字符串数组保留，不被当成后端行', () => {
  const d = draftFrom({ panelAllowedHosts: ['127.0.0.1', 'localhost', 42] });
  assert.deepEqual(d.panelAllowedHosts, ['127.0.0.1', 'localhost']);
  assert.equal(validate(d).valid, true);
});

test('draftFrom：保留合法值，非法数组回落为空', () => {
  const d = draftFrom({ sessionConcurrency: 3, vlBackends: 'not-an-array' });
  assert.equal(d.sessionConcurrency, 3);
  assert.deepEqual(d.vlBackends, []);
});

test('validate：数值越界被拦截', () => {
  const d = draftFrom(undefined);
  d.preprocessQuality = 0;
  d.sessionConcurrency = 9;
  const r = validate(d);
  assert.equal(r.valid, false);
  assert.ok(r.errors.preprocessQuality);
  assert.ok(r.errors.sessionConcurrency);
});

test('validate：启用的 VL 后端缺 baseURL / model 被拦截', () => {
  const d = draftFrom(undefined);
  const row = newBackendRow([]);
  row.enabled = true;
  row.baseURL = 'ftp://bad';
  row.model = '';
  d.vlBackends = [row];
  const r = validate(d);
  assert.ok(r.errors['vlBackends.0.baseURL']);
  assert.ok(r.errors['vlBackends.0.model']);
});

test('validate：完整合法草稿通过', () => {
  const d = draftFrom(undefined);
  assert.equal(validate(d).valid, true);
});

test('newBackendRow：id 唯一递增', () => {
  const a = newBackendRow([]);
  const b = newBackendRow([a]);
  assert.notEqual(a.id, b.id);
});

test('exportConfigText：抹除疑似密钥字段，保留 keyRef', () => {
  const d = draftFrom(undefined);
  d.vlBackends = [{
    id: 'vl-1', label: '主', baseURL: 'https://api.x/v1', model: 'm',
    keyRef: 'REF_ONLY', maxImageEdgePx: 2048, enabled: true,
    apiKey: 'SK-SECRET-SHOULD-NOT-LEAK',
  }];
  const text = exportConfigText(d);
  assert.ok(!text.includes('SK-SECRET-SHOULD-NOT-LEAK'), '明文密钥泄漏');
  assert.ok(text.includes('REF_ONLY'), 'keyRef 应保留');
  assert.ok(text.includes('_plugin'));
});

test('parseImport：导出文本可回导，非法 JSON 报可读错误', () => {
  const d = draftFrom(undefined);
  const text = exportConfigText(d);
  const r = parseImport(text);
  assert.equal(r.ok, true);
  assert.equal(r.draft.enabled, true);
  const bad = parseImport('{not json');
  assert.equal(bad.ok, false);
  assert.ok(bad.error);
});

test('导出/导入：panelAllowedHosts 作为字符串数组往返不失真', () => {
  const d = draftFrom(undefined);
  d.panelAllowedHosts = ['127.0.0.1', 'localhost'];
  const r = parseImport(exportConfigText(d));
  assert.equal(r.ok, true);
  assert.deepEqual(r.draft.panelAllowedHosts, ['127.0.0.1', 'localhost']);
});

test('validate：Host 白名单超量 / 含斜杠被拦截', () => {
  const d = draftFrom(undefined);
  d.panelAllowedHosts = ['http://evil'];
  assert.ok(validate(d).errors.panelAllowedHosts);
  d.panelAllowedHosts = Array.from({ length: 65 }, (_, i) => `h${i}`);
  assert.ok(validate(d).errors.panelAllowedHosts);
});

test('diffFields：只返回真正改动的字段', () => {
  const d = draftFrom(undefined);
  assert.deepEqual(diffFields(d, undefined), []);
  d.preprocessMaxEdgePx = 2048;
  const diff = diffFields(d, undefined);
  assert.equal(diff.length, 1);
  assert.equal(diff[0][0], 'preprocessMaxEdgePx');
});
