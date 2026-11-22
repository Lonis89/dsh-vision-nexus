/**
 * dsh-vision-nexus — 工具技能层（渐进按需激活 / 全量预加载）
 *
 *  - 默认「渐进」策略：会话初始化时只暴露 `vision_activate` 一条激活指令，
 *    把全套视觉工具的 schema 从系统提示词里省下来（减少 token 开销）。
 *  - 模型首次需要视觉能力时调用 vision_activate → 动态注册全部 vision_* 工具，
 *    并触发 `tools/change` 让宿主刷新工具表。
 *  - 「全量预加载」策略：apply() 时一次性注册全部工具，vision_activate 退化为幂等状态查询。
 *  - 激活 / 注册都按会话隔离；某会话激活不影响其它会话。
 *
 * 重要：工具注册是「进程级」的（ctx.tools.register），但每个工具在 execute 时
 * 通过 exec 拿到 sessionKey 做隔离；渐进激活态则按会话记录在 SessionManager 中。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { VisionConfig, VisionEnvelope } from './types.js';
import { Scheduler } from './scheduler.js';
import { SessionManager } from './session.js';
import { VISION_TOOL_NAMES } from './toolSchemas.js';
/**
 * defineTool 的轻量本地实现：把「作者友好的参数 spec」编译成
 * ctx.tools.register 需要的 ToolDefinition（parameters / output.schema / execute）。
 * 与 DSH 内置 defineTool 行为对齐：参数校验、输出 schema、render 投影。
 */
export declare function defineTool(options: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    outputSchema?: unknown;
    render: (args: Record<string, unknown>, value: VisionEnvelope) => Array<{
        type: string;
        text?: string;
        [k: string]: unknown;
    }>;
    execute: (args: Record<string, unknown>, exec: any) => Promise<VisionEnvelope>;
}): any;
/** 把统一信封投影成给主模型看的文本（绝不回传图像二进制 / base64）。 */
export declare function renderEnvelope(_args: Record<string, unknown>, value: VisionEnvelope): Array<{
    type: string;
    text: string;
}>;
/** 工具技能层：管理渐进激活与工具注册。 */
export declare class ToolSkillLayer {
    private readonly ctx;
    /** 配置 getter：加载策略 / 面板字段热更新后即时生效。 */
    private readonly getConfig;
    private readonly scheduler;
    private readonly sessions;
    /** 已注册的工具名 → disposer。 */
    private registered;
    /** 是否已完成全量注册（进程级，避免重复注册）。 */
    private fullRegistered;
    constructor(ctx: Context, config: VisionConfig | (() => VisionConfig), scheduler: Scheduler, sessions: SessionManager);
    private get config();
    /** 会话初始化：按策略注册工具。 */
    init(): Promise<void>;
    /** 渐进模式：仅注册 vision_activate。 */
    private registerActivateOnly;
    /** 注册全套视觉工具（渐进激活 / 全量预加载共用）。 */
    registerFullSet(): Promise<void>;
    /**
     * 激活整套视觉工具集：首次需要视觉时调用；幂等。
     * 返回当前可用工具子集、引擎健康状态与能力边界说明。
     */
    private activate;
    /** 当前已注册的视觉工具名清单（供设置面板「已注册工具清单」展示）。 */
    registeredTools(): string[];
    /** 卸载全部工具注册（ctx.effect disposer 调用）。 */
    dispose(): void;
}
/** 渐进激活后对外暴露的工具名清单（供健康自检 / 文档使用）。 */
export { VISION_TOOL_NAMES };
