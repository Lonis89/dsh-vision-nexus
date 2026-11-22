/**
 * dsh-vision-nexus — 多引擎视觉增强工具插件（主 TS 入口）
 * =====================================================================
 * 定位：给「不具备看图能力」的文本主模型提供视觉能力。所有图像信息
 * 必须通过本插件工具调用获取；插件底层绝不把图片 / base64 塞给主 LLM，
 * 强制走工具调用链路。
 *
 * 架构分层：
 *   调度层      scheduler.ts / session.ts / audit.ts / artifacts.ts
 *   工具技能层  toolSkill.ts（渐进按需激活 / 全量预加载）
 *   引擎管理层  engines/localCv.ts（A 本地 CV）
 *              engines/remoteVl.ts（B 远端 VL 路由）
 *              engines/wasmOcr.ts（WASM 本地 OCR 兜底）
 *
 * 降级优先级：本地CV → 自定义VL后端 → 内置兜底VL → WASM本地OCR，
 * 每次降级写审计并在结果里告知模型能力限制。
 *
 * DSH 插件标准约定：
 *   - 导出 name / inject / Config / apply
 *   - apply(ctx, config) 中通过 ctx.tools.register 注册工具
 *   - 通过 ctx.on(...) 挂事件钩子，ctx.effect(...) 注册资源 disposer
 *   - cordis.patch.yml 把插件挂进 Loader 树
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import z from '@deepseek-ai/schemastery';
import { resolveConfig, buildConfigSchema } from './config.js';
import { SessionManager } from './session.js';
import { ArtifactStore } from './artifacts.js';
import { AuditLog } from './audit.js';
import { LocalCvEngine, probePython, probeRuntime } from './engines/localCv.js';
import { RemoteVlEngine } from './engines/remoteVl.js';
import { WasmOcrEngine } from './engines/wasmOcr.js';
import { Scheduler } from './scheduler.js';
import { ToolSkillLayer, VISION_TOOL_NAMES } from './toolSkill.js';
import { PIXEL_TOOLS, TOOL_DEFINITIONS } from './toolSchemas.js';
import { PanelStats } from './panel/stats.js';
import { registerPanelRoutes } from './panel/hostPanel.js';
/** 插件名（与 package.json / cordis.patch.yml 一致）。 */
export const name = 'dsh-vision-nexus';
/**
 * 依赖的宿主服务（Cordis inject 契约）。
 *
 * 只把「没有它插件就没有意义」的 tools 作为硬依赖。attachments / credentials /
 * workingDirectory 都是可降级的增强项：硬 inject 一个宿主未提供的服务会让
 * fiber 永久挂起（插件装上了却永远不激活），因此改用 ctx.get 可选探测。
 */
export const inject = ['tools'];
/** 配置 schema（schemastery）。设置页 / profile patch 据此校验与编辑。 */
export const Config = buildConfigSchema(z);
export { TOOL_DEFINITIONS, ENVELOPE_OUTPUT_SCHEMA } from './toolSchemas.js';
export { DEFAULTS, RETENTION_MS, defaultPanelConfig } from './config.js';
export { ROUTES } from './routes.js';
// ───────────────────────── 健康自检函数 ─────────────────────────
/**
 * 健康自检：探测全部引擎与工具子集，返回结构化报告。
 * 供插件设置页 / 命令 / 外部诊断调用；不执行任何视觉任务、不触碰图像。
 */
