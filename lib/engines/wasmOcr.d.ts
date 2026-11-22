/**
 * dsh-vision-nexus — WASM 本地 OCR 兜底引擎
 *
 *  - 作为降级链最底层：远端 VL 服务全部异常时自动降级到本地 OCR，不中断会话。
 *  - 离线可用，仅能覆盖「文本 / 理解类」工具（glance / ground / long_ocr），
 *    像素计算类工具不可用时会明确告知模型能力限制。
 *  - 纯本地执行，不涉及任何密钥 / 网络。
 *
 * 实现说明：这里保留一个可插拔的 WASM OCR 适配点。若宿主环境提供了 WASM
 * OCR 运行时（通过 `ocrAdapter` 注入），则走真实识别；否则使用「结构化降级
 * 占位」：明确返回低置信度 + 能力限制说明，绝不编造图中内容（严禁脑补）。
 */
import type { EngineRequest, EngineResult } from '../types.js';
/** 可注入的 WASM OCR 适配器签名。 */
export type WasmOcrAdapter = (imagePaths: string[], language?: string) => Promise<{
    text: string;
    segments: Array<{
        text: string;
        bbox?: [number, number, number, number];
        confidence: number;
    }>;
    confidence: number;
}>;
export declare class WasmOcrEngine {
    /** 配置 getter：面板开关热更新后即时生效。 */
    private readonly getEnabled;
    private readonly adapter;
    constructor(enabled: boolean | (() => boolean), adapter?: WasmOcrAdapter);
    /** 链路可用性：开关打开即视为可进入（无适配器时给结构化降级占位，不中断会话）。 */
    get available(): boolean;
    /** 真实能力：是否装载了 WASM OCR 适配器（能力 / 健康报告据此，不夸大）。 */
    get effective(): boolean;
    private get enabled();
    /** 该工具能否用 OCR 兜底。 */
    supports(op: string): boolean;
    run<T = unknown>(req: EngineRequest): Promise<EngineResult<T>>;
}
