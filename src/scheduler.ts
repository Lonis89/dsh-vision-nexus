/**
 * dsh-vision-nexus — 调度层核心
 *
 * 负责：凭证管理（委托 credentials）、会话隔离、任务队列、并发控制、
 * 超时熔断、错误脱敏、会话状态持久化、统一结果信封、完整审计链路。
 *
 * 降级优先级（需求硬性约束）：
 *   本地 CV 引擎 → 自定义 VL 后端 → 内置兜底 VL 链路 → WASM 本地 OCR 兜底
 * 每一次降级自动在审计日志标记，并在 capabilityNotice 里告知模型当前能力限制。
 *
 * 关键安全约束：原图 / base64 绝不进入主 LLM 上下文；工具结果只回传
 * 结构化文本 + Artifact ID + 置信度 + 引擎标记 + 降级标记。
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type {
  VisionEnvelope, VisionConfig, EngineSource, DegradeHop, TaskContext, ImageRef,
} from './types.js';
import { SessionManager, sessionKeyOf, sessionDirs } from './session.js';
import { ArtifactStore, preprocessImage } from './artifacts.js';
import { AuditLog, beginAudit, noteDegrade, redactError, type AuditDraft } from './audit.js';
import { LocalCvEngine } from './engines/localCv.js';
import { RemoteVlEngine } from './engines/remoteVl.js';
import { WasmOcrEngine } from './engines/wasmOcr.js';
import { PIXEL_TOOLS, OCR_FALLBACK_TOOLS, TOOL_MAP } from './toolSchemas.js';

export interface SchedulerDeps {
  /** 配置用 getter 注入：volatile 字段热更新后调度参数（超时/并发/质量）即时生效。 */
  getConfig: () => VisionConfig;
  sessions: SessionManager;
  artifacts: ArtifactStore;
  audit: AuditLog;
  /** 通过 getter 读取，使异步健康探测完成后重建的引擎能即时生效。 */
  getLocalCv: () => LocalCvEngine;
  /**
   * 可选：等待本地 CV 运行时探测完成。摄取（尤其启动早期的首批图片）先等待它，
   * 消除「探测完成前压缩被跳过」的窗口；无 Python 时探测会正常结束并降级。
   * 实现方需自带超时上限，避免探测卡死阻塞摄取。
   */
  waitForLocalRuntime?: () => Promise<void>;
  remoteVl: RemoteVlEngine;
  wasmOcr: WasmOcrEngine;
  baseDir: string;
}

/** 引擎健康 / 可用工具子集（激活时与自检时告知模型）。 */
export interface CapabilitySnapshot {
  localCv: boolean;
  customVlBackends: number;
  builtinVl: boolean;
  wasmOcr: boolean;
  capableTools: string[];
  disabledTools: string[];
  mode: 'full' | 'route-only';
  notice: string;
}

export class Scheduler {
  private readonly deps: SchedulerDeps;

  constructor(deps: SchedulerDeps) {
    this.deps = deps;
  }