export async function healthSelfCheck(ctx, config) {
    // 允许宿主以「不传配置」方式调用（manifest 声明该函数为可调用健康自检入口）。
    const cfg = resolveConfig(config);
    const pluginRoot = resolvePluginRoot();
    const python = await probePython(cfg);
    const runtimeOk = python ? await probeRuntime(cfg, python, pluginRoot) : false;
    const localCv = cfg.localCvEnabled && python !== null && runtimeOk;
    const wasmAdapter = resolveWasmAdapter(ctx);
    const customVlBackends = cfg.vlBackends.filter((b) => b.enabled && b.id && b.baseURL && b.keyRef).length;
    // 内置兜底：面板开关 或 显式 keyRef/baseURL 任一满足即视为声明可用。
    const builtinVl = cfg.builtinVlEnabled || Boolean(cfg.builtinVlKeyRef && cfg.builtinVlBaseURL);
    // WASM OCR 可用性：开关打开且装载了适配器才算真正可用（未装载时仅结构化降级占位）。
    const wasmOcrLoaded = Boolean(wasmAdapter);
    const wasmOcr = cfg.wasmOcrEnabled && wasmOcrLoaded;
    // 运行模式：local-only 强制只看本地 CV；remote-only 强制禁用本地 CV。
    const localCvEffective = cfg.runMode === 'remote-only' ? false : localCv;
    const remoteEffective = cfg.runMode !== 'local-only';
    const hasRemote = remoteEffective && (customVlBackends > 0 || builtinVl);
    const capableTools = TOOL_DEFINITIONS.filter((t) => {
        if (t.name === 'vision_activate')
            return true;
        if (PIXEL_TOOLS.has(t.name))
            return localCvEffective;
        // 非像素理解类（glance/ground）只能由远端 VL 或 WASM OCR 完成；
        // 本地 CV 的 LOCAL_OPS 不含它们，不能因 localCv 可用就误判为 capable。
        return hasRemote || wasmOcr;
    }).map((t) => t.name);
    const disabledTools = TOOL_DEFINITIONS
        .map((t) => t.name)
        .filter((n) => !capableTools.includes(n));
    const mode = localCvEffective ? 'full' : 'route-only';
    // 总开关关闭时无可用工具属预期状态，不算异常。
    const ok = !cfg.enabled || capableTools.length > 1;
    return {
        ok,
        plugin: name,
        // 与 Scheduler.capabilities() 同口径：localCv 字段反映运行模式折算后的
        // 有效能力（remote-only 下为 false），避免与 mode / capableTools 自相矛盾。
        engines: { localCv: localCvEffective, customVlBackends, builtinVl, wasmOcr, capableTools, disabledTools },
        mode,
        tools: {
            total: TOOL_DEFINITIONS.length,
            capable: capableTools.length,
            disabled: disabledTools,
        },
        wasmOcrLoaded,
        checkedAt: Date.now(),
    };
}
// ───────────────────────── 主入口 apply ─────────────────────────
/**
 * Cordis 插件入口。
 * @param ctx    Cordis 上下文（宿主注入 tools / attachments / credentials 等服务）
 * @param config 归一化前的配置（可能带 schemastery 的 getter 包装）
 */
