/**
 * dsh-vision-nexus — 设置面板的数据模型（Client 侧）
 *
 * 与 Host 侧 `config.ts` 的 DEFAULTS / resolveConfig 保持同一套字段与默认值。
 * 这里只负责：字段元数据（供表单渲染）、实时校验、导入/导出脱敏、
 * 以及「重置为默认」的纯值构造。表单读写一律走 DSH 设置表单 scope。
 *
 * 注意：本文件不得包含任何 API Key 明文；后端条目里的 `keyRef` 只是引用名。
 */
export const DEFAULTS = {
    enabled: true,
    runMode: 'auto',
    loadingStrategy: 'progressive',
    autoTileEnabled: true,
    oversizeEdgePx: 1600,
    pythonPath: '',
    cvRuntimePath: '',
    localCvEnabled: true,
    browserRenderEnabled: true,
    vlBackends: [],
    builtinVlEnabled: false,
    builtinVlKeyRef: '',
    builtinVlBaseURL: '',
    builtinVlModel: 'gpt-4o-mini',
    wasmOcrEnabled: true,
    ocrLanguage: 'mix',
    sessionConcurrency: 1,
    taskTimeoutMs: 30_000,
    maxQueueLength: 32,
    confidenceAlertThreshold: 0.6,
    degradeNotifyAgent: true,
    retentionPreset: '24h',
    tempRetentionMs: 86_400_000,
    cleanupIntervalMs: 1_800_000,
    autoCleanupEnabled: true,
    autoSaveArtifacts: true,
    tileEdgePx: 768,
    preprocessMaxEdgePx: 1280,
    preprocessQuality: 82,
    persistSessionState: true,
    auditSeparate: true,
    auditMaxEntries: 500,
    // 面板安全：Host 白名单（空=沿用同源校验；非空=仅允许列表内主机名）
    panelAllowedHosts: [],
};
/** DEFAULTS 中按「字符串数组」处理的字段（区别于 vlBackends 的对象数组）。 */
const STRING_ARRAY_KEYS = new Set(['panelAllowedHosts']);
/** 从 scope 的 value 构造完整草稿（缺字段补默认值）。 */
export function draftFrom(value) {
    const v = value ?? {};
    const draft = {};
    for (const [k, def] of Object.entries(DEFAULTS)) {
        const raw = v[k];
        if (raw === undefined || raw === null) {
            draft[k] = cloneDefault(def);
        }
        else if (STRING_ARRAY_KEYS.has(k)) {
            // 字符串数组（如 Host 白名单）：保留字符串元素，不套 VlBackendRow 的归一化。
            draft[k] = Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : [];
        }
        else if (Array.isArray(def)) {
            draft[k] = Array.isArray(raw) ? raw.map(normalizeRow) : [];
        }
        else if (typeof def === 'number') {
            draft[k] = typeof raw === 'number' && Number.isFinite(raw) ? raw : def;
        }
        else if (typeof def === 'boolean') {
            draft[k] = typeof raw === 'boolean' ? raw : def;
        }
        else {
            draft[k] = typeof raw === 'string' ? raw : def;
        }
    }
    return draft;
}
function cloneDefault(def) {
    if (Array.isArray(def))
        return [];
    return def;
}
function normalizeRow(raw) {
    const r = (raw ?? {});
    return {
        id: typeof r.id === 'string' && r.id ? r.id : `vl-${Math.random().toString(36).slice(2, 8)}`,
        label: typeof r.label === 'string' ? r.label : '',
        baseURL: typeof r.baseURL === 'string' ? r.baseURL : '',
        keyRef: typeof r.keyRef === 'string' ? r.keyRef : '',
        model: typeof r.model === 'string' ? r.model : '',
        maxImageEdgePx: typeof r.maxImageEdgePx === 'number' ? r.maxImageEdgePx : 2048,
        enabled: r.enabled !== false,
    };
}
export function newBackendRow(existing) {
    let n = existing.length + 1;
    let id = `vl-${n}`;
    while (existing.some((b) => b.id === id)) {
        n++;
        id = `vl-${n}`;
    }
    return { id, label: `后端 ${n}`, baseURL: '', keyRef: '', model: '', maxImageEdgePx: 2048, enabled: true };
}
/**
 * 实时校验：非法输入立即在对应控件下方标红，且阻止写回 scope。
 * 规则与 Host 侧 resolveConfig 的钳制区间保持一致。
 */
