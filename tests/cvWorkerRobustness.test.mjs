/**
 * cv_worker.py 健壮性回归测试（承接 2026-11-17 cvworker 审计修复）。
 * 覆盖：long_ocr 死循环防护、crop 越界/非法参数结构化错误、损坏图降级、
 *       pixel_diff threshold NaN 防御、NaN 参数不崩溃。
 * 通过真实 JSON 行协议驱动 worker；Python/Pillow 缺失时整组跳过。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const worker = path.join(root, 'runtime', 'cv_worker.py');
const PY = ['python', 'python3', 'py'];

function findPython() {
  for (const py of PY) {
    const r = spawnSync(py, [worker, '--probe'], { cwd: root, encoding: 'utf8' });
    if (r.error || r.status !== 0) continue;
    try {
      const j = JSON.parse(r.stdout.trim().split('\n').filter(Boolean).pop());
      if (j?.data?.pillow === true && j?.data?.numpy === true) return py;
    } catch { /* keep trying */ }
  }
  return null;
}
const python = findPython();
const suite = python ? test : test.skip;

function request(op, params, config = {}, workdir = os.tmpdir(), timeout = 6000) {
  const r = spawnSync(python, [worker, '--run'], {
    cwd: root, encoding: 'utf8', timeout,
    input: JSON.stringify({ op, params, workdir, config }) + '\n',
  });
  const last = (r.stdout || '').trim().split('\n').filter(Boolean).pop();
  let json = null;
  try { json = last ? JSON.parse(last) : null; } catch { /* no json */ }
  return { status: r.status, timedOut: r.error?.code === 'ETIMEDOUT', json };
}

function makeImage(dir, name, w, h) {
  const script = `from PIL import Image\nimport os\nImage.new('RGB',(${w},${h}),(200,100,50)).save(os.path.join(${JSON.stringify(dir)},${JSON.stringify(name)}))`;
  return spawnSync(python, ['-c', script], { cwd: root, encoding: 'utf8' }).status === 0;
}

suite('long_ocr：tileEdgePx=0 不再死循环（阻断级防护）', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'vnx-rob-'));
  try {
    assert.equal(makeImage(dir, 'img.png', 100, 100), true);
    const r = request('long_ocr', { _image_paths: [path.join(dir, 'img.png')] }, { tileEdgePx: 0 }, dir, 4000);
    assert.equal(r.timedOut, false, 'tileEdgePx=0 曾导致死循环，现已防护');
    assert.ok(r.json, '必须有 JSON 输出');
    assert.ok(Array.isArray(r.json.data.segments));
    assert.ok(r.json.data.segments.length >= 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

suite('crop：完全越界 bbox 返回结构化错误而非崩溃', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'vnx-rob-'));
  try {
    assert.equal(makeImage(dir, 'img.png', 800, 600), true);
    const r = request('crop', {
      _image_paths: [path.join(dir, 'img.png')],
      bbox: { x: 900, y: 0, width: 50, height: 50 },
    }, {}, dir);
    assert.equal(r.timedOut, false);
    assert.ok(r.json, '必须有 JSON 输出');
    assert.equal(r.status, 0, '越界应走结构化错误分支，exit 0');
    assert.equal(r.json.confidence, 0);
    assert.match(r.json.data.error, /无交集|越界/);
    assert.deepEqual(r.json.artifact_paths, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

suite('crop：NaN/null bbox 参数不崩溃（优雅降级为默认值）', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'vnx-rob-'));
  try {
    assert.equal(makeImage(dir, 'img.png', 200, 200), true);
    for (const bad of [null, NaN]) {
      const r = request('crop', {
        _image_paths: [path.join(dir, 'img.png')],
        bbox: { x: bad, y: 0, width: 50, height: 50 },
      }, {}, dir);
      assert.equal(r.timedOut, false);
      assert.ok(r.json, `x=${String(bad)} 必须有 JSON 输出`);
      assert.equal(r.status, 0, `x=${String(bad)} 不应 exit 1`);
      // safe_int 把非法 x 回退为 0，bbox 变合法 → 正常裁剪；关键是结构与
      // 置信度字段齐全、不崩溃，不强制具体置信度（0=拒绝 / 1=降级后成功皆可）。
      assert.equal(typeof r.json.confidence, 'number');
      assert.ok(Array.isArray(r.json.artifact_paths));
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

suite('损坏图像：各算子返回结构化错误/notice，不崩溃', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'vnx-rob-'));
  try {
    const bad = path.join(dir, 'bad.png');
    writeFileSync(bad, Buffer.from('not a real image'));
    for (const op of ['detect', 'crop', 'color_extract', 'trace_svg', 'extract_foreground', 'long_ocr']) {
      const params = op === 'crop'
        ? { _image_paths: [bad], bbox: { x: 0, y: 0, width: 10, height: 10 } }
        : { _image_paths: [bad] };
      const r = request(op, params, {}, dir);
      assert.equal(r.timedOut, false, `${op} 不应挂起`);
      assert.ok(r.json, `${op} 必须有 JSON 输出`);
      assert.equal(r.status, 0, `${op} 损坏图应走结构化分支，exit 0`);
      assert.equal(r.json.confidence, 0);
      assert.deepEqual(r.json.artifact_paths, []);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

suite('pixel_diff：threshold=NaN 不静默误判 identical', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'vnx-rob-'));
  try {
    assert.equal(makeImage(dir, 'a.png', 60, 60), true);
    assert.equal(makeImage(dir, 'b.png', 60, 60), true);
    // 两图相同；threshold NaN 应回退默认 24，得到 identical（ratio=0）——
    // 关键是不因 delta>nan 恒 False 而"恰好"identical：用不同图验证。
    const script = `from PIL import Image\nimport os\nImage.new('RGB',(60,60),(0,0,0)).save(os.path.join(${JSON.stringify(dir)},'black.png'))`;
    spawnSync(python, ['-c', script], { cwd: root, encoding: 'utf8' });
    const r = request('pixel_diff', {
      _image_paths: [path.join(dir, 'a.png'), path.join(dir, 'black.png')], threshold: NaN,
    }, {}, dir);
    assert.equal(r.timedOut, false);
    assert.ok(r.json);
    assert.equal(r.json.status ?? r.status, 0);
    assert.notEqual(r.json.data.quantitative.verdict, 'identical', 'threshold NaN 不应导致静默 identical 误判');
    assert.equal(r.json.data.quantitative.threshold, 24, 'NaN 应回退默认 24');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

suite('color_extract / trace_svg：NaN 参数不导致 exit 1', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'vnx-rob-'));
  try {
    assert.equal(makeImage(dir, 'img.png', 80, 80), true);
    const c = request('color_extract', { _image_paths: [path.join(dir, 'img.png')], color_count: NaN }, {}, dir);
    assert.ok(c.json);
    assert.equal(c.status, 0);
    assert.ok(c.json.data.colors.length >= 1);
    const t = request('trace_svg', { _image_paths: [path.join(dir, 'img.png')], simplify: NaN }, {}, dir);
    assert.ok(t.json);
    assert.equal(t.status, 0);
    assert.equal(typeof t.json.data.path_segments, 'number');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
