/**
 * dsh-vision-nexus — 会话隔离 & 状态持久化
 *
 *  - 每个会话拥有独立的工作目录（图片 / 裁剪 / 临时渲染文件互相隔离）。
 *  - 每个会话独立维护：激活状态、图片索引、审计日志、并发计数、等待队列。
 *  - 会话状态可持久化（session-state.json），支持会话内反复引用 Artifact。
 *  - 空闲会话自动回收，避免内存泄漏。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { setInterval, clearInterval } from 'node:timers';
import type { SessionState, VisionConfig, ImageRef } from './types.js';

/** 会话键归一化：从 exec 上下文提取稳定、隔离的 sessionKey。 */
export function sessionKeyOf(exec: any): string {
  const id =
    exec?.agent?.session?.id ??
    exec?.agent?.session?.header?.id ??
    exec?.sessionId ??
    exec?.scope?.key ??
    'global';
  // 去掉路径分隔符等危险字符，避免目录穿越。
  return String(id).replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120) || 'global';
}

/** 会话隔离根目录：DSH 工作目录下 .dsh-vision-nexus/sessions/<sessionKey>。 */
export function sessionRoot(baseDir: string, sessionKey: string): string {
  return path.join(baseDir, '.dsh-vision-nexus', 'sessions', sessionKey);
}

/** 会话内的工作子目录集合。 */
export function sessionDirs(baseDir: string, sessionKey: string) {
  const root = sessionRoot(baseDir, sessionKey);
  return {
    root,
    images: path.join(root, 'images'),
    artifacts: path.join(root, 'artifacts'),
    temp: path.join(root, 'temp'),
    state: path.join(root, 'session-state.json'),
  };
}

/** 确保会话目录树存在（所有写入前的统一入口）。 */
export async function ensureSessionDirs(baseDir: string, sessionKey: string) {
  const d = sessionDirs(baseDir, sessionKey);
  await fs.mkdir(d.images, { recursive: true });
  await fs.mkdir(d.artifacts, { recursive: true });
  await fs.mkdir(d.temp, { recursive: true });
  return d;
}

function emptyState(sessionKey: string): SessionState {
  return {
    sessionKey,
    activated: false,
    images: new Map(),
    nextImageIndex: 0,
    audit: [],
    running: 0,
    queue: [],
    lastAccess: Date.now(),
  };
}

/**
 * 会话状态管理器。并发控制、队列、图片索引、审计、持久化的统一宿主。
 */
export class SessionManager {
  private states = new Map<string, SessionState>();
  /** 配置 getter：并发上限 / 队列长度 / 清理周期等面板字段热更新后即时生效。 */
  private readonly getConfig: () => VisionConfig;
  private readonly baseDir: string;
  private gcTimer: NodeJS.Timeout | undefined;
  private readonly idleTtlMs = 1000 * 60 * 60 * 6; // 6h 空闲回收

  constructor(baseDir: string, config: VisionConfig | (() => VisionConfig)) {
    this.baseDir = baseDir;
    this.getConfig = typeof config === 'function' ? config : () => config;
  }

  private get config(): VisionConfig {
    return this.getConfig();
  }

  /** 取（或惰性创建并加载持久化的）会话状态。 */
  async get(sessionKey: string): Promise<SessionState> {
    const existing = this.states.get(sessionKey);
    if (existing) {
      existing.lastAccess = Date.now();
      return existing;
    }
    const state = emptyState(sessionKey);
    if (this.config.persistSessionState) {
      try {
        const d = sessionDirs(this.baseDir, sessionKey);
        const raw = await fs.readFile(d.state, 'utf8');
        const saved = JSON.parse(raw) as Partial<SessionState>;
        state.activated = saved.activated === true;
        state.nextImageIndex = typeof saved.nextImageIndex === 'number' ? saved.nextImageIndex : 0;
        if (Array.isArray(saved.images)) {
          for (const ref of saved.images as ImageRef[]) state.images.set(ref.id, ref);
        }
      } catch {
        // 首次使用 / 损坏的状态文件：从空白开始，不阻塞会话。
      }
    }
    this.states.set(sessionKey, state);
    return state;
  }

  /** 持久化会话状态（图片索引 + 激活态）。审计日志单独存，避免污染。 */
  async persist(sessionKey: string): Promise<void> {
    if (!this.config.persistSessionState) return;
    const state = this.states.get(sessionKey);
    if (!state) return;
    const d = await ensureSessionDirs(this.baseDir, sessionKey);
    const snapshot = {
      activated: state.activated,
      nextImageIndex: state.nextImageIndex,
      images: [...state.images.values()],
      updatedAt: Date.now(),
    };
    await fs.writeFile(d.state, JSON.stringify(snapshot, null, 2), 'utf8');
  }

  /** 登记一张托管图像，返回其会话内索引 id。批量任务自动维护索引。 */
  async registerImage(sessionKey: string, ref: Omit<ImageRef, 'id'>, hint?: string): Promise<ImageRef> {
    const state = await this.get(sessionKey);
    const id = hint && /^[a-zA-Z0-9_.:-]+$/.test(hint)
      ? hint
      : `img:${state.nextImageIndex++}`;
    const full: ImageRef = { ...ref, id };
    state.images.set(id, full);
    await this.persist(sessionKey);
    return full;
  }

