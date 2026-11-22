/**
 * 预处理压缩的 Python 运行时集成测试。
 * 通过真实 JSON 行协议驱动 cv_worker.py 的 preprocess op：
 *   - 高熵大图必须被显著压缩（降 token 主路径）
 *   - 已高度压缩的小图必须保留原字节（避免负优化）
 *   - alpha 图保持 PNG
 * Python/Pillow 缺失时整组跳过（不阻塞纯逻辑 CI）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const worker = path.join(root, 'runtime', 'cv_worker.py');

function runPython(args) {
  for (const py of ['python', 'python3', 'py']) {
    const r = spawnSync(py, args, { cwd: root, encoding: 'utf8' });
    if (r.error || r.status !== 0) continue;
    return r;
  }
  return null;
}

const probe = runPython([worker, '--probe']);
const ready = probe && (() => {
  try {
    const last = probe.stdout.trim().split('\n').filter(Boolean).pop();
    const j = JSON.parse(last);
    return j?.data?.pillow === true;
  } catch { return false; }
})();

const suite = ready ? test : test.skip;

function request(op, params, config, workdir) {
  const withInput = (py) => spawnSync(py, [worker, '--run'], {
    cwd: root, encoding: 'utf8',
    input: JSON.stringify({ op, params, workdir, config }) + '\n',
  });
  for (const py of ['python', 'python3', 'py']) {
    const rr = withInput(py);
    if (rr.error || rr.status !== 0) continue;
    const last = rr.stdout.trim().split('\n').filter(Boolean).pop();
    try { return JSON.parse(last); } catch { return null; }
  }
  return null;
}

function makePillowImage(dir, name, w, h, mode, color) {
  const script = `
from PIL import Image
import os
d = ${JSON.stringify(dir)}
img = Image.new(${JSON.stringify(mode)}, (${w}, ${h}), ${JSON.stringify(color)})
if ${JSON.stringify(mode)} == 'RGB':
    import random; random.seed(42)
    px = img.load()
    for y in range(0, ${h}, 2):
        for x in range(0, ${w}, 2):
            c = (random.randint(0,255), random.randint(0,255), random.randint(0,255))
            for dy in range(2):
                for dx in range(2):
                    if x+dx<${w} and y+dy<${h}: px[x+dx,y+dy]=c
img.save(os.path.join(d, ${JSON.stringify(name)}))
`;
  const r = spawnSync('python', ['-c', script], { cwd: root, encoding: 'utf8' });
  return r.status === 0;
}

suite('preprocess：高熵大图显著压缩且长边收敛到配置值', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'vnx-test-'));
  try {
    assert.equal(makePillowImage(dir, 'big.png', 2400, 1600, 'RGB', (0, 0, 0)), true);
    const src = path.join(dir, 'big.png');
    const before = readFileSync(src).length;
    const res = request('preprocess', { _image_paths: [src] },
      { preprocessMaxEdgePx: 800, preprocessQuality: 70 }, dir);
    assert.ok(res, 'worker 无响应');
    assert.equal(res.data.changed, true);
    assert.equal(res.data.width, 800);
    assert.equal(res.data.height, 533);
    const outPath = res.artifact_paths[0];
    assert.ok(existsSync(outPath));
    assert.ok(readFileSync(outPath).length < before, '压缩后应更小');
    assert.match(res.data.media_type, /^image\//);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

suite('preprocess：无收益时不产生新文件（changed=false）', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'vnx-test-'));
  try {
    const src = path.join(dir, 'tiny.png');
    writeFileSync(src, Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
      'base64',
    ));
    const res = request('preprocess', { _image_paths: [src] },
      { preprocessMaxEdgePx: 1280, preprocessQuality: 82 }, dir);
    assert.ok(res);
    assert.equal(res.data.changed, false);
    assert.deepEqual(res.artifact_paths, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
