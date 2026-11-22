/**
 * dsh-vision-nexus — 引擎 A：本地计算引擎（Python CV 运行时）
 *
 *  - 拉起本地 Python CV 运行时（runtime/cv_worker.py），通过 stdin/stdout 的
 *    JSON 行协议通信，承载像素级计算任务。
 *  - 支持：元素检测、坐标标注、区域裁剪、像素差异比对、前景抠图、主色提取、
 *    图形矢量化、HTML 渲染截图校验、长图分段结构化 OCR。
 *  - 支持离线运行，所有计算结果带置信度。
 *  - Python 缺失时 probe() 返回 false，调度层自动禁用本地像素类工具，
 *    切换为纯路由模式并通知模型可用工具子集变化。
 */
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { EngineRequest, EngineResult, VisionConfig } from '../types.js';

/** 本地 CV 引擎支持的操作 → cv_worker.py 的 op 名。 */
export const LOCAL_OPS: Record<string, string> = {
  vision_detect: 'detect',
  vision_crop: 'crop',
  vision_pixel_diff: 'pixel_diff',
  vision_extract_foreground: 'extract_foreground',
  vision_color_extract: 'color_extract',
  vision_trace_svg: 'trace_svg',
  vision_html_render_snapshot: 'html_render_snapshot',
  vision_long_ocr: 'long_ocr',
  // 坐标标注由 detect 附带产出；ground 在有检测结果时可直接取本地坐标。
};

/** 探测 Python 解释器可用性。返回可执行命令或 null。 */
export async function probePython(config: VisionConfig): Promise<string | null> {
  const candidates = config.pythonPath
    ? [config.pythonPath]
    : ['python3', 'python', 'py'];
  for (const cmd of candidates) {
    // eslint-disable-next-line no-await-in-loop
    if (await tryRun(cmd, ['-c', 'import sys; print(sys.version)'])) return cmd;
  }
  return null;
}

/** 探测 CV 运行时脚本是否存在（含依赖自检）。 */
export async function probeRuntime(config: VisionConfig, python: string, pluginRoot: string): Promise<boolean> {
  const script = resolveRuntimePath(config, pluginRoot);
  try {
    await fs.access(script);
  } catch { return false; }
  return tryRun(python, [script, '--probe']);
}

function resolveRuntimePath(config: VisionConfig, pluginRoot: string): string {
  const p = config.cvRuntimePath || 'runtime/cv_worker.py';
  return path.isAbsolute(p) ? p : path.join(pluginRoot, p);
}

function tryRun(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => { if (!settled) { settled = true; resolve(ok); } };
    try {
      const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const timer = setTimeout(() => { child.kill(); finish(false); }, 5000);
      child.on('error', () => { clearTimeout(timer); finish(false); });
      child.on('close', (code) => { clearTimeout(timer); finish(code === 0); });
    } catch { finish(false); }
  });
}

/** 本地 CV 引擎：把任务转交给 Python 运行时，回收结构化结果。 */
export class LocalCvEngine {
  private readonly python: string;
  private readonly script: string;
  /** 配置 getter：超时 / 分块 / 压缩质量等面板字段热更新后即时生效。 */
  private readonly getConfig: () => VisionConfig;
  private readonly pluginRoot: string;
  /** Python / 运行时探测结果（构造后不变）。 */
  private readonly runtimeOk: boolean;
  /** 面板开关（volatile 更新时由调度层同步，实现热生效）。 */
  private enabled: boolean;

  constructor(
    config: VisionConfig | (() => VisionConfig),
    pluginRoot: string,
    python: string | null,
    runtimeOk: boolean,
  ) {
    this.getConfig = typeof config === 'function' ? config : () => config;
    const snapshot = this.getConfig();
    this.pluginRoot = pluginRoot;
    this.python = python ?? 'python';
    this.script = resolveRuntimePath(snapshot, pluginRoot);
    this.runtimeOk = python !== null && runtimeOk;
    // 运行模式折算：remote-only 下本地 CV 视为禁用（与 Scheduler/healthSelfCheck 同口径）。
    // 压缩预处理走 runtimeReady（不受此开关影响），仅能力门禁受 runMode 约束。
    this.enabled = snapshot.localCvEnabled && snapshot.runMode !== 'remote-only';
  }

  private get config(): VisionConfig {
    return this.getConfig();
  }

  /** 是否可用：运行时探测通过 且 面板开关开启。 */
  get available(): boolean {
    return this.enabled && this.runtimeOk;
  }

  /** 运行时是否就绪（不受面板开关影响，供摄取时的无损压缩预处理使用）。 */
  get runtimeReady(): boolean {
    return this.runtimeOk;
  }

