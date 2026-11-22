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
  segments: Array<{ text: string; bbox?: [number, number, number, number]; confidence: number }>;
  confidence: number;
}>;

export class WasmOcrEngine {
  /** 配置 getter：面板开关热更新后即时生效。 */
  private readonly getEnabled: () => boolean;
  private readonly adapter: WasmOcrAdapter | undefined;

  constructor(enabled: boolean | (() => boolean), adapter?: WasmOcrAdapter) {
    this.getEnabled = typeof enabled === 'function' ? enabled : () => enabled;
    this.adapter = adapter;
  }

  /** 链路可用性：开关打开即视为可进入（无适配器时给结构化降级占位，不中断会话）。 */
  get available(): boolean {
    return this.getEnabled();
  }

  /** 真实能力：是否装载了 WASM OCR 适配器（能力 / 健康报告据此，不夸大）。 */
  get effective(): boolean {
    return this.getEnabled() && Boolean(this.adapter);
  }

  private get enabled(): boolean {
    return this.getEnabled();
  }

  /** 该工具能否用 OCR 兜底。 */
  supports(op: string): boolean {
    return this.available && ['vision_glance', 'vision_ground', 'vision_long_ocr'].includes(op);
  }

  async run<T = unknown>(req: EngineRequest): Promise<EngineResult<T>> {
    if (!this.enabled) throw new Error('WASM 本地 OCR 兜底已禁用');
    if (!this.supports(req.op)) throw new Error(`WASM OCR 无法兜底工具 ${req.op}`);

    const paths = (req.params._image_paths as string[] | undefined) ?? [];
    const language = typeof req.params.language === 'string' ? req.params.language : 'auto';

    if (this.adapter) {
      const result = await this.adapter(paths, language);
      return {
        data: {
          text: result.text,
          segments: result.segments,
          notice: '当前由 WASM 本地 OCR 兜底提供结果，仅含可识别文本，无法回答需要视觉语义的问题。',
        } as unknown as T,
        confidence: Math.min(0.5, result.confidence), // OCR 兜底置信度上限
        engine: 'wasm-ocr',
        artifactPaths: [],
      };
    }

    // 结构化降级占位：不编造内容，明确能力限制与低置信度。
    return {
      data: {
        text: '',
        segments: [],
        notice:
          '远端 VL 与本地 CV 均不可用，已降级到 WASM 本地 OCR 兜底，但当前运行时未装载 OCR 模型，' +
          '无法提取任何图像信息。请稍后重试或配置可用的 VL 后端；模型不得据此脑补图片内容。',
      } as unknown as T,
      confidence: 0,
      engine: 'wasm-ocr',
      artifactPaths: [],
    };
  }
}
