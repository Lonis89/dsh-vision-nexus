/**
 * dsh-vision-nexus — 共享类型定义
 *
 * 设计约束（来自需求）：
 *  - 主模型本身不具备看图能力，所有图像信息必须通过本插件工具调用获取。
 *  - 插件底层绝不允许把原图 / base64 注入主 LLM 上下文；图片统一压缩预处理、
 *    base64 托管在「会话隔离」的 Artifact 存储里，工具结果只回传结构化文本与
 *    Artifact ID。
 *  - 所有工具结果统一包含：置信度、产物 Artifact ID 列表、引擎来源、是否降级。
 */
/** 引擎来源标记。优先级：local-cv > custom-vl > builtin-vl > wasm-ocr。 */
export type EngineSource = 'local-cv' | 'custom-vl' | 'builtin-vl' | 'wasm-ocr' | 'none';
/** 降级链上的每一跳（审计日志用）。 */
export interface DegradeHop {
    from: EngineSource;
    to: EngineSource;
    reason: string;
    at: number;
}
/** 引擎探测 / 健康状态。 */
export interface EngineHealth {
    /** 本地 Python CV 运行时是否可用。缺失时自动禁用像素类工具。 */
    localCv: boolean;
    /** 自定义 VL 后端配置数量（凭据已在配置存储中登记）。 */
    customVlBackends: number;
    /** 内置兜底 VL 链路是否声明可用。 */
    builtinVl: boolean;
    /** WASM 本地 OCR 兜底是否可用。 */
    wasmOcr: boolean;
    /** 当前可用工具子集（受引擎可用性影响，激活时告知模型）。 */
    capableTools: string[];
    /** 被禁用的工具子集。 */
    disabledTools: string[];
}
/**
 * 所有视觉工具返回值的公共信封。
 * 各工具在 `data` 中放置自己的结构化结果；`render()` 负责把信封投影成
 * 给模型看的文本（绝不回传图像二进制）。
 */
