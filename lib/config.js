// ───────────────────────── 默认参数（内部常量） ─────────────────────────
export const DEFAULTS = {
    // ── 运行模式总开关 ──
    enabled: true,
    runMode: 'auto',
    autoTileEnabled: true,
    // ── 引擎配置区 ──
    browserRenderEnabled: true,
    ocrLanguage: 'mix',
    // ── 任务调度策略 ──
    confidenceAlertThreshold: 0.6,
    degradeNotifyAgent: true,
    // ── 产物与存储 ──
    autoCleanupEnabled: true,
    retentionPreset: '24h',
    autoSaveArtifacts: true,
    // ── 工具加载 / 调度核心 ──
    loadingStrategy: 'progressive',
    sessionConcurrency: 1,
    maxQueueLength: 32,
    taskTimeoutMs: 30_000,
    oversizeEdgePx: 1600,
    tileEdgePx: 768,
    preprocessMaxEdgePx: 1280,
    preprocessQuality: 82,
    tempRetentionMs: 1000 * 60 * 60 * 24, // 24h
    cleanupIntervalMs: 1000 * 60 * 30, // 30min
    pythonPath: '',
    cvRuntimePath: '',
    localCvEnabled: true,
    vlBackends: [],
    builtinVlEnabled: false,
    builtinVlKeyRef: '',
    builtinVlBaseURL: '',
    builtinVlModel: 'gpt-4o-mini',
    wasmOcrEnabled: true,
    auditSeparate: true,
    auditMaxEntries: 500,
    persistSessionState: true,
    // ── 面板安全 ──
    /** 面板 Host 白名单：空=不启用额外校验；非空=仅允许列表内主机名访问设置路由。 */
    panelAllowedHosts: [],
};
/**
 * 规范化主机名（Host 头 / 白名单条目共用，单一事实来源）：
 *  - 去协议 / userinfo / 路径 / 查询 / 片段，转小写；
 *  - `[::1]:8080` → `::1`，`127.0.0.1:1234` → `127.0.0.1`，`::1` 保持；
 *  - 去末尾点。返回空串表示非法/空值。
 */
