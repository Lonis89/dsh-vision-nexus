import type { Context } from '@deepseek-ai/cordis';
import type { VisionConfig, EngineHealth } from './types.js';
/** 插件名（与 package.json / cordis.patch.yml 一致）。 */
export declare const name = "dsh-vision-nexus";
/**
 * 依赖的宿主服务（Cordis inject 契约）。
 *
 * 只把「没有它插件就没有意义」的 tools 作为硬依赖。attachments / credentials /
 * workingDirectory 都是可降级的增强项：硬 inject 一个宿主未提供的服务会让
 * fiber 永久挂起（插件装上了却永远不激活），因此改用 ctx.get 可选探测。
 */
export declare const inject: string[];
/** 配置 schema（schemastery）。设置页 / profile patch 据此校验与编辑。 */
export declare const Config: any;
/** 类型化配置导出（供二次开发引用）。 */
export type { VisionConfig } from './types.js';
export { TOOL_DEFINITIONS, ENVELOPE_OUTPUT_SCHEMA } from './toolSchemas.js';
export { DEFAULTS, RETENTION_MS, defaultPanelConfig } from './config.js';
export { ROUTES } from './routes.js';
/**
 * 健康自检：探测全部引擎与工具子集，返回结构化报告。
 * 供插件设置页 / 命令 / 外部诊断调用；不执行任何视觉任务、不触碰图像。
 */
export declare function healthSelfCheck(ctx: Context, config?: Partial<VisionConfig>): Promise<{
    ok: boolean;
    plugin: string;
    engines: EngineHealth;
    mode: 'full' | 'route-only';
    tools: {
        total: number;
        capable: number;
        disabled: string[];
    };
    wasmOcrLoaded: boolean;
    checkedAt: number;
}>;
/**
 * Cordis 插件入口。
 * @param ctx    Cordis 上下文（宿主注入 tools / attachments / credentials 等服务）
 * @param config 归一化前的配置（可能带 schemastery 的 getter 包装）
 */
export declare function apply(ctx: Context, rawConfig?: Record<string, unknown>): void;