export function validate(draft) {
    const errors = {};
    const numRange = (key, lo, hi, label) => {
        const v = draft[key];
        if (typeof v !== 'number' || !Number.isFinite(v)) {
            errors[key] = `${label}必须是数字`;
            return;
        }
        if (v < lo || v > hi)
            errors[key] = `${label}需在 ${lo}~${hi} 之间`;
    };
    numRange('oversizeEdgePx', 512, 16384, '长边阈值');
    numRange('sessionConcurrency', 1, 5, '并发数');
    numRange('taskTimeoutMs', 1000, 3_600_000, '超时(ms)');
    numRange('maxQueueLength', 1, 512, '队列长度');
    numRange('tileEdgePx', 256, 2048, '分块边长');
    numRange('preprocessMaxEdgePx', 256, 4096, '压缩最长边');
    numRange('preprocessQuality', 1, 100, '压缩质量');
    numRange('confidenceAlertThreshold', 0, 1, '置信度阈值');
    numRange('auditMaxEntries', 10, 10000, '审计条数');
    numRange('cleanupIntervalMs', 10000, 86_400_000, '清理周期');
    // Host 白名单：允许逗号 / 空白分隔的一次性输入，元素非空即可；Host 侧再规范化去端口。
    const hosts = draft.panelAllowedHosts;
    if (Array.isArray(hosts)) {
        const cleaned = hosts
            .filter((x) => typeof x === 'string')
            .flatMap((x) => x.split(','))
            .map((x) => x.trim())
            .filter(Boolean);
        if (cleaned.length > 64)
            errors.panelAllowedHosts = 'Host 白名单最多 64 项';
        else if (cleaned.some((h) => /[\s/]/.test(h)))
            errors.panelAllowedHosts = '每个 Host 不能含空白或斜杠';
    }
    else {
        errors.panelAllowedHosts = 'Host 白名单格式非法';
    }
    // 后端行校验。
    const rows = draft.vlBackends;
    if (Array.isArray(rows)) {
        rows.forEach((row, i) => {
            if (row.enabled && !/^https?:\/\//.test(row.baseURL.trim())) {
                errors[`vlBackends.${i}.baseURL`] = '接口地址需以 http(s):// 开头';
            }
            if (row.enabled && !row.model.trim()) {
                errors[`vlBackends.${i}.model`] = '启用状态需填写模型名称';
            }
            const edge = row.maxImageEdgePx;
            if (!Number.isFinite(edge) || edge < 256 || edge > 8192) {
                errors[`vlBackends.${i}.maxImageEdgePx`] = '最大图片尺寸需在 256~8192';
            }
        });
    }
    return { errors, valid: Object.keys(errors).length === 0 };
}
/** 计算需要写回的字段差异（只写真正改过的字段，减少写放大）。 */
export function diffFields(draft, served) {
    const out = [];
    const base = draftFrom(served);
    for (const key of Object.keys(DEFAULTS)) {
        const a = JSON.stringify(base[key]);
        const b = JSON.stringify(draft[key]);
        if (a !== b)
            out.push([key, draft[key]]);
    }
    return out;
}
/** 导出：生成脱敏 JSON 文本（配置里本就只有 keyRef，额外抹掉疑似密钥字段）。 */
export function exportConfigText(draft) {
    const clone = JSON.parse(JSON.stringify(draft));
    const rows = clone.vlBackends;
    if (Array.isArray(rows)) {
        clone.vlBackends = rows.map((r) => {
            const c = { ...r };
            for (const k of Object.keys(c))
                if (/apiKey|token|secret|password/i.test(k))
                    delete c[k];
            return c;
        });
    }
    return JSON.stringify({
        _plugin: 'dsh-vision-nexus',
        _version: 1,
        _notice: '导出内容不含 API Key 明文；凭据请在目标机器通过凭证服务重新登记 keyRef。',
        config: clone,
    }, null, 2);
}
/** 导入：解析并校验 JSON，返回归一化草稿；失败给出可读错误。 */
export function parseImport(text) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch (e) {
        return { ok: false, error: `JSON 解析失败：${e instanceof Error ? e.message : String(e)}` };
    }
    const payload = parsed;
    const part = (payload && typeof payload === 'object' && 'config' in payload)
        ? payload.config
        : payload;
    if (!part || typeof part !== 'object')
        return { ok: false, error: 'JSON 中未找到配置对象' };
    const draft = draftFrom(part);
    const check = validate(draft);
    if (!check.valid)
        return { ok: false, error: `导入配置存在非法值：${Object.values(check.errors)[0]}` };
    return {
        ok: true,
        draft,
        notice: '导入成功：明文 API Key 不会随 JSON 迁移，请在目标机器通过凭证服务重新登记各后端的 keyRef。',
    };
}
/** 枚举选项（value/label），贴合面板文案。 */
export const OPTIONS = {
    runMode: [
        { value: 'auto', label: '自动自适应（推荐）' },
        { value: 'local-only', label: '仅本地CV引擎模式' },
        { value: 'remote-only', label: '仅远端VL路由模式' },
    ],
    loadingStrategy: [
        { value: 'progressive', label: '渐进按需激活（默认）' },
        { value: 'eager', label: '会话启动全量注册工具' },
    ],
    ocrLanguage: [
        { value: 'zh', label: '中文' },
        { value: 'en', label: '英文' },
        { value: 'mix', label: '中英混合' },
    ],
    retentionPreset: [
        { value: '1h', label: '1 小时' },
        { value: '6h', label: '6 小时' },
        { value: '24h', label: '24 小时' },
        { value: '72h', label: '3 天' },
        { value: '7d', label: '7 天' },
        { value: 'never', label: '永不清理' },
    ],
};
/** 保留档位 → 毫秒。 */
export const RETENTION_MS = {
    '1h': 3_600_000,
    '6h': 21_600_000,
    '24h': 86_400_000,
    '72h': 259_200_000,
    '7d': 604_800_000,
    never: 0,
};
