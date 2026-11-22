import type { EngineRequest, EngineResult, VisionConfig } from '../types.js';
/** 本地 CV 引擎支持的操作 → cv_worker.py 的 op 名。 */
export declare const LOCAL_OPS: Record<string, string>;
/** 探测 Python 解释器可用性。返回可执行命令或 null。 */
export declare function probePython(config: VisionConfig): Promise<string | null>;
/** 探测 CV 运行时脚本是否存在（含依赖自检）。 */
export declare function probeRuntime(config: VisionConfig, python: string, pluginRoot: string): Promise<boolean>;
/** 本地 CV 引擎：把任务转交给 Python 运行时，回收结构化结果。 */
export declare class LocalCvEngine {
    private readonly python;
    private readonly script;
    /** 配置 getter：超时 / 分块 / 压缩质量等面板字段热更新后即时生效。 */
    private readonly getConfig;
    private readonly pluginRoot;
    /** Python / 运行时探测结果（构造后不变）。 */
    private readonly runtimeOk;
    /** 面板开关（volatile 更新时由调度层同步，实现热生效）。 */
    private enabled;
    constructor(config: VisionConfig | (() => VisionConfig), pluginRoot: string, python: string | null, runtimeOk: boolean);
    private get config();
    /** 是否可用：运行时探测通过 且 面板开关开启。 */
    get available(): boolean;
    /** 运行时是否就绪（不受面板开关影响，供摄取时的无损压缩预处理使用）。 */
    get runtimeReady(): boolean;
    /**
     * 图像上传前压缩预处理：按配置的最长边降采样 + 质量压缩。
     * 走独立的 `preprocess` worker op，返回新字节与元信息；不可压缩时返回 null，
     * 调用方保留原图。不依赖面板开关——压缩只是降本，不改变引擎能力门禁。
     */
    preprocess(bytes: Buffer, config: VisionConfig): Promise<{
        data: Buffer;
        mediaType: string;
        width: number;
        height: number;
    } | null>;
    /** 热更新面板开关（由 scheduler/volatile-update 驱动）。 */
    setEnabled(enabled: boolean): void;
    supports(op: string): boolean;
    /**
     * 执行一个像素计算任务。
     * 通过一次性子进程 + JSON 行协议通信；超时由调度层统一熔断，
     * 这里再加一层硬超时兜底，确保子进程不泄漏。
     */
    run<T = unknown>(req: EngineRequest): Promise<EngineResult<T>>;
    private exec;
}
