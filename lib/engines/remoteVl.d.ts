import type { EngineRequest, EngineResult, VisionConfig } from '../types.js';
/** 凭据解析函数：由主入口注入 ctx.credentials.resolve。 */
export type CredentialResolver = (ref: string) => Promise<string | undefined>;
/** 远端 VL 路由引擎。 */
export declare class RemoteVlEngine {
    /** 配置用 getter 注入：设置面板 volatile 更新后无需重启即可读到新后端列表。 */
    private readonly getConfig;
    private readonly resolveCredential;
    private readonly fetchImpl;
    constructor(config: VisionConfig | (() => VisionConfig), resolveCredential: CredentialResolver);
    /** 当前（热生效后的）配置。 */
    private get config();
    /** 解析按优先级排序、已启用的自定义后端。 */
    private customBackends;
    /**
     * 是否有任何可用远端能力（不含 WASM 兜底）。
     * 内置匿名兜底：`builtinVlEnabled` 开启即视为声明可用（无需显式 keyRef/baseURL，
     * 实际端点由部署环境注入；未注入时该跳会被跳过并降级，不中断会话）。
     */
    hasRemote(): boolean;
    /**
     * 依次尝试：自定义 VL 后端（优先级） → 内置兜底 VL 链路。
     * 返回第一个成功的引擎结果；全失败抛错（由调度层触发 WASM OCR 降级）。
     *
     * @param onHop 每跳过一个后端记录一次真实降级跳（审计）。`to` 要么是链里
     *   下一个「会被尝试」的后端引擎，要么是调度层传入的 `finalNext`（整条 VL
     *   链失败后真正会进入的下一引擎，如 wasm-ocr）。没有下一跳时不发 hop，
     *   避免伪造跳转目的地。
     * @param finalNext 整条 VL 链失败后，降级链里真实的下一引擎（无则 undefined）。
     */
    run<T = unknown>(req: EngineRequest, onHop?: (from: string, to: string, reason: string) => void, finalNext?: string): Promise<EngineResult<T>>;
    /** OpenAI 兼容 chat/completions 调用（带 image_url）。 */
    private callVl;
    /** 读取托管图像字节，转 base64 供远端请求使用（仅插件内部）。 */
    private loadImages;
}