  /**
   * 图像摄取入口：把宿主收到的图片字节压缩预处理后登记为会话内 Artifact，
   * 返回其 Artifact id（同时进入会话图片索引）。原图 / base64 绝不进入模型上下文，
   * 模型只拿到 id。
   * 由事件钩子（检测到消息里的图片附件）或宿主主动调用。
   */
  async ingest(
    sessionKey: string,
    bytes: Buffer,
    opts: { mediaType?: string; label?: string } = {},
  ): Promise<{ id: string; ref: ImageRef }> {
    const config = this.deps.getConfig();
    // 等待本地运行时探测完成，消除启动窗口内「首批图片跳过压缩」的竞态。
    // 探测 Promise 只 resolved 不 reject（内部已 try/catch），失败也视为探测结束，
    // 随后 runtimeReady 仍为 false，照常降级为原图——不中断摄取。
    if (this.deps.waitForLocalRuntime) await this.deps.waitForLocalRuntime();
    // 有效压缩边长：取全局预处理上限与「所有启用后端 maxImageEdgePx」的最小值。
    // 这样每个后端声明的 maxImageEdgePx 都能真正约束摄取期字节，避免大图超出
    // 某个后端的尺寸上限触发 413 / token 超限；缺省 2048 > 全局 1280 时不改变现状。
    const effectiveEdge = effectivePreprocessEdge(config);
    // 压缩预处理：本地运行时就绪时按最长边降采样 + 质量压缩，降低存储 / base64 体积；
    // 运行时缺失或压缩无收益时 preprocessImage 原样返回，绝不中断摄取。
    let prepared = await preprocessImage(bytes, config);
    const localCv = this.deps.getLocalCv();
    if (localCv.runtimeReady && Number.isFinite(effectiveEdge)) {
      const compressConfig = { ...config, preprocessMaxEdgePx: effectiveEdge };
      const compressed = await localCv.preprocess(prepared.data, compressConfig);
      if (compressed && compressed.data.length > 0) {
        prepared = {
          data: compressed.data,
          mediaType: compressed.mediaType,
          width: compressed.width || prepared.width,
          height: compressed.height || prepared.height,
          oversized: config.autoTileEnabled
            && Math.max(compressed.width || prepared.width, compressed.height || prepared.height) > config.oversizeEdgePx,
          tiles: prepared.tiles,
        };
      }
    }
    const mediaType = opts.mediaType ?? prepared.mediaType;
    const reg = await this.deps.artifacts.register(sessionKey, prepared.data, {
      mediaType,
      width: prepared.width,
      height: prepared.height,
      label: opts.label ?? '会话图片',
    });
    // 同步登记到会话图片索引：沿用同一个 Artifact id，保证
    // artifacts.list() 与 sessions.listImages() 指向同一张图（批量任务自动维护索引）。
    const ref = await this.deps.sessions.registerImage(sessionKey, {
      mediaType,
      width: prepared.width,
      height: prepared.height,
      bytes: prepared.data.length,
      oversized: prepared.oversized,
      tiles: prepared.tiles,
      origin: opts.label,
    }, reg.id);
    // 大图标记：供 glance 分块采样判定（模型不得一次性全图 glance）。
    void ref;
    return { id: reg.id, ref };
  }

  /** 当前可用能力快照。Python 缺失 → 禁用像素类工具 → 纯路由模式。 */
  async capabilities(): Promise<CapabilitySnapshot> {
    const { getConfig, getLocalCv, wasmOcr } = this.deps;
    const config = getConfig();
    // 运行模式折算：local-only 禁用远端路由，remote-only 禁用本地 CV。
    // 与健康自检 healthSelfCheck 保持同一口径（runMode 必须在运行时真正生效）。
    const localEligible = config.runMode !== 'remote-only';
    const remoteEffective = config.runMode !== 'local-only';
    const localOk = localEligible && getLocalCv().available;
    const customCount = config.vlBackends.filter((b) => b.enabled && b.id && b.baseURL && b.keyRef).length;
    // 与健康自检 healthSelfCheck 同语义：`builtinVlEnabled` 开关本身即视为声明可用
    // （匿名兜底端点由部署环境注入；未注入时 run 会跳过该跳并降级，不中断会话）。
    const builtin = config.builtinVlEnabled || Boolean(config.builtinVlKeyRef && config.builtinVlBaseURL);
    const hasRemote = remoteEffective && (customCount > 0 || builtin);
    // 真实能力：WASM 仅在装载适配器时计入「可用」（未装载时只作结构化降级占位）。
    const wasm = wasmOcr.effective;

    const capableTools: string[] = [];
    const disabledTools: string[] = [];
    for (const [name] of TOOL_MAP) {
      if (name === 'vision_activate') { capableTools.push(name); continue; }
      const pixel = PIXEL_TOOLS.has(name);
      // 像素类工具必须有本地 CV；非像素类（glance/ground/long_ocr）只能由
      // 远端 VL 或 WASM OCR 完成——本地 CV 的 LOCAL_OPS 不含 glance/ground，
      // 不能仅因 localCv 可用就把它们误判为 capable。
      const ok = pixel ? localOk : (hasRemote || wasm);
      (ok ? capableTools : disabledTools).push(name);
    }
    const mode: 'full' | 'route-only' = localOk ? 'full' : 'route-only';
    const notice = localOk
      ? '本地 CV 引擎可用：全部像素计算类工具已启用。'
      : '本地 CV 引擎不可用（缺少 Python 运行环境或运行模式为仅远端）：已自动禁用像素计算类工具，切换为纯路由模式（远端 VL / WASM OCR 兜底）。';
    return {
      localCv: localOk, customVlBackends: customCount, builtinVl: builtin,
      wasmOcr: wasm, capableTools, disabledTools, mode, notice,
    };
  }

