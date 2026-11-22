/**
 * dsh-vision-nexus — Artifact 文件系统托管
 *
 *  - 所有产出图像（裁剪子图 / 热力图 / 色板 / SVG / 渲染截图 / 抠图）
 *    自动注册为 DSH Artifact，返回会话内可反复引用的 id。
 *  - 图片统一做压缩预处理；base64 只托管在磁盘，原图 / 字节绝不注入 LLM 上下文。
 *  - 工作目录按会话隔离；临时文件带时间戳，由 SessionManager 定时清理。
 *
 * 说明：DSH 的二进制正式托管走 `ctx.attachments.saveImage`（见 attachments 服务），
 * 本模块在其之上建立「会话内 Artifact 索引层」：把每个产物登记为
 * `art:<seq>` 并维护 元信息 + 会话内文件，工具结果只回传 id 与元信息。
 * 若宿主未提供 attachments 服务（纯离线降级），自动回落到纯文件登记，
 * 但依旧只回传 id，绝不回传 base64。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { ImageRef, VisionConfig } from './types.js';
import { sessionDirs, ensureSessionDirs } from './session.js';

export interface ArtifactRecord {
  id: string;
  sessionKey: string;
  /** 会话内相对路径（隔离目录下）。 */
  relPath: string;
  mediaType: string;
  bytes: number;
  width: number;
  height: number;
  /** 宿主 attachments 服务返回的正式引用（若可用）。 */
  attachmentId?: string;
  createdAt: number;
  /** 是否临时产物（受保留时长清理）。 */
  temporary: boolean;
  label?: string;
}

/**
 * 压缩预处理 + 尺寸探测。
 * 真实实现由本地 CV 运行时的 `preprocess` 操作完成（见 cv_worker.py）；
 * 这里做无依赖的兜底：读取字节、按扩展名推断 MIME、从 PNG/JPEG 头解析尺寸。
 */
export async function preprocessImage(
  buffer: Buffer,
  config: VisionConfig,
): Promise<{ data: Buffer; mediaType: string; width: number; height: number; oversized: boolean; tiles: number }> {
  const meta = sniff(buffer);
  const maxEdge = Math.max(meta.width, meta.height);
  // 面板「大图自动分块策略」关闭时不触发分块采样（oversized=false, tiles=0）。
  const oversized = config.autoTileEnabled && maxEdge > config.oversizeEdgePx;
  const tiles = oversized
    ? Math.ceil(meta.width / config.tileEdgePx) * Math.ceil(meta.height / config.tileEdgePx)
    : 0;
  // 实际重采样在 cv_worker.py 完成；此处仅登记元信息，避免把大字节载入上下文。
  return {
    data: buffer,
    mediaType: meta.mediaType,
    width: meta.width,
    height: meta.height,
    oversized,
    tiles,
  };
}