export interface VisionEnvelope<T = unknown> {
    /** 业务结果。 */
    data: T;
    /** 置信度 0..1。多段任务取加权均值。 */
    confidence: number;
    /** 本次调用产出的 Artifact ID 列表（裁剪子图 / 热力图 / 渲染截图 / 色板 / SVG 等）。 */
    artifactIds: string[];
    /** 实际完成任务的引擎来源。 */
    engine: EngineSource;
    /** 是否发生过降级。 */
    degraded: boolean;
    /** 降级链（仅 degraded=true 时非空）。 */
    degradeChain: DegradeHop[];
    /** 当前能力限制说明（降级时告知模型）。 */
    capabilityNotice?: string;
    /** 本次调用的审计记录 ID，可单独输出，不污染主回答。 */
    auditId: string;
    /** 排队状态：并发超限时任务进入队列，返回 queued=true。 */
    queued?: boolean;
    /** 排队序号（仅 queued=true 时有意义）。 */
    queuePosition?: number;
}
/** 托管在 Artifact 存储中的图像引用。模型只看到 id 与元信息，看不到字节。 */
export interface ImageRef {
    /** 会话内唯一索引，如 img:0 / art:crop-3。批量任务自动维护。 */
    id: string;
    /** 压缩预处理后的 MIME。 */
    mediaType: string;
    width: number;
    height: number;
    /** 压缩后字节数。 */
    bytes: number;
    /** 是否为超高密度大图（触发分块采样，禁止一次性全图 glance）。 */
    oversized: boolean;
    /** 分块数量（大图 >0）。 */
    tiles: number;
    /** 原始文件 / 来源描述（脱敏后）。 */
    origin?: string;
}
/** 标准化坐标框（像素坐标，原点左上）。 */
export interface BBox {
    x: number;
    y: number;
    width: number;
    height: number;
}
/** 单个被检测元素。 */
export interface DetectedElement {
    /** 元素编号（从 1 开始，供 ground / crop 引用）。 */
    index: number;
    label: string;
    bbox: BBox;
    confidence: number;
}
/** 自定义 VL 后端（OpenAI 兼容格式）。敏感字段只存 keyRef / baseURL 引用名。 */
export interface VlBackend {
    /** 稳定 id。 */
    id: string;
    /** 展示名。 */
    label: string;
    /**
     * 优先级（数字越小越优先），由 resolveConfig 按数组顺序自动生成，
     * 面板拖拽排序即优先级。外部写入的 priority 会被忽略——请勿手写此字段，
     * 调整优先级请直接重排 vlBackends 数组顺序。
     */
    priority: number;
    /** 凭据在插件配置存储 / 凭证服务中的引用名（绝不存明文密钥）。 */
    keyRef: string;
    /** OpenAI 兼容 chat/completions 端点地址（保存在加密配置中，不进上下文）。 */
    baseURL: string;
    /** 模型名。 */
    model: string;
    /** 最大图片尺寸（最长边 px），请求前压缩到该尺寸。 */
    maxImageEdgePx?: number;
    /** 是否启用。 */
    enabled: boolean;
}
/** 工具加载策略。 */
export type LoadingStrategy = 'progressive' | 'eager';
/** 运行模式（面板「运行模式总开关」区）。 */
export type RunMode = 'auto' | 'local-only' | 'remote-only';
/** OCR 识别语言（面板「引擎 B」区）。 */
export type OcrLanguage = 'zh' | 'en' | 'mix';
/** 临时文件保留时长档位（面板「产物与存储」区）。 */
export type RetentionPreset = '1h' | '6h' | '24h' | '72h' | '7d' | 'never';
/** 面板扩展的 VL 后端条目（在核心 VlBackend 上补充展示用字段）。 */
export interface PanelVlBackend {
    id: string;
    label: string;
    /** 接口地址（明文保存在插件配置存储，不进模型上下文）。 */
    baseURL: string;
    /** 凭据引用名；明文 API Key 由凭证服务保管，面板只编辑引用名。 */
    keyRef: string;
    model: string;
    /** 最大图片尺寸（最长边 px），请求前压缩到该尺寸。 */
    maxImageEdgePx: number;
    enabled: boolean;
}
/**
 * 插件完整配置。对应 schemastery 的 Config。
 * 注意：密钥 / baseURL 的明文不进入此结构，后端只保存 keyRef 引用名，
 * 真正的值由 `ctx.credentials` 在调度层解析。
 */