  /**
   * 执行一个视觉工具调用（activate 由 toolSkill 层单独处理）。
   * 统一完成：排队 → 超时熔断 → 引擎降级 → Artifact 登记 → 统一信封 → 审计提交。
   */
  async execute<T = unknown>(
    toolName: string,
    args: Record<string, unknown>,
    exec: any,
  ): Promise<VisionEnvelope<T>> {
    const { getConfig, sessions, artifacts, audit } = this.deps;
    const config = getConfig();
    const sessionKey = sessionKeyOf(exec);
    const draft: AuditDraft = beginAudit(toolName, args, sessionKey);

    // ── 并发控制：串行优先，超限排队 ──
    let slot: { release: () => void; queued: boolean; position: number };
    try {
      slot = await sessions.acquire(sessionKey);
    } catch (e) {
      await audit.commit(draft, {
        engine: 'none', confidence: 0, artifactIds: [], status: 'error',
        errorDigest: redactError(e),
      });
      return this.envelope<T>({} as T, {
        auditId: draft.auditId, engine: 'none', confidence: 0,
        artifactIds: [], degraded: false, degradeChain: [],
        capabilityNotice: redactError(e),
      });
    }

    try {
      // ── 能力门禁：像素类工具在本地 CV 缺失/被 runMode 禁用时拒绝调用并告知子集变化 ──
      const localEligible = config.runMode !== 'remote-only';
      if (PIXEL_TOOLS.has(toolName) && (!localEligible || !this.deps.getLocalCv().available)) {
        const why = localEligible
          ? 'Python CV 运行时不可用'
          : '当前运行模式为仅远端（runMode=remote-only），本地 CV 已禁用';
        const notice = `工具 ${toolName} 属于本地像素计算类，${why}，已被自动禁用；可用工具子集已变化，请改用纯路由工具（glance / ground / long_ocr）。`;
        await audit.commit(draft, {
          engine: 'none', confidence: 0, artifactIds: [], status: 'error', errorDigest: notice,
        });
        return this.envelope<T>({ notice } as unknown as T, {
          auditId: draft.auditId, engine: 'none', confidence: 0,
          // 能力缺失拒绝不是「降级」：没有跳到任何其他引擎，degradeChain 为空。
          artifactIds: [], degraded: false, degradeChain: [], capabilityNotice: notice,
        });
      }

      // ── 排队状态：超限时任务在队列中等待轮次，并把「曾排队」信息随结果回传模型 ──
      // 说明：工具调用是单次往返，排队不会丢弃任务——acquire() 会在轮到本任务时
      // 解除阻塞继续执行，最终信封里带上 queued / queuePosition 让模型知晓排队情况。
      const queuedInfo = slot.queued
        ? { queued: true as const, queuePosition: slot.position }
        : undefined;

      // ── 解析输入图像路径（会话隔离），注入引擎请求 ──
      const params = await this.resolveImagePaths(sessionKey, args);
      // 面板「OCR 识别语言」：工具未显式指定 language 时，用配置值填充，
      // 供 WASM OCR / cv_worker 的长图 OCR 使用（zh / en / mix）。
      // 压缩质量 / 分块 / 预处理尺寸由 LocalCvEngine 的 config getter 下发（热生效）。
      if (params.language === undefined || params.language === 'auto') {
        params.language = config.ocrLanguage;
      }

      // ── 独立超时熔断：AbortSignal 下发给各引擎，同时用 Promise.race 硬兜底 ──
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, config.taskTimeoutMs);
      const taskCtx: TaskContext = {
        sessionKey, auditId: draft.auditId, toolName, signal: controller.signal,
      };
      const workdir = sessionDirs(this.deps.baseDir, sessionKey).temp;
      const imageIds = collectImageIds(args);

      const timeoutGuard = new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(new Error('TASK_TIMEOUT')), { once: true });
      });
      const work = this.runWithDegradation<T>(toolName, {
        op: toolName, imageIds, params, workdir, ctx: taskCtx,
      }, draft);

      let result: { data: T; confidence: number; engine: EngineSource; artifactPaths: string[] };
      try {
        result = await Promise.race([work, timeoutGuard]);
      } catch (e) {
        const isTimeout = timedOut || (e instanceof Error && e.message === 'TASK_TIMEOUT');
        const status = isTimeout ? 'timeout' : 'error';
        // 冻结快照：Promise.race 的败者（work）仍可能在后台 noteDegrade 追加，
        // 这里取一次性切片，保证 degraded 与 degradeChain 严格一致、且不被后台改写。
        const chainSnapshot = draft.degradeChain.slice();
        const degraded = chainSnapshot.length > 0;
        const notice = isTimeout
          ? `任务 ${toolName} 超时（>${config.taskTimeoutMs}ms），已熔断；${degraded ? '已触发降级，当前能力受限。' : '未发生引擎降级。'}`
          : `任务 ${toolName} 执行失败；${degraded ? '已触发降级链，当前能力受限。' : '未发生引擎降级。'}${redactError(e)}`;
        await audit.commit(draft, {
          engine: 'none', confidence: 0, artifactIds: [], status,
          errorDigest: redactError(e),
        });
        return this.envelope<T>({ notice } as unknown as T, {
          auditId: draft.auditId, engine: 'none', confidence: 0,
          artifactIds: [], degraded, degradeChain: chainSnapshot,
          capabilityNotice: degraded && config.degradeNotifyAgent ? notice : undefined,
        });
      } finally {
        clearTimeout(timer);
      }

      // ── 产物登记为 Artifact（裁剪 / 热力图 / 色板 / SVG / 截图 / 抠图） ──
      // 面板「自动保存产物」关闭时不注册为 Artifact（仍把产物路径留给引擎清理）。
      const artifactIds: string[] = [];
      if (config.autoSaveArtifacts) {
        for (const p of result.artifactPaths) {
          // eslint-disable-next-line no-await-in-loop
          const bytes = await readArtifactBytes(p);
          if (!bytes) continue;
          // 依据源产物扩展名保留真实类型（SVG / HTML 不能被 sniff 成 octet-stream → .bin）。
          const ext = path.extname(p).replace(/^\./, '').toLowerCase();
          const mediaType = mediaTypeForExt(ext, bytes);
          // eslint-disable-next-line no-await-in-loop
          const reg = await artifacts.register(sessionKey, bytes, {
            label: `${toolName} 产物`, temporary: false,
            ...(ext ? { ext } : {}),
            mediaType,
          });
          artifactIds.push(reg.id);
        }
      }

      // 降级时告知模型能力限制；「降级日志提示」关闭时不写 capabilityNotice。
      const degraded = draft.degradeChain.length > 0;
      const capabilityNotice = degraded && config.degradeNotifyAgent
        ? this.capabilityNoticeFor(result.engine)
        : undefined;

      // 面板「置信度告警阈值」：低于阈值时追加二次校验提醒（不改动置信度数值）。
      const lowConfidence = result.confidence < config.confidenceAlertThreshold;
      const confidenceNotice = lowConfidence
        ? `本次结果置信度 ${result.confidence.toFixed(2)} 低于告警阈值 ${config.confidenceAlertThreshold.toFixed(2)}，建议二次校验（换工具 / 复核坐标 / 重跑）。`
        : undefined;

      // 把置信度告警并入 capabilityNotice（统一信封的「能力/质量提示」字段）。
      const mergedNotice = [capabilityNotice, confidenceNotice].filter(Boolean).join(' ') || undefined;

      // ── 统一信封 ──
      const envelope = this.envelope<T>(result.data, {
        auditId: draft.auditId, engine: result.engine, confidence: result.confidence,
        artifactIds, degraded, degradeChain: draft.degradeChain,
        capabilityNotice: mergedNotice,
        ...(queuedInfo ?? {}),
      });
      // 排队信息以可读文本一并告知模型。
      if (queuedInfo) {
        envelope.data = {
          ...(typeof result.data === 'object' && result.data !== null ? result.data : { value: result.data }),
          _queue: `本任务曾在会话队列中排队（位置 ${queuedInfo.queuePosition}，并发上限 ${config.sessionConcurrency}），轮次到达后已执行。`,
        } as unknown as T;
      }

      // ── 审计提交（单独落盘，不进入主回答） ──
      await audit.commit(draft, {
        engine: result.engine, confidence: result.confidence,
        artifactIds, status: 'ok',
      });
      return envelope;
    } finally {
      slot.release();
    }
  }

  /**
   * 降级链执行：本地 CV → 自定义 VL → 内置兜底 VL → WASM OCR。
   *
   * 关键正确性约束（审计 / degraded 标记）：
   *  - 「降级」= 某个在优先级链里的引擎被实际尝试后失败，且确实跳到了链中
   *    「下一个会被尝试的引擎」。只有这类跳变才写 DegradeHop。
   *  - 任务本身不属于某引擎能力范围（如本地 CV 不覆盖 glance）属正常路由，不记 hop。
   *  - 「没有配置任何远端后端」而直接走 WASM 兜底，是正常路由，不记 hop。
   *  - hop 的 `to` 必须是链里真实会被尝试的下一跳，不能写死。
   *  - 远端引擎内部的后端优先级跳变由 RemoteVlEngine 通过 onHop 唯一上报，
   *    调度层不再重复补 hop（避免重复 / 伪造 from）。
   */
  private async runWithDegradation<T>(
    toolName: string,
    baseReq: { op: string; imageIds: string[]; params: Record<string, unknown>; workdir: string; ctx: TaskContext },
    draft: AuditDraft,
  ): Promise<{ data: T; confidence: number; engine: EngineSource; artifactPaths: string[] }> {
    const { getLocalCv, remoteVl, wasmOcr } = this.deps;
    const localCv = getLocalCv();
    const config = this.deps.getConfig();
    // runMode 在运行时真正生效：local-only 禁用远端路由（含隐私含义——绝不外发图像），
    // remote-only 禁用本地 CV。capabilities()/healthSelfCheck 使用同一折算口径。
    const localEligible = config.runMode !== 'remote-only';
    const remoteEffective = config.runMode !== 'local-only';
    const pixel = PIXEL_TOOLS.has(toolName);
    const ocrFallback = OCR_FALLBACK_TOOLS.has(toolName);
    const remoteEligible = remoteEffective && (!pixel || ocrFallback); // 像素类里只有 long_ocr 可走远端
    const wasmEligible = wasmOcr.supports(toolName);

    // 本任务真正会依次尝试的引擎链（用于让 hop.to 指向真实下一跳）。
    const chain: EngineSource[] = [];
    if (pixel && localEligible) chain.push('local-cv');
    if (remoteEligible && remoteVl.hasRemote()) chain.push('custom-vl'); // 代表整条自定义/内置 VL 链
    if (wasmEligible) chain.push('wasm-ocr');
    const nextAfter = (engine: EngineSource): EngineSource | undefined => {
      const i = chain.indexOf(engine);
      return i >= 0 ? chain[i + 1] : undefined;
    };

    // ① 本地 CV 引擎优先（像素类 / 本地 OCR 类任务的首选实现）。
    if (pixel && localEligible && localCv.supports(toolName)) {
      try {
        return await localCv.run<T>(baseReq);
      } catch (e) {
        const to = nextAfter('local-cv');
        if (to) {
          // 真实降级：本地失败后确有下一跳会被尝试。
          noteDegrade(draft, 'local-cv', to, redactError(e));
        } else {
          // 链里没有下一跳（纯像素类且无 OCR 兜底）：无处可降级，直接失败，不记 hop。
          throw e;
        }
      }
    } else if (pixel) {
      // 像素类但本地 CV 不可用：能力缺失，非降级（上层能力门禁已拦截此情形）。
      throw new Error('像素计算类工具需要本地 CV 引擎');
    }
    // 非像素理解类任务本地 CV 不覆盖 → 正常进入远端路由，不记 hop。

    // ② 自定义 VL 后端 → ③ 内置兜底 VL 链路。
    // RemoteVlEngine 内部按 priority 串联，每跳过一个后端 / 全部失败时通过 onHop
    // 上报「from → 真实下一跳」；最后一条 onHop 指向 'wasm-ocr'（本链最后一跳）。
    if (remoteEligible && remoteVl.hasRemote()) {
      const finalNext = nextAfter('custom-vl'); // 通常为 'wasm-ocr'，无则 undefined
      try {
        return await remoteVl.run<T>(baseReq, (from, to, reason) => {
          // 只记录「跨引擎」的真实降级：同一引擎内部的后端优先级重试
          // （from === to，如 custom-vl → custom-vl）不算引擎级降级，避免审计噪声。
          if (from === to) return;
          noteDegrade(draft, from as EngineSource, to as EngineSource, reason);
        }, finalNext);
      } catch (e) {
        // 全部远端链路失败：RemoteVlEngine 的最后一条 onHop 已记录「最后后端 → wasm-ocr」，
        // 这里不再补 hop，避免重复与伪造 from。仅记一条终止原因到审计即可。
        void e;
      }
    }
    // 注意：remoteEligible 但无可用远端后端时直接落到 WASM 兜底，属正常路由，不记 hop（P1）。

    // ④ WASM 本地 OCR 兜底（最低兜底，不中断会话）。
    if (wasmEligible) {
      try {
        return await wasmOcr.run<T>(baseReq);
      } catch (e) {
        throw new Error(`WASM OCR 兜底失败：${redactError(e)}`);
      }
    }
    throw new Error('降级链已耗尽：没有任何可用引擎能完成该任务');
  }

  /** 把工具入参里的 image_id 解析为会话隔离目录内的绝对路径（引擎层内部使用）。 */
  private async resolveImagePaths(
    sessionKey: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = { ...args };
    const d = sessionDirs(this.deps.baseDir, sessionKey);
    // 一次性读取会话内 Artifact 索引，避免重复 IO。
    const index = await this.deps.artifacts.list(sessionKey);
    const byId = new Map(index.map((a) => [a.id, a]));
    const paths: string[] = [];
    const seen = new Set<string>();
    for (const value of Object.values(args)) {
      if (typeof value !== 'string') continue;
      const hit = byId.get(value);
      if (hit) {
        const abs = path.join(d.root, hit.relPath);
        if (!seen.has(abs)) { seen.add(abs); paths.push(abs); }
        continue;
      }
      // 回退：允许宿主直接传入「会话隔离目录内」的绝对路径，便于离线 / 临时文件场景。
      if (path.isAbsolute(value)) {
        const normalized = path.resolve(value);
        if (normalized.startsWith(path.resolve(d.root) + path.sep) && !seen.has(normalized)) {
          seen.add(normalized);
          paths.push(normalized);
        }
      }
    }
    out._image_paths = paths;
    return out;
  }

  /** 构造降级能力限制说明。 */
  private capabilityNoticeFor(engine: EngineSource): string {
    switch (engine) {
      case 'wasm-ocr':
        return '已降级到 WASM 本地 OCR 兜底：仅能提供可识别文本，无法回答需要视觉语义 / 像素计算的问题；请勿据此推断图中不存在的细节。';
      case 'builtin-vl':
        return '已降级到内置兜底 VL 链路：优先后端异常，当前结果置信度可能下降。';
      case 'custom-vl':
        return '本地 CV 未覆盖该任务，已由远端 VL 路由完成；不含像素级量化结果。';
      default:
        return '引擎发生降级，当前能力受限，请结合置信度谨慎采用结果。';
    }
  }

  /** 统一结果信封构造器。 */
  private envelope<T>(
    data: T,
    o: {
      auditId: string; engine: EngineSource; confidence: number;
      artifactIds: string[]; degraded: boolean; degradeChain: DegradeHop[];
      capabilityNotice?: string; queued?: boolean; queuePosition?: number;
    },
  ): VisionEnvelope<T> {
    return {
      data, confidence: o.confidence, artifactIds: o.artifactIds,
      engine: o.engine, degraded: o.degraded, degradeChain: o.degradeChain,
      ...(o.capabilityNotice ? { capabilityNotice: o.capabilityNotice } : {}),
      auditId: o.auditId,
      ...(o.queued ? { queued: true, queuePosition: o.queuePosition ?? 0 } : {}),
    };
  }
}