export function apply(ctx, rawConfig) {
    // 热生效：rawConfig 的 volatile 字段带 .get() 包装，每次读取都重新摊平，
    // 因此设置面板写入的新值无需重启即可被调度层 / 健康自检 / 路由感知。
    const currentConfig = () => resolveConfig(flattenConfig(rawConfig));
    const baseDir = resolveBaseDir(ctx);
    // ── 引擎装配 ──
    const pluginRoot = resolvePluginRoot();
    // 面板实时统计：订阅审计提交 + 会话并发负载。
    const panelStats = new PanelStats();
    // 凭据解析：密钥绝不进入模型上下文，只在调度层内部按需解析。
    const resolveCredential = async (ref) => {
        try {
            // 通过 ctx.get 探测，避免未 inject 的服务在下标读取时抛错。
            const creds = typeof ctx.get === 'function' ? ctx.get('credentials') : undefined;
            const resolved = await creds?.resolve?.(ref);
            return typeof resolved === 'string' ? resolved : resolved?.value;
        }
        catch {
            return undefined;
        }
    };
    // 传 getter：设置面板热更新 VL 后端 / 超时等字段后即时生效，无需重启。
    const remoteVl = new RemoteVlEngine(currentConfig, resolveCredential);
    const wasmOcr = new WasmOcrEngine(() => currentConfig().wasmOcrEnabled, resolveWasmAdapter(ctx));
    // 本地 CV 引擎的健康探测是异步的：先以「保守不可用」创建，探测完成后
    // 通过可变容器替换；Scheduler 用 getter 读取，保证能力门禁即时生效。
    // 全部引擎 / 存储 / 审计都传 currentConfig getter，面板字段热更新即时生效。
    const engineHolder = {
        localCv: new LocalCvEngine(currentConfig, pluginRoot, null, false),
    };
    const sessions = new SessionManager(baseDir, currentConfig);
    // attachments 服务可能缺失（精简宿主）：用 ctx.get 探测，缺失时由
    // ArtifactStore 自行降级为自管目录，不能让插件在激活阶段抛错。
    const attachmentsService = typeof ctx.get === 'function'
        ? ctx.get('attachments')
        : undefined;
    const artifacts = new ArtifactStore(baseDir, currentConfig, attachmentsService);
    const audit = new AuditLog(baseDir, currentConfig);
    // 本地运行时探测 Promise：摄取前等待它完成，消除启动窗口内首批图片跳过压缩的竞态。
    // 该 Promise 永远 resolved（内部 try/catch）；附加超时上限防止探测卡死阻塞摄取。
    const localRuntimeReady = (async () => {
        try {
            const python = await probePython(currentConfig());
            const runtimeOk = python ? await probeRuntime(currentConfig(), python, pluginRoot) : false;
            engineHolder.localCv = new LocalCvEngine(currentConfig, pluginRoot, python, runtimeOk);
            if (!engineHolder.localCv.available) {
                // logger 同样是可选服务：用 ctx.get 探测，缺失时静默跳过（不影响能力）。
                try {
                    const logger = typeof ctx.get === 'function' ? ctx.get('logger') : undefined;
                    logger?.warn?.('dsh-vision-nexus: 本地 Python CV 运行时不可用，已自动禁用像素计算类工具并切换为纯路由模式');
                }
                catch { /* 无 logger 服务：忽略 */ }
            }
        }
        catch {
            // 探测异常一律视为「运行时不可用」，保持保守默认值并让摄取降级为原图。
            engineHolder.localCv = new LocalCvEngine(currentConfig, pluginRoot, null, false);
        }
    })();
    const PROBE_WAIT_TIMEOUT_MS = 12_000;
    const waitForLocalRuntime = () => Promise.race([
        localRuntimeReady,
        new Promise((resolve) => setTimeout(resolve, PROBE_WAIT_TIMEOUT_MS)),
    ]).then(() => undefined);
    const scheduler = new Scheduler({
        getConfig: currentConfig, sessions, artifacts, audit,
        getLocalCv: () => engineHolder.localCv,
        waitForLocalRuntime,
        remoteVl, wasmOcr, baseDir,
    });
    const skill = new ToolSkillLayer(ctx, currentConfig, scheduler, sessions);
    // ── 资源生命周期 ──
    const disposeMaintenance = sessions.startMaintenance();
    // 统计：每次审计提交累加今日调用 / 降级 / 置信度。
    audit.onCommit((rec) => panelStats.record(rec));
    // 总开关：enabled=false 时不注册任何 vision_* 工具（引擎与路由仍就绪，便于面板自检）。
    if (currentConfig().enabled) {
        void skill.init(); // 渐进：仅注册激活指令；全量：注册全套工具
    }
    // 面板 Host 端路由（健康自检 / 实时状态 / 连通性探测 / 配置导出）。
    const disposeRoutes = registerPanelRoutes(ctx, {
        currentConfig,
        toolRegistration: () => ({ registered: skill.registeredTools() }),
        stats: () => {
            const load = sessions.load();
            panelStats.setLoad(load.queuedTasks, load.runningTasks);
            return {
                ...panelStats.snapshot(),
                queuedTasks: load.queuedTasks,
                runningTasks: load.runningTasks,
            };
        },
        pluginRoot,
        resolveCredential,
        wasmOcrLoaded: () => Boolean(resolveWasmAdapter(ctx)),
        rawConfig: () => currentConfig(),
    });
    ctx.effect(() => () => {
        skill.dispose();
        disposeMaintenance();
        disposeRoutes();
    });
    // ── 事件钩子 ──
    registerEventHooks(ctx, {
        sessions, audit, scheduler, currentConfig, skill,
        getLocalCv: () => engineHolder.localCv,
    });
    // 探测由上面的 localRuntimeReady Promise 统一执行（摄取前会等待它）。
    /**
     * 把插件能力暴露给宿主（命令 / 设置页 / 宿主适配器）。
     *
     * 不能写成 `ctx[key] = value`：Cordis 的 ctx 是受控代理，未声明 provide 的属性
     * 赋值会抛 `cannot set property "..." without provide`，直接让整个插件激活失败。
     * 这里优先用 `ctx.set`（Cordis 的服务写入入口），不可用时退化为静默跳过——
     * 这些属于附加便利接口，缺失不影响工具注册与视觉能力本身。
     */
    const expose = (key, value) => {
        try {
            const set = ctx.set;
            if (typeof set === 'function') {
                set.call(ctx, key, value);
                return;
            }
        }
        catch { /* 宿主不允许该 key：忽略 */ }
    };
    expose(`${name}:health`, () => healthSelfCheck(ctx, currentConfig()));
    expose(`${name}:audit`, (sessionKey) => audit.export(sessionKey));
    expose(`${name}:tools`, () => [...VISION_TOOL_NAMES]);
    /**
     * 图像摄取：宿主在收到图片附件时调用，把字节登记为会话内 Artifact 并返回
     * `img:N` 索引。原图 / base64 不进入模型上下文，模型只拿到 id。
     * @returns 形如 { id, ref }；模型随后用 id 作为 image_id 调用 vision_* 工具。
     */
    expose(`${name}:ingest`, (sessionKey, bytes, opts = {}) => scheduler.ingest(sessionKey, bytes, opts));
}
/**
 * 事件钩子：
 *  - session/created          → 初始化会话隔离目录与状态
 *  - session/disposed         → 释放会话内存状态（保留磁盘 Artifact）
 *  - agent/inbox/inserted     → 摄取消息里的图片附件为会话内 Artifact（只登记字节）
 *  - loader/volatile-update   → 设置面板写入后热生效：总开关切换时注册/卸载工具
 *  - tools/result             → 观察工具结果，单独输出审计行（不污染主回答）
 *  - systemPrompt.context     → 把视觉能力边界写入系统提示（防止模型绕过工具脑补）
 */
