/**
 * 图像头嗅探测试（纯 Buffer，无 Python）：preprocessImage 在运行时不可用时
 * 必须原样返回字节，保证摄取通道永不因预处理失败而丢图。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { sniff, preprocessImage } from '../lib/artifacts.js';

function pngBuffer(w, h) {
  const b = Buffer.alloc(24);
  b[0] = 0x89; b.write('PNG', 1, 'ascii');
  b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}

test('sniff：识别 PNG 尺寸', () => {
  const r = sniff(pngBuffer(1920, 1080));
  assert.equal(r.mediaType, 'image/png');
  assert.equal(r.width, 1920);
  assert.equal(r.height, 1080);
});

test('sniff：识别 JPEG 头', () => {
  const b = Buffer.alloc(64);
  b[0] = 0xff; b[1] = 0xd8;
  b[2] = 0xff; b[3] = 0xc0; b[4] = 0x00; b[5] = 0x11;
  b.writeUInt16BE(640, 7); b.writeUInt16BE(480, 5);
  const r = sniff(b);
  assert.equal(r.mediaType, 'image/jpeg');
});

test('sniff：未知字节回落 octet-stream', () => {
  assert.equal(sniff(Buffer.from('hello')).mediaType, 'application/octet-stream');
});

test('preprocessImage：运行时外的兜底保持原字节不变', async () => {
  const b = pngBuffer(2000, 1000);
  const cfg = { autoTileEnabled: true, oversizeEdgePx: 1600, tileEdgePx: 768 };
  const r = await preprocessImage(b, cfg);
  assert.equal(r.data, b, '兜底路径必须原样返回同一 buffer');
  assert.equal(r.oversized, true);
  assert.equal(r.tiles, 6); // ceil(2000/768)*ceil(1000/768) = 3*2
});
