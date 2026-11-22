/**
 * 第四轮残留风险处理回归测试：
 *  - 审计 JSONL 磁盘轮转（防无界增长）
 *  - 配置 baseURL 协议校验（挡 file:/javascript:）
 *  - 面板 sameOrigin 的 Sec-Fetch-Site / Origin 加固（DNS rebinding / CSRF）
 *  - SessionManager.activateAll（eager→progressive 热切换迁移）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { resolveConfig, normalizeHost } from '../lib/config.js';
import { effectivePreprocessEdge } from '../lib/scheduler.js';
import { AuditLog, beginAudit } from '../lib/audit.js';
import { sameOrigin } from '../lib/panel/hostPanel.js';
import { SessionManager } from '../lib/session.js';

test('resolveConfig：builtinVlBaseURL 非 http(s) 被清空', () => {
  const c = resolveConfig({ builtinVlBaseURL: 'file:///etc/passwd' });
  assert.equal(c.builtinVlBaseURL, '');
  const ok = resolveConfig({ builtinVlBaseURL: 'https://api.example.com/v1' });
  assert.equal(ok.builtinVlBaseURL, 'https://api.example.com/v1');
});

test('resolveConfig：后端 baseURL 非 http(s) 被清空', () => {
  const c = resolveConfig({
    vlBackends: [{
      id: 'b1', label: 'x', priority: 10, keyRef: 'K', model: 'm',
      baseURL: 'javascript:alert(1)', enabled: true, maxImageEdgePx: 2048,
    }],
  });
  assert.equal(c.vlBackends[0].baseURL, '');
});

test('effectivePreprocessEdge：无后端时用全局上限', () => {
  const c = resolveConfig({ preprocessMaxEdgePx: 1280, vlBackends: [] });
  assert.equal(effectivePreprocessEdge(c), 1280);
});

test('effectivePreprocessEdge：取启用后端 maxImageEdgePx 的最小值', () => {
  const c = resolveConfig({
    preprocessMaxEdgePx: 1280,
    vlBackends: [
      { id: 'a', label: 'a', priority: 10, keyRef: 'K1', baseURL: 'https://a.example/v1', model: 'm', maxImageEdgePx: 600, enabled: true },
      { id: 'b', label: 'b', priority: 20, keyRef: 'K2', baseURL: 'https://b.example/v1', model: 'm', maxImageEdgePx: 400, enabled: true },
      { id: 'c', label: 'c', priority: 30, keyRef: 'K3', baseURL: 'https://c.example/v1', model: 'm', maxImageEdgePx: 256, enabled: false },
    ],
  });
  // 仅启用 a/b，最小 400；禁用的 c(256) 不计；全局 1280 更大。
  assert.equal(effectivePreprocessEdge(c), 400);
});

test('effectivePreprocessEdge：后端上限大于全局时仍用全局', () => {
  const c = resolveConfig({
    preprocessMaxEdgePx: 900,
    vlBackends: [
      { id: 'a', label: 'a', priority: 10, keyRef: 'K1', baseURL: 'https://a.example/v1', model: 'm', maxImageEdgePx: 2048, enabled: true },
    ],
  });
  assert.equal(effectivePreprocessEdge(c), 900);
});

test('sameOrigin：Sec-Fetch-Site=cross-site 被拒绝（DNS rebinding / CSRF）', () => {
  // 即便 Origin 与 Host 一致（rebinding 时攻击者域名两者都可伪造），cross-site 仍拒绝。
  const req = {
    method: 'GET',
    headers: {
      origin: 'http://evil.example',
      host: 'evil.example',
      'sec-fetch-site': 'cross-site',
    },
  };
  assert.equal(sameOrigin(req), false);
});

test('sameOrigin：同源面板请求（same-origin）放行', () => {
  const req = {
    method: 'POST',
    headers: { origin: 'http://127.0.0.1:1234', host: '127.0.0.1:1234', 'sec-fetch-site': 'same-origin' },
  };
  assert.equal(sameOrigin(req), true);
});

test('sameOrigin：无 Origin 但 Sec-Fetch-Site=cross-site 的简单跨站 GET 被拒绝', () => {
  const req = { method: 'GET', headers: { host: '127.0.0.1:1234', 'sec-fetch-site': 'cross-site' } };
  assert.equal(sameOrigin(req), false);
});

test('sameOrigin：无 Origin 无 Sec-Fetch-Site 的本地工具请求放行', () => {
  const req = { method: 'GET', headers: { host: '127.0.0.1:1234' } };
  assert.equal(sameOrigin(req), true);
});

test('sameOrigin：Origin 与 Host 不一致被拒绝', () => {
  const req = { method: 'POST', headers: { origin: 'http://evil.example', host: '127.0.0.1:1234' } };
  assert.equal(sameOrigin(req), false);
});

// ── 可选 Host 白名单（DNS rebinding 硬校验，默认空=行为不变）──

test('normalizeHost：去协议 / userinfo / 端口 / 路径 / 末尾点，IPv6 保方括号内容', () => {
  assert.equal(normalizeHost('HTTP://user@LOCALHOST.:8080/path?q=1#f'), 'localhost');
  assert.equal(normalizeHost('127.0.0.1:1234'), '127.0.0.1');
  assert.equal(normalizeHost('[::1]:8080'), '::1');
  assert.equal(normalizeHost('::1'), '::1');
  assert.equal(normalizeHost(42), '');
  assert.equal(normalizeHost('   '), '');
});

test('resolveConfig：panelAllowedHosts 默认空，非法项过滤 + 去重 + 规范化', () => {
  assert.deepEqual(resolveConfig({}).panelAllowedHosts, []);
  const c = resolveConfig({
    panelAllowedHosts: ['HTTPS://A.Example:443/', 'a.example', '127.0.0.1:9', '', 42, '[::1]:8080'],
  });
  assert.deepEqual(c.panelAllowedHosts, ['a.example', '127.0.0.1', '::1']);
  // 上限 64：超出截断，不膨胀。
  const many = resolveConfig({ panelAllowedHosts: Array.from({ length: 100 }, (_, i) => `h${i}.example`) });
  assert.equal(many.panelAllowedHosts.length, 64);
});

test('sameOrigin：白名单为空时行为与旧版一致（不传第二参数）', () => {
  // 既有 5 项 sameOrigin 测试均只传 req；这里再显式断言空数组 = 旧行为。
  const req = { method: 'POST', headers: { origin: 'http://127.0.0.1:1234', host: '127.0.0.1:1234', 'sec-fetch-site': 'same-origin' } };
  assert.equal(sameOrigin(req, []), true);
  assert.equal(sameOrigin(req), true);
});

test('sameOrigin：DNS rebinding 场景（Origin==Host 且 same-origin）被白名单拦截', () => {
  // 攻击者域名重绑定到 127.0.0.1：前三条信号全部满足，仅白名单能挡。
  const req = {
    method: 'POST',
    headers: {
      origin: 'http://evil.example', host: 'evil.example', 'sec-fetch-site': 'same-origin',
    },
  };
  assert.equal(sameOrigin(req, ['127.0.0.1', 'localhost', '[::1]']), false);
});

test('sameOrigin：白名单命中（含端口 / 大小写）放行；未命中拒绝；无 Host 拒绝', () => {
  const ok = { method: 'GET', headers: { host: 'LOCALHOST:5173', 'sec-fetch-site': 'same-origin' } };
  assert.equal(sameOrigin(ok, ['localhost']), true);
  const okV6 = { method: 'GET', headers: { host: '[::1]:8080' } };
  assert.equal(sameOrigin(okV6, ['::1']), true);
  const bad = { method: 'GET', headers: { host: 'attacker.tld:8080' } };
  assert.equal(sameOrigin(bad, ['localhost', '127.0.0.1']), false);
  const noHost = { method: 'GET', headers: {} };
  assert.equal(sameOrigin(noHost, ['localhost']), false);
  // 白名单模式下的 cross-site 仍需先被拒（纵深不回退）。
  const cross = { method: 'GET', headers: { host: 'localhost', 'sec-fetch-site': 'cross-site' } };
  assert.equal(sameOrigin(cross, ['localhost']), false);
});

test('SessionManager.activateAll：迁移后所有会话 activated=true 且可读回', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'vnx-act-'));
  const cfg = resolveConfig({ persistSessionState: true });
  try {
    const sm = new SessionManager(base, () => cfg);
    const s1 = await sm.get('s1');
    const s2 = await sm.get('s2');
    assert.equal(s1.activated, false);
    assert.equal(s2.activated, false);
    await sm.activateAll();
    // 同实例内读回
    assert.equal((await sm.get('s1')).activated, true);
    assert.equal((await sm.get('s2')).activated, true);
    // 新实例从磁盘读回（持久化生效）
    const sm2 = new SessionManager(base, () => cfg);
    assert.equal((await sm2.get('s1')).activated, true);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test('AuditLog：JSONL 超过阈值后轮转保留最近 auditMaxEntries 行', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'vnx-audit-'));
  const cfg = resolveConfig({ auditMaxEntries: 10 });
  try {
    const log = new AuditLog(base, () => cfg);
    const key = 'audit-key';
    const date = new Date().toISOString().slice(0, 10);
    // 写 40 条，每条带较长摘要以快速超过 10KB 阈值触发轮转。
    for (let i = 0; i < 40; i++) {
      // eslint-disable-next-line no-await-in-loop
      await log.commit(beginAudit('vision_detect', { text: `record-${i}-${'x'.repeat(200)}` }, key), {
        engine: 'local-cv', confidence: 0.9, artifactIds: [], status: 'ok',
      });
    }
    const file = path.join(base, '.dsh-vision-nexus', 'sessions', key, 'audit', `${date}.jsonl`);
    const text = await fs.readFile(file, 'utf8');
    const lines = text.split('\n').filter(Boolean);
    assert.ok(lines.length <= cfg.auditMaxEntries,
      `轮转后行数应 ≤ ${cfg.auditMaxEntries}，实际 ${lines.length}`);
    // 最近一条应保留（含 record-39）
    assert.ok(text.includes('"toolName":"vision_detect"'));
    assert.ok(lines.length > 0);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});