function registerEventHooks(ctx, deps) {
    const anyCtx = ctx;
    // 热生效：配置 volatile 更新后，同步「运行模式总开关 / 本地CV开关」——
    // enabled 关闭时卸载全部 vision_* 工具；localCvEnabled 变化时即时改写引擎可用态。
    let prevStrategy = deps.currentConfig().loadingStrategy;
    anyCtx.on?.('loader/volatile-update', () => {
        const cfg = deps.currentConfig();
        const registered = deps.skill.registeredTools().length > 0;
        if (cfg.enabled && !registered)
            void deps.skill.init();
        else if (!cfg.enabled && registered)
            deps.skill.dispose();
        deps.getLocalCv().setEnabled(cfg.localCvEnabled && cfg.runMode !== 'remote-only');
        // eager → progressive 热切换：eager 下既有会话从未设置 activated，
        // 若不迁移，渐进门禁会拦住它们直到逐个重新激活。批量标记避免可用性退化。
        if (prevStrategy === 'eager' && cfg.loadingStrategy === 'progressive') {
            void deps.sessions.activateAll();
        }
        prevStrategy = cfg.loadingStrategy;
    });
    // 会话创建：准备隔离目录。
    anyCtx.on?.('session/created', (session) => {
        const key = String(session?.id ?? session?.header?.id ?? 'global')
            .replace(/[^a-zA-Z0-9_.-]/g, '_');
        void deps.sessions.get(key);
    });
    // 会话销毁：回收内存状态，磁盘 Artifact 保留供会话内反复引用。
    anyCtx.on?.('session/disposed', (session) => {
        const key = String(session?.id ?? session?.header?.id ?? 'global')
            .replace(/[^a-zA-Z0-9_.-]/g, '_');
        deps.sessions.disposeSession(key);
    });
    // 图像摄取：用户消息插入时，把其中的图片附件登记为会话内 Artifact。
    // 只取字节做压缩托管，绝不把图片 / base64 注入主 LLM 上下文；
    // 模型通过 vision_activate 返回的 registeredImages 拿到 image_id 再走工具链路。
    anyCtx.on?.('agent/inbox/inserted', (payload) => {
        const agent = payload?.agent;
        const message = payload?.message;
        const key = String(agent?.session?.id ?? 'global').replace(/[^a-zA-Z0-9_.-]/g, '_');
        const parts = Array.isArray(message?.content) ? message.content : [];
        for (const part of parts) {
            if (!part || (part.type !== 'image' && part.type !== 'image_attachment'))
                continue;
            const bytes = extractImageBytes(part);
            if (bytes)
                void deps.scheduler.ingest(key, bytes, { label: '消息图片附件' });
        }
    });
    // 工具结果观察：审计信息单独输出（console/日志），绝不并入模型可见的工具结果。
    anyCtx.on?.('tools/result', (exec, _result) => {
        if (deps.currentConfig().auditSeparate && typeof exec?.name === 'string' && exec.name.startsWith('vision_')) {
            const key = String(exec?.agent?.session?.id ?? 'global').replace(/[^a-zA-Z0-9_.-]/g, '_');
            const recent = deps.audit.export(key).at(-1);
            if (recent) {
                const logger = safeService(ctx, 'logger');
                logger?.info?.(`[dsh-vision-nexus][audit] tool=${recent.toolName} engine=${recent.engine} ` +
                    `duration=${recent.durationMs}ms confidence=${recent.confidence.toFixed(2)} ` +
                    `degraded=${recent.degraded} artifacts=${recent.artifactIds.length}`);
            }
        }
    });
    // 能力边界提示：注册一段系统提示（systemPrompt.context 契约：{name, order, text()}），
    // 明确主模型不得绕过工具脑补图片。systemPrompt 是可选服务：缺失时静默跳过。
    const systemPrompt = safeService(ctx, 'systemPrompt');
    systemPrompt?.context?.({
        name: 'dsh-vision-nexus:boundary',
        order: 50,
        text: () => '【视觉能力边界】你不具备直接看图能力，禁止凭空臆测图片内容。' +
            '任何图像信息必须通过 vision_* 工具调用获取；渐进模式下先调用 vision_activate 激活工具集。' +
            '工具结果只提供结构化文本、坐标、置信度与 Artifact ID（原图不会进入上下文）。' +
            '多图比对必须走 vision_pixel_diff 量化，禁止用模糊文字对比。',
    });
}
/**
 * 安全读取一个可选宿主服务。
 *
 * Cordis 的 ctx 是代理：读取既未 inject、也未注册的属性会抛
 * `cannot get property "X" without inject`，而不是返回 undefined。可选服务
 * 一律走这里，缺失时返回 undefined，绝不让插件在 apply 阶段抛错。
 */