export interface VisionConfig {
    /** 总开关：启用/禁用视觉插件。关闭时所有 vision_* 工具不注册。 */
    enabled: boolean;
    /** 运行模式：自动自适应 / 仅本地 CV / 仅远端 VL 路由。 */
    runMode: RunMode;
    /** 大图自动分块策略开关。 */
    autoTileEnabled: boolean;
    /** 渲染截图（HTML→图片）浏览器内核检测开关。 */
    browserRenderEnabled: boolean;
    /** OCR 识别语言。 */
    ocrLanguage: OcrLanguage;
    /** 置信度告警阈值（0..1），低于该值触发二次校验提醒。 */
    confidenceAlertThreshold: number;
    /** 降级发生时是否主动通知 Agent。 */
    degradeNotifyAgent: boolean;
    /** 临时文件自动清理开关。 */
    autoCleanupEnabled: boolean;
    /** 临时文件保留时长档位。 */
    retentionPreset: RetentionPreset;
    /** 自动保存 diff 热力图 / 裁剪子图 / SVG 矢量产物。 */
    autoSaveArtifacts: boolean;
    /** 工具加载策略：默认渐进按需激活。 */
    loadingStrategy: LoadingStrategy;
    /** 单会话并发上限（串行优先，默认 1）。 */
    sessionConcurrency: number;
    /** 队列最大长度，超出返回过载错误。 */
    maxQueueLength: number;
    /** 单个视觉任务独立超时（毫秒）。 */
    taskTimeoutMs: number;
    /** 大图判定阈值（最长边像素），超过触发分块采样。 */
    oversizeEdgePx: number;
    /** 大图分块边长。 */
    tileEdgePx: number;
    /** 压缩预处理最长边（统一降采样，减少 token / 带宽）。 */
    preprocessMaxEdgePx: number;
    /** 压缩 JPEG 质量 0..100（PNG 带 alpha 时保持 PNG）。 */
    preprocessQuality: number;
    /** 临时文件保留时长（毫秒），定时清理。 */
    tempRetentionMs: number;
    /** 临时文件清理周期（毫秒）。 */
    cleanupIntervalMs: number;
    /** 本地 Python 解释器路径（空则自动探测）。 */
    pythonPath: string;
    /** 本地 CV 运行时脚本路径。 */
    cvRuntimePath: string;
    /** 是否启用本地 CV 引擎。 */
    localCvEnabled: boolean;
    /** 自定义 VL 后端列表（优先级排序）。 */
    vlBackends: VlBackend[];
    /** 内置匿名兜底 VL 服务开关（无需用户密钥）。 */
    builtinVlEnabled: boolean;
    /** 内置兜底 VL 链路的凭据引用名（空表示不启用）。 */
    builtinVlKeyRef: string;
    builtinVlBaseURL: string;
    builtinVlModel: string;
    /** WASM 本地 OCR 兜底是否启用。 */
    wasmOcrEnabled: boolean;
    /** 审计日志是否单独输出（不污染主回答）。 */
    auditSeparate: boolean;
    /** 审计日志最大保留条数（按会话）。 */
    auditMaxEntries: number;
    /** 是否把图片索引写入会话状态持久化。 */
    persistSessionState: boolean;
    /**
     * 设置面板 Host 白名单（DNS rebinding 硬校验）。
     * 元素为规范化主机名：小写、不含端口，IPv6 带方括号（如 `[::1]`）。
     * 空数组 = 不启用额外 Host 校验，行为与旧版完全一致（仅靠浏览器同源信号）。
     */
    panelAllowedHosts: string[];
}
/** 单次调用的完整审计链路。 */
export interface AuditRecord {
    auditId: string;
    toolName: string;
    /** 入参（已脱敏：剥离 base64 / 密钥 / 大段原文，仅保留结构指纹）。 */
    argsDigest: Record<string, unknown>;
    /** 实际引擎。 */
    engine: EngineSource;
    /** 耗时（毫秒）。 */
    durationMs: number;
    /** 置信度。 */
    confidence: number;
    /** 产物 Artifact ID 列表。 */
    artifactIds: string[];
    /** 是否降级 + 降级链。 */
    degraded: boolean;
    degradeChain: DegradeHop[];
    /** 会话隔离键。 */
    sessionKey: string;
    /** 结果状态。 */
    status: 'ok' | 'error' | 'timeout' | 'queued';
    /** 脱敏后的错误摘要（仅 status!=ok）。 */
    errorDigest?: string;
    at: number;
}
/** 会话隔离状态：不同会话的图片索引 / 激活状态 / 队列互相隔离。 */
export interface SessionState {
    sessionKey: string;
    /** 整套视觉工具是否已激活（渐进模式首次需要视觉时置 true）。 */
    activated: boolean;
    /** 图片索引：会话内自动维护，支持反复引用。 */
    images: Map<string, ImageRef>;
    /** 下一个自动索引号。 */
    nextImageIndex: number;
    /** 本会话审计日志。 */
    audit: AuditRecord[];
    /** 本会话运行中的任务数。 */
    running: number;
    /** 本会话等待队列。 */
    queue: Array<() => void>;
    /** 创建 / 最近访问时间（垃圾回收用）。 */
    lastAccess: number;
}
export interface TaskContext {
    sessionKey: string;
    auditId: string;
    toolName: string;
    signal: AbortSignal;
}
/** 引擎执行请求（所有引擎统一的输入）。 */
export interface EngineRequest {
    /** 任务名，对应工具的能力标识。 */
    op: string;
    /** 托管后的图像 id 列表。 */
    imageIds: string[];
    /** 工具入参（已脱敏、已校验）。 */
    params: Record<string, unknown>;
    /** 会话隔离的工作目录。 */
    workdir: string;
    ctx: TaskContext;
}
/** 引擎执行结果。 */
export interface EngineResult<T = unknown> {
    data: T;
    confidence: number;
    engine: EngineSource;
    /** 产出的临时图像绝对路径（调度层负责注册为 Artifact）。 */
    artifactPaths: string[];
}