  /**
   * 图像上传前压缩预处理：按配置的最长边降采样 + 质量压缩。
   * 走独立的 `preprocess` worker op，返回新字节与元信息；不可压缩时返回 null，
   * 调用方保留原图。不依赖面板开关——压缩只是降本，不改变引擎能力门禁。
   */
  async preprocess(
    bytes: Buffer,
    config: VisionConfig,
  ): Promise<{ data: Buffer; mediaType: string; width: number; height: number } | null> {
    if (!this.runtimeOk) return null;
    let workdir = '';
    try {
      workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'vnx-pre-'));
      const src = path.join(workdir, 'input.img');
      await fs.writeFile(src, bytes);
      const payload = JSON.stringify({
        op: 'preprocess',
        params: { _image_paths: [src] },
        workdir,
        config: {
          preprocessMaxEdgePx: config.preprocessMaxEdgePx,
          preprocessQuality: config.preprocessQuality,
        },
      });
      const stdout = await this.exec(payload);
      const parsed = JSON.parse(stdout.trim().split('\n').filter(Boolean).pop() ?? '{}');
      if (!parsed.data?.changed || !Array.isArray(parsed.artifact_paths) || !parsed.artifact_paths[0]) {
        return null;
      }
      const data = await fs.readFile(parsed.artifact_paths[0]);
      const mediaType = typeof parsed.data.media_type === 'string'
        ? parsed.data.media_type : 'application/octet-stream';
      return {
        data,
        mediaType,
        width: Number(parsed.data.width) || 0,
        height: Number(parsed.data.height) || 0,
      };
    } catch {
      // 压缩失败一律降级为原图，绝不中断摄取。
      return null;
    } finally {
      if (workdir) { try { await fs.rm(workdir, { recursive: true, force: true }); } catch { /* ignore */ } }
    }
  }

  /** 热更新面板开关（由 scheduler/volatile-update 驱动）。 */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  supports(op: string): boolean {
    return this.available && op in LOCAL_OPS;
  }

  /**
   * 执行一个像素计算任务。
   * 通过一次性子进程 + JSON 行协议通信；超时由调度层统一熔断，
   * 这里再加一层硬超时兜底，确保子进程不泄漏。
   */
  async run<T = unknown>(req: EngineRequest): Promise<EngineResult<T>> {
    if (!this.available) throw new Error('本地 CV 引擎不可用');
    const op = LOCAL_OPS[req.op];
    if (!op) throw new Error(`本地 CV 引擎不支持操作 ${req.op}`);

    const payload = JSON.stringify({
      op,
      image_ids: req.imageIds,
      params: req.params,
      workdir: req.workdir,
      config: {
        tileEdgePx: this.config.tileEdgePx,
        preprocessMaxEdgePx: this.config.preprocessMaxEdgePx,
        preprocessQuality: this.config.preprocessQuality,
        browserRenderEnabled: this.config.browserRenderEnabled,
        autoTileEnabled: this.config.autoTileEnabled,
      },
    });

    // req.ctx 在部分调用方（自检 / 宿主适配器）可能缺失，安全取 signal。
    const stdout = await this.exec(payload, req.ctx?.signal);
    let parsed: { data?: T; confidence?: number; artifact_paths?: string[] };
    try {
      parsed = JSON.parse(stdout.trim().split('\n').filter(Boolean).pop() ?? '{}');
    } catch {
      throw new Error('本地 CV 运行时返回了无法解析的结果');
    }
    return {
      data: (parsed.data ?? {}) as T,
      confidence: clamp01(parsed.confidence ?? 0.6),
      engine: 'local-cv',
      artifactPaths: Array.isArray(parsed.artifact_paths) ? parsed.artifact_paths : [],
    };
  }

  private exec(payload: string, signal?: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const child = spawn(this.python, ['-X', 'utf8', this.script, '--run'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: this.pluginRoot,
      });
      let out = '';
      let err = '';
      // 子进程提前退出（崩溃/被 kill）时，往已关闭的 stdin 写会触发 EPIPE 'error'；
      // Node 对无监听器的流 'error' 会抛出未处理异常并可能终止宿主进程。统一吞掉，
      // 任务结果由 close / error 事件负责 settle。
      child.stdin.on('error', () => {});
      child.stdout.on('error', () => {});
      child.stderr.on('error', () => {});
      // worker 的错误信息是中文：必须按 UTF-8 解码。Windows 下不指定编码会按
      // 系统代码页（GBK）解码，导致「越界」「无交集」等提示变成不可读乱码，
      // 上层降级链与模型都会拿到坏文本。python 侧同时用 -X utf8 固定输出编码。
      child.stdout.on('data', (d) => (out += d.toString('utf8')));
      child.stderr.on('data', (d) => (err += d.toString('utf8')));
      const timer = setTimeout(() => {
        child.kill();
        if (!settled) { settled = true; reject(new Error('本地 CV 任务超时')); }
      }, this.config.taskTimeoutMs + 2000);
      const onAbort = () => {
        child.kill();
        if (!settled) { settled = true; reject(new Error('本地 CV 任务被取消')); }
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      child.on('error', (e) => {
        clearTimeout(timer);
        if (!settled) { settled = true; reject(e); }
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        if (settled) return;
        settled = true;
        if (code === 0) { resolve(out); return; }
        // worker 即使因参数错误 exit 1，也会在 stdout 输出一行结构化 JSON
        // （fail(): {data:{error}, confidence:0, artifact_paths:[]}）。优先把其中
        // 的 error 暴露给上层，让降级链 / 审计 / 模型看到真实原因，而不是丢失成
        // 泛化的「运行时退出(1)」。解析失败时保留原有 stderr 摘要。
        let detail = err.slice(0, 200);
        try {
          const last = out.trim().split('\n').filter(Boolean).pop();
          if (last) {
            const parsed = JSON.parse(last) as { data?: { error?: unknown } };
            const msg = parsed?.data?.error;
            if (typeof msg === 'string' && msg) detail = msg.slice(0, 300);
          }
        } catch { /* 非 JSON 输出：沿用 stderr 摘要 */ }
        reject(new Error(`本地 CV 运行时退出(${code}): ${detail}`));
      });
      child.stdin.end(payload + '\n');
    });
  }
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
}