function safeService(ctx, key) {
    try {
        const get = ctx.get;
        if (typeof get === 'function')
            return get.call(ctx, key);
    }
    catch { /* 服务不存在 */ }
    return undefined;
}
// ───────────────────────── 辅助 ─────────────────────────
/**
 * 递归摊平 schemastery 的 getter 包装字段。
 *  - 顶层字段、数组元素（如 vlBackends 条目）、嵌套对象里带 `.get()` 的包装都要解开，
 *    否则 `customBackends()` / `capabilities()` 会把这些条目当成空值过滤掉。
 *  - 返回值在边界处 cast 成 Partial<VisionConfig>，交给 resolveConfig 做归一化 / 钳制。
 */
function flattenConfig(raw) {
    const unwrap = (value) => {
        if (value && typeof value === 'object' && typeof value.get === 'function') {
            return unwrap(value.get());
        }
        if (Array.isArray(value))
            return value.map(unwrap);
        if (value && typeof value === 'object') {
            const out = {};
            for (const [k, v] of Object.entries(value)) {
                out[k] = unwrap(v);
            }
            return out;
        }
        return value;
    };
    if (!raw)
        return {};
    return unwrap(raw);
}
/** 解析工作目录根（会话 Artifact 存放处）。优先取 workingDirectory 服务。 */
function resolveBaseDir(ctx) {
    try {
        // 用 ctx.get 探测：未 inject 的服务直接下标读取会抛错（Cordis 代理行为）。
        const wd = typeof ctx.get === 'function' ? ctx.get('workingDirectory') : undefined;
        if (typeof wd?.defaultDirectory === 'string')
            return wd.defaultDirectory;
        if (typeof wd?.get === 'function')
            return wd.get({ session: { id: 'global' } });
    }
    catch { /* 回退 */ }
    return process.cwd();
}
/** 定位插件安装根目录（用于找 runtime/cv_worker.py）。 */
function resolvePluginRoot() {
    // ESM 下通过 import.meta.url 定位 lib/ 的上一级（即插件根）。
    // 用 fileURLToPath 正确处理 Windows 盘符与 URL 编码。
    try {
        const libDir = path.dirname(fileURLToPath(import.meta.url)); // .../dsh-vision-nexus/lib
        return path.dirname(libDir); // .../dsh-vision-nexus
    }
    catch {
        return process.cwd();
    }
}
/**
 * 探测宿主是否提供 WASM OCR 适配器（可选，无则结构化降级占位）。
 *
 * 必须走 ctx.get()：Cordis 的 ctx 是代理，读取一个既未 inject、也未注册的
 * 属性会抛 `cannot get property "..." without inject`，而不是返回 undefined。
 * 直接下标读取会让整个插件在 activate 阶段失败（已实测）。
 */
