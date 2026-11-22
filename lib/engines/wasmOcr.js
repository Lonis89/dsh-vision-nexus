export class WasmOcrEngine {
    /** 配置 getter：面板开关热更新后即时生效。 */
    getEnabled;
    adapter;
    constructor(enabled, adapter) {
        this.getEnabled = typeof enabled === 'function' ? enabled : () => enabled;
        this.adapter = adapter;
    }
    /** 链路可用性：开关打开即视为可进入（无适配器时给结构化降级占位，不中断会话）。 */
    get available() {
        return this.getEnabled();
    }
    /** 真实能力：是否装载了 WASM OCR 适配器（能力 / 健康报告据此，不夸大）。 */
    get effective() {
        return this.getEnabled() && Boolean(this.adapter);
    }
    get enabled() {
        return this.getEnabled();
    }
    /** 该工具能否用 OCR 兜底。 */
    supports(op) {
        return this.available && ['vision_glance', 'vision_ground', 'vision_long_ocr'].includes(op);
    }
    async run(req) {
        if (!this.enabled)
            throw new Error('WASM 本地 OCR 兜底已禁用');
        if (!this.supports(req.op))
            throw new Error(`WASM OCR 无法兜底工具 ${req.op}`);
        const paths = req.params._image_paths ?? [];
        const language = typeof req.params.language === 'string' ? req.params.language : 'auto';
        if (this.adapter) {
            const result = await this.adapter(paths, language);
            return {
                data: {
                    text: result.text,
                    segments: result.segments,
                    notice: '当前由 WASM 本地 OCR 兜底提供结果，仅含可识别文本，无法回答需要视觉语义的问题。',
                },
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
                notice: '远端 VL 与本地 CV 均不可用，已降级到 WASM 本地 OCR 兜底，但当前运行时未装载 OCR 模型，' +
                    '无法提取任何图像信息。请稍后重试或配置可用的 VL 后端；模型不得据此脑补图片内容。',
            },
            confidence: 0,
            engine: 'wasm-ocr',
            artifactPaths: [],
        };
    }
}
