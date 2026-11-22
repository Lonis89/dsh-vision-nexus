/**
 * dsh-vision-nexus — 工具 schema 定义（标准化）
 *
 * 严格按需求输出的 11 个标准化工具名。每个工具声明：
 *  - name / description（给主模型看的语义）
 *  - parameters（入参 JSON Schema 子集：type / enum / required / description / items）
 *  - output.schema（统一信封 VisionEnvelope 的 JSON Schema）
 *  - engine hint（标记该工具默认走哪个引擎、是否属于像素计算类）
 *
 * 统一返回信封（所有工具都必须带）：
 *  {
 *    data,                 // 业务结果（结构化文本，绝不含图像二进制）
 *    confidence,           // 置信度 0..1
 *    artifactIds: string[],// 产物 Artifact ID 列表
 *    engine,               // 'local-cv'|'custom-vl'|'builtin-vl'|'wasm-ocr'|'none'
 *    degraded,            // 是否降级
 *    degradeChain,        // 降级链
 *    capabilityNotice?,   // 降级时告知模型当前能力限制
 *    auditId              // 审计记录 ID
 *  }
 *
 * 关键点：模型不能绕过工具直接脑补图片内容 —— 入参只接受托管后的
 * `image_id`（Artifact 索引）或 HTML 字符串，绝不接收 / 返回 base64 原图；
 * 工具结果的 render() 也只输出文本信封。
 */
import type { EngineSource } from './types.js';
/**
 * 统一输出信封的「原始 JSON Schema」（已编译形态）。
 * 本文件里的 defineTool 直接把它作为 output.schema 传给 ctx.tools.register，
 * 因此这里必须是受支持的子集语法：对象级 required 为 string[]，字段里不再带
 * author 形态的 `required: true` 布尔。
 * 注释型（无 type / 约束关键字）的 data 节点表示「未约束 JSON」。
 */
export declare const ENVELOPE_OUTPUT_SCHEMA: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly required: readonly ["data", "confidence", "artifactIds", "engine", "degraded", "degradeChain", "auditId"];
    readonly properties: {
        readonly data: {
            readonly description: "业务结果（结构化文本 / 数值 / 坐标，绝不含图像二进制或 base64）";
        };
        readonly confidence: {
            readonly type: "number";
            readonly description: "置信度 0..1";
        };
        readonly artifactIds: {
            readonly type: "array";
            readonly items: {
                readonly type: "string";
            };
            readonly description: "本次调用产出的 Artifact ID 列表";
        };
        readonly engine: {
            readonly type: "string";
            readonly enum: readonly ["local-cv", "custom-vl", "builtin-vl", "wasm-ocr", "none"];
            readonly description: "实际完成任务的引擎来源标记";
        };
        readonly degraded: {
            readonly type: "boolean";
            readonly description: "是否发生过降级";
        };
        readonly degradeChain: {
            readonly type: "array";
            readonly items: {
                readonly type: "object";
                readonly additionalProperties: false;
                readonly required: readonly ["from", "to", "reason", "at"];
                readonly properties: {
                    readonly from: {
                        readonly type: "string";
                    };
                    readonly to: {
                        readonly type: "string";
                    };
                    readonly reason: {
                        readonly type: "string";
                    };
                    readonly at: {
                        readonly type: "number";
                    };
                };
            };
            readonly description: "降级链（仅 degraded=true 时非空）";
        };
        readonly capabilityNotice: {
            readonly type: "string";
            readonly description: "降级时告知模型当前能力限制";
        };
        readonly auditId: {
            readonly type: "string";
            readonly description: "审计记录 ID，可单独输出";
        };
        readonly queued: {
            readonly type: "boolean";
            readonly description: "并发超限时任务在队列中排队";
        };
        readonly queuePosition: {
            readonly type: "number";
            readonly description: "排队序号";
        };
    };
};
/** 工具默认引擎倾向 & 是否依赖本地 CV 像素计算。 */
export interface ToolMeta {
    name: string;
    /** 默认优先引擎。 */
    prefer: EngineSource;
    /** 是否为「本地像素计算类」工具：Python 缺失时自动禁用。 */
    pixelClass: boolean;
    /** 是否能被 WASM OCR 兜底（文本/理解类）。 */
    ocrFallback: boolean;
    parameters: Record<string, unknown>;
    description: string;
}
/**
 * 全部 11 个标准化工具定义。
 * 顺序即渐进激活后注册到工具表的顺序。
 */
export declare const TOOL_DEFINITIONS: ToolMeta[];
/** 工具名 → 元数据索引。 */
export declare const TOOL_MAP: Map<string, ToolMeta>;
/** 需要本地 CV 运行时的工具名集合（Python 缺失时自动禁用）。 */
export declare const PIXEL_TOOLS: Set<string>;
/** 可被 WASM OCR 兜底的工具名集合。 */
export declare const OCR_FALLBACK_TOOLS: Set<string>;
/** 渐进激活时需要动态注册的「全套视觉工具」（不含激活指令自身）。 */
export declare const VISION_TOOL_NAMES: string[];