function resolveWasmAdapter(ctx) {
    const get = ctx.get;
    if (typeof get !== 'function')
        return undefined;
    let candidate;
    try {
        candidate = get.call(ctx, `${name}:wasmOcrAdapter`) ?? get.call(ctx, 'wasmOcrAdapter');
    }
    catch {
        // 服务不存在时 ctx.get 也可能抛错：视为未提供适配器。
        return undefined;
    }
    return typeof candidate === 'function' ? candidate : undefined;
}
/**
 * 从一个图片内容块里提取字节（防御性：兼容 data: URL / base64 / 宿主内联字节）。
 * 仅在插件内部摄取通道使用，提取结果只登记为 Artifact，不进入模型上下文。
 */
function extractImageBytes(part) {
    try {
        if (Buffer.isBuffer(part.data))
            return part.data;
        if (part.data instanceof Uint8Array)
            return Buffer.from(part.data);
        const url = typeof part.source?.data === 'string' ? part.source.data
            : typeof part.image_url?.url === 'string' ? part.image_url.url
                : typeof part.url === 'string' ? part.url : undefined;
        if (url && url.startsWith('data:')) {
            const comma = url.indexOf(',');
            const b64 = comma >= 0 ? url.slice(comma + 1) : url;
            return Buffer.from(b64, 'base64');
        }
        if (typeof part.base64 === 'string')
            return Buffer.from(part.base64, 'base64');
    }
    catch { /* 无法提取则跳过，不中断会话 */ }
    return undefined;
}