/**
 * 摄取期有效压缩边长：全局 preprocessMaxEdgePx 与所有启用后端 maxImageEdgePx 的最小值。
 * 让每后端尺寸约束真正生效（token 上限控制），且无后端时用全局值；隔离为纯函数便于验证。
 */
export function effectivePreprocessEdge(config: VisionConfig): number {
  const backendEdge = config.vlBackends
    .filter((b) => b.enabled && typeof b.maxImageEdgePx === 'number' && b.maxImageEdgePx > 0)
    .reduce((min, b) => Math.min(min, b.maxImageEdgePx as number), Number.POSITIVE_INFINITY);
  return Math.min(config.preprocessMaxEdgePx, backendEdge);
}

/** 收集入参里出现的图像 id（审计 / 引擎请求用）。 */
function collectImageIds(args: Record<string, unknown>): string[] {
  const ids: string[] = [];
  for (const [k, v] of Object.entries(args)) {
    if (/^image/i.test(k) && typeof v === 'string') ids.push(v);
  }
  return ids;
}

async function readArtifactBytes(p: string): Promise<Buffer | undefined> {
  try {
    return await fs.readFile(p);
  } catch { return undefined; }
}

/** 产物扩展名 → MIME；文本型产物（SVG/HTML）按内容补判，避免被当成二进制。 */
function mediaTypeForExt(ext: string, bytes: Buffer): string {
  switch (ext) {
    case 'svg': return 'image/svg+xml';
    case 'html': case 'htm': return 'text/html';
    case 'png': return 'image/png';
    case 'jpg': case 'jpeg': return 'image/jpeg';
    case 'webp': return 'image/webp';
    case 'gif': return 'image/gif';
    default: {
      const head = bytes.subarray(0, 256).toString('utf8').trimStart().toLowerCase();
      if (head.startsWith('<svg') || head.startsWith('<?xml')) return 'image/svg+xml';
      if (head.startsWith('<!doctype html') || head.startsWith('<html')) return 'text/html';
      return 'application/octet-stream';
    }
  }
}