/** 极轻量图片头解析：PNG IHDR / JPEG SOF / GIF，失败返回 0 尺寸。 */
export function sniff(buffer: Buffer): { mediaType: string; width: number; height: number } {
  if (buffer.length >= 24 && buffer[0] === 0x89 && buffer.toString('ascii', 1, 4) === 'PNG') {
    return { mediaType: 'image/png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    // 扫描 JPEG SOF0/SOF2 段。
    let i = 2;
    while (i + 9 < buffer.length) {
      if (buffer[i] !== 0xff) { i++; continue; }
      const marker = buffer[i + 1];
      if (marker === 0xc0 || marker === 0xc2) {
        return { mediaType: 'image/jpeg', width: buffer.readUInt16BE(i + 7), height: buffer.readUInt16BE(i + 5) };
      }
      const len = buffer.readUInt16BE(i + 2);
      i += 2 + len;
    }
    return { mediaType: 'image/jpeg', width: 0, height: 0 };
  }
  if (buffer.length >= 10 && buffer.toString('ascii', 0, 3) === 'GIF') {
    return { mediaType: 'image/gif', width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return { mediaType: 'image/webp', width: 0, height: 0 };
  }
  return { mediaType: 'application/octet-stream', width: 0, height: 0 };
}

/** Artifact 存储：会话隔离 + 自动登记 + 复用引用。 */
export class ArtifactStore {
  private readonly baseDir: string;
  /** 配置 getter：大图阈值等面板字段热更新后即时生效。 */
  private readonly getConfig: () => VisionConfig;
  private seq = 0;
  /** 可选宿主 attachments 服务引用。 */
  private attachments: any;

  constructor(baseDir: string, config: VisionConfig | (() => VisionConfig), attachments?: any) {
    this.baseDir = baseDir;
    this.getConfig = typeof config === 'function' ? config : () => config;
    this.attachments = attachments;
  }

  private get config(): VisionConfig {
    return this.getConfig();
  }

  /**
   * 把一份产物字节注册为 Artifact，返回会话内 id。
   * @param bytes 产物字节（绝不进入模型上下文）
   * @param opts.temporary 是否为临时产物（进入 temp 目录，受定时清理）
   */
  async register(
    sessionKey: string,
    bytes: Buffer,
    opts: {
      mediaType?: string;
      width?: number;
      height?: number;
      label?: string;
      temporary?: boolean;
      ext?: string;
      /** 已知的宿主 attachmentId（由调度层先调用 saveImage 得到）。 */
      attachmentId?: string;
    } = {},
  ): Promise<{ id: string; ref: ImageRef; record: ArtifactRecord }> {
    const d = await ensureSessionDirs(this.baseDir, sessionKey);
    const mediaType = opts.mediaType ?? sniff(bytes).mediaType;
    const ext = opts.ext ?? extFor(mediaType);
    const temporary = opts.temporary ?? false;
    const id = `art:${++this.seq}-${crypto.randomBytes(3).toString('hex')}`;
    const fileName = `${id.replace(/[^a-zA-Z0-9_-]/g, '_')}.${ext}`;
    const dir = temporary ? d.temp : d.artifacts;
    const relPath = path.relative(d.root, path.join(dir, fileName));
    const absPath = path.join(d.root, relPath);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, bytes);

    // 若宿主提供正式二进制托管，登记 attachmentId（模型只看到 id，不看到字节）。
    let attachmentId = opts.attachmentId;
    if (!attachmentId && this.attachments && typeof this.attachments.saveImage === 'function') {
      try {
        const saved = await this.attachments.saveImage({ data: bytes, mediaType, name: fileName });
        attachmentId = String(saved?.attachmentId ?? saved?.id ?? '');
      } catch { /* 降级为纯文件登记，不中断会话 */ }
    }

    const meta = sniff(bytes);
    const width = opts.width ?? meta.width;
    const height = opts.height ?? meta.height;
    const record: ArtifactRecord = {
      id, sessionKey, relPath, mediaType, bytes: bytes.length,
      width, height, createdAt: Date.now(), temporary,
      ...(attachmentId ? { attachmentId } : {}),
      ...(opts.label ? { label: opts.label } : {}),
    };
    await this.writeMeta(sessionKey, record);

    const ref: ImageRef = {
      id, mediaType, width, height, bytes: bytes.length,
      oversized: Math.max(width, height) > this.config.oversizeEdgePx,
      tiles: 0,
      origin: opts.label,
    };
    return { id, ref, record };
  }

  /** 读取产物字节（仅供引擎层内部使用，绝不注入模型上下文）。 */
  async read(sessionKey: string, id: string): Promise<Buffer | undefined> {
    const record = await this.readMeta(sessionKey, id);
    if (!record) return undefined;
    const d = sessionDirs(this.baseDir, sessionKey);
    try {
      return await fs.readFile(path.join(d.root, record.relPath));
    } catch { return undefined; }
  }

  /** 列出会话内全部 Artifact（支持会话内反复引用）。 */
  async list(sessionKey: string): Promise<ArtifactRecord[]> {
    const d = sessionDirs(this.baseDir, sessionKey);
    try {
      const files = await fs.readdir(path.join(d.root, '.meta'));
      const out: ArtifactRecord[] = [];
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        const rec = await this.readMeta(sessionKey, f.slice(0, -5));
        if (rec) out.push(rec);
      }
      return out;
    } catch { return []; }
  }

  private async writeMeta(sessionKey: string, record: ArtifactRecord): Promise<void> {
    const d = await ensureSessionDirs(this.baseDir, sessionKey);
    const metaDir = path.join(d.root, '.meta');
    await fs.mkdir(metaDir, { recursive: true });
    const safe = record.id.replace(/[^a-zA-Z0-9_-]/g, '_');
    await fs.writeFile(path.join(metaDir, `${safe}.json`), JSON.stringify(record, null, 2), 'utf8');
  }

  private async readMeta(sessionKey: string, id: string): Promise<ArtifactRecord | undefined> {
    const d = sessionDirs(this.baseDir, sessionKey);
    const safe = id.replace(/[^a-zA-Z0-9_-]/g, '_');
    try {
      const raw = await fs.readFile(path.join(d.root, '.meta', `${safe}.json`), 'utf8');
      return JSON.parse(raw) as ArtifactRecord;
    } catch { return undefined; }
  }
}

function extFor(mediaType: string): string {
  switch (mediaType) {
    case 'image/png': return 'png';
    case 'image/jpeg': return 'jpg';
    case 'image/webp': return 'webp';
    case 'image/gif': return 'gif';
    case 'image/svg+xml': return 'svg';
    default: return 'bin';
  }
}
