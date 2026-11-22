import type { VisionEnvelope, VisionConfig, ImageRef } from './types.js';
import { SessionManager } from './session.js';
import { ArtifactStore } from './artifacts.js';
import { AuditLog } from './audit.js';
import { LocalCvEngine } from './engines/localCv.js';
import { RemoteVlEngine } from './engines/remoteVl.js';
import { WasmOcrEngine } from './engines/wasmOcr.js';
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
export declare class Scheduler {
    private readonly deps;
    constructor(deps: SchedulerDeps);
    /**
     * 图像摄取入口：把宿主收到的图片字节压缩预处理后登记为会话内 Artifact，
     * 返回其 Artifact id（同时进入会话图片索引）。原图 / base64 绝不进入模型上下文，
     * 模型只拿到 id。
     * 由事件钩子（检测到消息里的图片附件）或宿主主动调用。
     */
    ingest(sessionKey: string, bytes: Buffer, opts?: {
        mediaType?: string;
        label?: string;
    }): Promise<{
        id: string;
        ref: ImageRef;
    }>;
    /** 当前可用能力快照。Python 缺失 → 禁用像素类工具 → 纯路由模式。 */
    capabilities(): Promise<CapabilitySnapshot>;
    /**
     * 执行一个视觉工具调用（activate 由 toolSkill 层单独处理）。
     * 统一完成：排队 → 超时熔断 → 引擎降级 → Artifact 登记 → 统一信封 → 审计提交。
     */
    execute<T = unknown>(toolName: string, args: Record<string, unknown>, exec: any): Promise<VisionEnvelope<T>>;
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
    private runWithDegradation;
    /** 把工具入参里的 image_id 解析为会话隔离目录内的绝对路径（引擎层内部使用）。 */
    private resolveImagePaths;
    /** 构造降级能力限制说明。 */
    private capabilityNoticeFor;
    /** 统一结果信封构造器。 */
    private envelope;
}
/**
 * 摄取期有效压缩边长：全局 preprocessMaxEdgePx 与所有启用后端 maxImageEdgePx 的最小值。
 * 让每后端尺寸约束真正生效（token 上限控制），且无后端时用全局值；隔离为纯函数便于验证。
 */
export declare function effectivePreprocessEdge(config: VisionConfig): number;