export function normalizeHost(input) {
    if (typeof input !== 'string')
        return '';
    let s = input.trim().toLowerCase();
    if (!s)
        return '';
    const proto = s.indexOf('://');
    if (proto >= 0)
        s = s.slice(proto + 3);
    const at = s.lastIndexOf('@');
    if (at >= 0)
        s = s.slice(at + 1);
    const cut = s.search(/[/?#]/);
    if (cut >= 0)
        s = s.slice(0, cut);
    if (s.startsWith('[')) {
        const end = s.indexOf(']');
        if (end > 0)
            s = s.slice(1, end);
    }
    else {
        const first = s.indexOf(':');
        // 仅单个冒号视为 host:port；裸 IPv6（多个冒号）原样保留。
        if (first > 0 && first === s.lastIndexOf(':'))
            s = s.slice(0, first);
    }
    return s.replace(/\.$/, '');
}
/** 归一化 Host 白名单：规范化 / 去空 / 去重 / 限量（防配置膨胀）。 */
function normalizeAllowedHosts(raw) {
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const item of raw) {
        const h = normalizeHost(item);
        if (h && !out.includes(h))
            out.push(h);
        if (out.length >= 64)
            break;
    }
    return out;
}
/** 保留时长档位 → 毫秒（never = 0，表示不清理）。 */
export const RETENTION_MS = {
    '1h': 1000 * 60 * 60,
    '6h': 1000 * 60 * 60 * 6,
    '24h': 1000 * 60 * 60 * 24,
    '72h': 1000 * 60 * 60 * 72,
    '7d': 1000 * 60 * 60 * 24 * 7,
    never: 0,
};
const RUN_MODES = ['auto', 'local-only', 'remote-only'];
const OCR_LANGS = ['zh', 'en', 'mix'];
const RETENTIONS = ['1h', '6h', '24h', '72h', '7d', 'never'];
const LOADING = ['progressive', 'eager'];
/** 归一化配置：合并默认值、钳制到合法区间，保证调度层拿到的永远是完整可用值。 */
export function resolveConfig(raw) {
    const r = raw ?? {};
    const num = (v, d, lo, hi) => {
        const n = typeof v === 'number' && Number.isFinite(v) ? v : d;
        return Math.min(hi, Math.max(lo, Math.trunc(n)));
    };
    const frac = (v, d, lo, hi) => {
        const n = typeof v === 'number' && Number.isFinite(v) ? v : d;
        return Math.min(hi, Math.max(lo, n));
    };
    const str = (v, d) => (typeof v === 'string' ? v : d);
    // URL 防御纵深：非空值必须以 http(s):// 开头，挡住 file:/javascript: 等被
    // fetch 误用；空串保留（表示未配置端点，由降级链处理）。与面板校验同口径。
    const safeHttpUrl = (v, d) => {
        const s = str(v, d).trim();
        return s === '' || /^https?:\/\//i.test(s) ? s : d;
    };
    const bool = (v, d) => (typeof v === 'boolean' ? v : d);
    const oneOf = (v, allowed, d) => typeof v === 'string' && allowed.includes(v) ? v : d;
    const retention = oneOf(r.retentionPreset, RETENTIONS, DEFAULTS.retentionPreset);
    // 档位是唯一用户接口：只要 retentionPreset 显式出现，就以它为准推导 ms
    // （避免 schema 给 tempRetentionMs 的默认值把档位选择盖掉 → 档位变 no-op）。
    // tempRetentionMs 仅在「完全没有档位」时作为兼容回退（旧配置 / 直接写 ms）。
    const hasPreset = r.retentionPreset !== undefined;
    const explicitMs = r.tempRetentionMs;
    const tempRetentionMs = hasPreset
        ? RETENTION_MS[retention]
        : (typeof explicitMs === 'number' && explicitMs >= 0
            ? (explicitMs === 0 ? 0 : num(explicitMs, DEFAULTS.tempRetentionMs, 60_000, 1000 * 60 * 60 * 24 * 30))
            : RETENTION_MS[retention]);
    return {
        // 运行模式总开关
        enabled: bool(r.enabled, DEFAULTS.enabled),
        runMode: oneOf(r.runMode, RUN_MODES, DEFAULTS.runMode),
        autoTileEnabled: bool(r.autoTileEnabled, DEFAULTS.autoTileEnabled),
        // 引擎配置区
        browserRenderEnabled: bool(r.browserRenderEnabled, DEFAULTS.browserRenderEnabled),
        ocrLanguage: oneOf(r.ocrLanguage, OCR_LANGS, DEFAULTS.ocrLanguage),
        // 任务调度策略
        confidenceAlertThreshold: frac(r.confidenceAlertThreshold, DEFAULTS.confidenceAlertThreshold, 0, 1),
        degradeNotifyAgent: bool(r.degradeNotifyAgent, DEFAULTS.degradeNotifyAgent),
        // 产物与存储
        autoCleanupEnabled: bool(r.autoCleanupEnabled, DEFAULTS.autoCleanupEnabled),
        retentionPreset: retention,
        autoSaveArtifacts: bool(r.autoSaveArtifacts, DEFAULTS.autoSaveArtifacts),
        // 核心
        loadingStrategy: oneOf(r.loadingStrategy, LOADING, DEFAULTS.loadingStrategy),
        sessionConcurrency: num(r.sessionConcurrency, DEFAULTS.sessionConcurrency, 1, 5),
        maxQueueLength: num(r.maxQueueLength, DEFAULTS.maxQueueLength, 1, 512),
        taskTimeoutMs: num(r.taskTimeoutMs, DEFAULTS.taskTimeoutMs, 1000, 3_600_000),
        oversizeEdgePx: num(r.oversizeEdgePx, DEFAULTS.oversizeEdgePx, 512, 16_384),
        tileEdgePx: num(r.tileEdgePx, DEFAULTS.tileEdgePx, 256, 2048),
        preprocessMaxEdgePx: num(r.preprocessMaxEdgePx, DEFAULTS.preprocessMaxEdgePx, 256, 4096),
        preprocessQuality: num(r.preprocessQuality, DEFAULTS.preprocessQuality, 1, 100),
        tempRetentionMs,
        cleanupIntervalMs: num(r.cleanupIntervalMs, DEFAULTS.cleanupIntervalMs, 10_000, 1000 * 60 * 60 * 24),
        pythonPath: str(r.pythonPath, DEFAULTS.pythonPath),
        cvRuntimePath: str(r.cvRuntimePath, DEFAULTS.cvRuntimePath) || defaultCvRuntimePath(),
        localCvEnabled: bool(r.localCvEnabled, DEFAULTS.localCvEnabled),
        vlBackends: normalizeBackends(r.vlBackends),
        builtinVlEnabled: bool(r.builtinVlEnabled, DEFAULTS.builtinVlEnabled),
        builtinVlKeyRef: str(r.builtinVlKeyRef, DEFAULTS.builtinVlKeyRef),
        builtinVlBaseURL: safeHttpUrl(r.builtinVlBaseURL, DEFAULTS.builtinVlBaseURL),
        builtinVlModel: str(r.builtinVlModel, DEFAULTS.builtinVlModel),
        wasmOcrEnabled: bool(r.wasmOcrEnabled, DEFAULTS.wasmOcrEnabled),
        auditSeparate: bool(r.auditSeparate, DEFAULTS.auditSeparate),
        auditMaxEntries: num(r.auditMaxEntries, DEFAULTS.auditMaxEntries, 10, 10_000),
        persistSessionState: bool(r.persistSessionState, DEFAULTS.persistSessionState),
        panelAllowedHosts: normalizeAllowedHosts(r.panelAllowedHosts),
    };
}
/** 归一化 VL 后端列表：补齐字段、按数组顺序即优先级、过滤非法条目。 */
function normalizeBackends(raw) {
    if (!Array.isArray(raw))
        return [];
    const out = [];
    raw.forEach((item, i) => {
        if (!item || typeof item !== 'object')
            return;
        const b = item;
        const id = typeof b.id === 'string' && b.id.trim() ? b.id.trim() : `vl-${i + 1}`;
        out.push({
            id,
            label: typeof b.label === 'string' ? b.label : '',
            // 数组顺序即优先级；忽略外部写入的 priority 以保持拖拽排序语义。
            priority: (i + 1) * 10,
            keyRef: typeof b.keyRef === 'string' ? b.keyRef : '',
            baseURL: /^https?:\/\//i.test(String(b.baseURL ?? '').trim()) ? String(b.baseURL).trim() : '',
            model: typeof b.model === 'string' ? b.model : '',
            maxImageEdgePx: typeof b.maxImageEdgePx === 'number'
                ? Math.min(8192, Math.max(256, Math.trunc(b.maxImageEdgePx)))
                : 2048,
            enabled: b.enabled !== false,
        });
    });
    return out;
}
/** 默认 CV 运行时脚本：随插件分发的 runtime/cv_worker.py。 */
function defaultCvRuntimePath() {
    return 'runtime/cv_worker.py';
}
/** 导出给设置面板「重置为默认」用的纯 JSON 默认值。 */
export function defaultPanelConfig() {
    return resolveConfig({});
}
/**
 * 由 schemastery 构建 Config schema（插件导出的 `Config`）。
 * 每个字段用 `volatile()` 标记 → 设置页可写、修改热生效。
 * 字段顺序与面板六大分区一致，便于设置页按声明顺序渲染表单。
 */
export function buildConfigSchema(z) {
    const volatile = (schema) => typeof schema?.volatile === 'function' ? schema.volatile() : schema;
    const desc = (schema, text) => typeof schema?.description === 'function' ? schema.description(text) : schema;
    const field = (schema, text) => volatile(desc(schema, text));
    const backendShape = z.object({
        id: z.string().default(''),
        label: z.string().default(''),
        baseURL: z.string().default(''),
        keyRef: z.string().default(''),
        model: z.string().default(''),
        maxImageEdgePx: z.number().min(256).max(8192).default(2048),
        enabled: z.boolean().default(true),
    });
    return z.object({
        // ── 1. 运行模式总开关 ──
        enabled: field(z.boolean().default(true), '启用视觉插件（关闭后不注册任何 vision_* 工具）'),
        runMode: field(z.union([z.const('auto'), z.const('local-only'), z.const('remote-only')]).default('auto'), '运行模式：自动自适应 / 仅本地CV / 仅远端VL路由'),
        loadingStrategy: field(z.union([z.const('progressive'), z.const('eager')]).default('progressive'), '工具加载策略：渐进按需激活 / 会话启动全量注册'),
        autoTileEnabled: field(z.boolean().default(true), '大图自动分块策略'),
        oversizeEdgePx: field(z.number().min(512).max(16384).default(1600), '大图长边阈值(px)，超过建议分区裁剪'),
        // ── 2. 引擎配置区：引擎A 本地CV ──
        pythonPath: field(z.string().default(''), 'Python 运行时路径（空=自动检测）'),
        cvRuntimePath: field(z.string().default(''), '本地 CV 运行时脚本路径（空=内置）'),
        localCvEnabled: field(z.boolean().default(true), '启用本地 CV 引擎'),
        browserRenderEnabled: field(z.boolean().default(true), '渲染截图浏览器内核检测'),
        // ── 2. 引擎配置区：引擎B 远端路由 ──
        vlBackends: field(z.array(backendShape).default([]), 'VL 后端优先级列表（数组顺序=优先级，可拖拽排序）'),
        builtinVlEnabled: field(z.boolean().default(false), '启用内置匿名兜底 VL 服务'),
        builtinVlKeyRef: field(z.string().default(''), '内置兜底 VL 凭据引用名（空=使用匿名链路）'),
        builtinVlBaseURL: field(z.string().default(''), '内置兜底 VL 端点'),
        builtinVlModel: field(z.string().default('gpt-4o-mini'), '内置兜底 VL 模型'),
        wasmOcrEnabled: field(z.boolean().default(true), 'WASM 本地 OCR 兜底'),
        ocrLanguage: field(z.union([z.const('zh'), z.const('en'), z.const('mix')]).default('mix'), 'OCR 识别语言：中文 / 英文 / 混合'),
        // ── 3. 任务调度策略 / 4. 任务限流与超时 ──
        sessionConcurrency: field(z.number().min(1).max(5).default(1), '单会话最大并发视觉任务数(1~5)'),
        taskTimeoutMs: field(z.number().min(1000).max(3600000).default(30000), '单任务超时(ms)；面板以秒展示'),
        maxQueueLength: field(z.number().min(1).max(512).default(32), '等待队列最大长度'),
        confidenceAlertThreshold: field(z.number().min(0).max(1).default(0.6), '置信度告警阈值(0~1)，低于触发二次校验提醒'),
        degradeNotifyAgent: field(z.boolean().default(true), '降级发生时主动通知 Agent'),
        // ── 5. 产物与存储 ──
        retentionPreset: field(z.union([
            z.const('1h'), z.const('6h'), z.const('24h'), z.const('72h'), z.const('7d'), z.const('never'),
        ]).default('24h'), 'Artifact 临时文件保留时长'),
        // 不设 default（schemastery 无 default 即视为可选）：由 resolveConfig 从
        // retentionPreset 推导，避免默认值把档位盖掉；仅作为兼容回退字段。
        tempRetentionMs: field(z.number().min(0), '临时文件保留时长(ms，由档位映射；0=永不清理)'),
        cleanupIntervalMs: field(z.number().min(10000).max(86400000).default(1800000), '临时文件清理周期(ms)'),
        autoCleanupEnabled: field(z.boolean().default(true), '自动清理临时文件'),
        autoSaveArtifacts: field(z.boolean().default(true), '自动保存 diff 热力图 / 裁剪子图 / SVG 矢量产物'),
        tileEdgePx: field(z.number().min(256).max(2048).default(768), '大图分块边长(px)'),
        preprocessMaxEdgePx: field(z.number().min(256).max(4096).default(1280), '压缩预处理最长边(px)'),
        preprocessQuality: field(z.number().min(1).max(100).default(82), '图片压缩质量(上传前压缩，降低 token)'),
        persistSessionState: field(z.boolean().default(true), '会话状态(图片索引/激活态)持久化'),
        auditSeparate: field(z.boolean().default(true), '审计日志单独输出，不污染主回答'),
        auditMaxEntries: field(z.number().min(10).max(10000).default(500), '每会话审计日志最大条数'),
        // ── 6. 面板安全 ──
        panelAllowedHosts: field(z.array(z.string()).default([]), '面板 Host 白名单：留空=沿用浏览器同源校验；填写后仅允许列表内主机名访问设置路由（防 DNS rebinding）'),
    });
}