  /** 解析图像 id：不存在返回 undefined（强制模型走工具登记链路，不能脑补）。 */
  async resolveImage(sessionKey: string, imageId: string): Promise<ImageRef | undefined> {
    const state = await this.get(sessionKey);
    return state.images.get(imageId);
  }

  /** 列出会话内全部图像索引。 */
  async listImages(sessionKey: string): Promise<ImageRef[]> {
    const state = await this.get(sessionKey);
    return [...state.images.values()];
  }

  // ───────── 并发控制：串行优先，超限排队 ─────────

  /**
   * 获取一个执行槽。并发未超限立即返回；超限则进入队列等待，
   * 返回 { queued:true, position } 让调用方把排队状态回传模型。
   */
  async acquire(sessionKey: string): Promise<{ release: () => void; queued: boolean; position: number }> {
    const state = await this.get(sessionKey);
    if (state.running < this.config.sessionConcurrency) {
      state.running++;
      // 捕获 state 对象引用而非 sessionKey：dispose 后同名会话重建时，
      // 旧任务的 release 只作用于它自己那一份（已从 Map 删除的）state，
      // 不会误减新 state 的 running 或误唤醒新队列，避免并发槽位超发。
      return { release: () => this.releaseState(state), queued: false, position: 0 };
    }
    if (state.queue.length >= this.config.maxQueueLength) {
      throw new Error(`会话 ${sessionKey} 等待队列已满（上限 ${this.config.maxQueueLength}），请稍后重试`);
    }
    const position = state.queue.length + 1;
    await new Promise<void>((resolve) => state.queue.push(resolve));
    state.running++;
    return { release: () => this.releaseState(state), queued: true, position };
  }

  /** 释放一个执行槽：作用于 acquire 时捕获的那份 state 对象（与 sessionKey 解耦）。 */
  private releaseState(state: SessionState): void {
    state.running = Math.max(0, state.running - 1);
    const next = state.queue.shift();
    if (next) next();
  }

  /**
   * 把当前所有内存会话标记为「已激活」。用于 loadingStrategy 从 eager 热切到
   * progressive：eager 模式下工具全量注册、从不设置 activated，若不迁移会让
   * 既有会话在切换后被渐进门禁全部拦住。持久化失败不影响内存状态。
   */
  async activateAll(): Promise<void> {
    for (const key of [...this.states.keys()]) {
      const state = this.states.get(key);
      if (!state || state.activated) continue;
      state.activated = true;
      // eslint-disable-next-line no-await-in-loop
      await this.persist(key);
    }
  }

  /** 全局并发负载快照（供设置面板「当前运行状态」展示）。 */
  load(): { queuedTasks: number; runningTasks: number } {
    let queuedTasks = 0;
    let runningTasks = 0;
    for (const state of this.states.values()) {
      queuedTasks += state.queue.length;
      runningTasks += state.running;
    }
    return { queuedTasks, runningTasks };
  }

  // ───────── 审计 & 临时文件清理 ─────────

  /** 启动空闲会话回收 + 临时文件定时清理。通过 ctx.effect 注册 disposer。 */
  startMaintenance(): () => void {
    const timer = setInterval(() => void this.maintenance(), this.config.cleanupIntervalMs);
    this.gcTimer = timer;
    // 不阻塞进程退出。
    if (typeof timer.unref === 'function') timer.unref();
    return () => {
      if (this.gcTimer) clearInterval(this.gcTimer);
      this.gcTimer = undefined;
    };
  }

  private async maintenance(): Promise<void> {
    const now = Date.now();
    // 回收空闲会话状态。
    for (const [key, state] of this.states) {
      if (state.running === 0 && state.queue.length === 0 && now - state.lastAccess > this.idleTtlMs) {
        this.states.delete(key);
      }
    }
    // 面板「自动清理」关闭 / 保留时长=never(0) 时跳过临时文件清理。
    const cfg = this.config;
    if (!cfg.autoCleanupEnabled || cfg.tempRetentionMs <= 0) return;
    // 清理超过保留时长的临时文件（按会话隔离目录）。
    const sessionsRoot = path.join(this.baseDir, '.dsh-vision-nexus', 'sessions');
    try {
      const entries = await fs.readdir(sessionsRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const temp = path.join(sessionsRoot, entry.name, 'temp');
        try {
          const files = await fs.readdir(temp);
          for (const file of files) {
            const fp = path.join(temp, file);
            const st = await fs.stat(fp);
            if (now - st.mtimeMs > cfg.tempRetentionMs) {
              await fs.rm(fp, { force: true });
            }
          }
        } catch { /* 目录不存在：跳过 */ }
      }
    } catch { /* 根目录不存在：尚无会话 */ }
  }

  /** 会话销毁：清空内存状态（保留磁盘 Artifact 供会话内反复引用）。 */
  disposeSession(sessionKey: string): void {
    const state = this.states.get(sessionKey);
    if (!state) return;
    // 唤醒并清空等待队列，避免悬挂 Promise。
    for (const resolve of state.queue) resolve();
    state.queue.length = 0;
    this.states.delete(sessionKey);
  }
}
