import { sessionKeyOf } from './session.js';
import { ENVELOPE_OUTPUT_SCHEMA, TOOL_DEFINITIONS, VISION_TOOL_NAMES } from './toolSchemas.js';
import { newAuditId } from './audit.js';
/**
 * defineTool 的轻量本地实现：把「作者友好的参数 spec」编译成
 * ctx.tools.register 需要的 ToolDefinition（parameters / output.schema / execute）。
 * 与 DSH 内置 defineTool 行为对齐：参数校验、输出 schema、render 投影。
 */
export function defineTool(options) {
    return {
        name: options.name,
        description: options.description,
        // 参数 spec 已是 JSON Schema 子集（type/enum/required/...），直接编译为对象根。
        parameters: toObjectSchema(options.parameters),
        output: {
            schema: options.outputSchema ?? ENVELOPE_OUTPUT_SCHEMA,
            render(args, value) {
                return options.render(args, value);
            },
        },
        async execute(args, exec) {
            // DSH 要求工具返回值是「无损 JSON」：undefined 字段、NaN、函数等会让调用
            // 以 `invalid output: value is not lossless JSON` 失败。信封里 capabilityNotice
            // / queuePosition 等本就是可选项，统一在出口净化，避免调用方踩坑。
            return toLosslessJson(await options.execute(args, exec));
        },
    };
}
/** 递归剔除 undefined / 函数，并把 NaN/Infinity 收敛为 null，产出无损 JSON 值。 */
function toLosslessJson(value) {
    if (value === undefined || typeof value === 'function')
        return undefined;
    if (typeof value === 'number')
        return Number.isFinite(value) ? value : null;
    if (value === null || typeof value !== 'object')
        return value;
    if (Array.isArray(value)) {
        return value.map((v) => {
            const out = toLosslessJson(v);
            return out === undefined ? null : out;
        });
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) {
        const cleaned = toLosslessJson(v);
        if (cleaned !== undefined)
            out[k] = cleaned;
    }
    return out;
}
/**
 * 把「作者友好」的参数 spec 递归编译为受支持的 JSON Schema 子集。
 *  - 作者用 `required: true`（布尔，放在字段上）；运行时要的是对象级 `required: string[]`。
 *  - 嵌套 object 的 properties 同样递归处理，避免把 required 布尔漏进 schema。
 */
function toObjectSchema(spec) {
    return compileObject(spec);
}
/** 编译一个对象节点：返回 {type:'object', properties, required?}。 */
function compileObject(spec) {
    const properties = {};
    const required = [];
    for (const [key, value] of Object.entries(spec)) {
        const v = { ...value };
        if (v.required === true)
            required.push(key);
        delete v.required;
        // 递归：嵌套对象。
        if (v.type === 'object' && v.properties && typeof v.properties === 'object') {
            const nested = compileObject(v.properties);
            v.properties = nested.properties;
            v.required = nested.required ?? [];
        }
        // 递归：数组元素里的对象。
        if (v.type === 'array' && v.items && typeof v.items === 'object') {
            const item = v.items;
            if (item.type === 'object' && item.properties && typeof item.properties === 'object') {
                v.items = compileObject(item.properties);
            }
        }
        properties[key] = v;
    }
    return {
        type: 'object',
        additionalProperties: false,
        properties,
        ...(required.length ? { required } : {}),
    };
}
/** 把统一信封投影成给主模型看的文本（绝不回传图像二进制 / base64）。 */
export function renderEnvelope(_args, value) {
    const lines = [];
    lines.push(`[vision] engine=${value.engine} confidence=${value.confidence.toFixed(2)} degraded=${value.degraded}`);
    if (value.queued) {
        lines.push(`任务排队中（位置 ${value.queuePosition}）。`);
    }
    if (value.artifactIds.length) {
        lines.push(`产物 Artifact ID：${value.artifactIds.join(', ')}（可在会话内反复引用）`);
    }
    if (value.capabilityNotice) {
        lines.push(`能力限制：${value.capabilityNotice}`);
    }
    // data 是结构化文本 / 数值，序列化注入；模型据此理解图像，无需看图。
    lines.push('结构化结果：' + safeStringify(value.data));
    lines.push(`审计 ID：${value.auditId}（审计信息单独输出，不污染本回答）`);
    return [{ type: 'text', text: lines.join('\n') }];
}
function safeStringify(data) {
    try {
        const s = JSON.stringify(data, null, 2);
        return s.length > 6000 ? s.slice(0, 6000) + '\n…(已截断)' : s;
    }
    catch {
        return String(data);
    }
}
/** 工具技能层：管理渐进激活与工具注册。 */
export class ToolSkillLayer {
    ctx;
    /** 配置 getter：加载策略 / 面板字段热更新后即时生效。 */
    getConfig;
    scheduler;
    sessions;
    /** 已注册的工具名 → disposer。 */
    registered = new Map();
    /** 是否已完成全量注册（进程级，避免重复注册）。 */
    fullRegistered = false;
    constructor(ctx, config, scheduler, sessions) {
        this.ctx = ctx;
        this.getConfig = typeof config === 'function' ? config : () => config;
        this.scheduler = scheduler;
        this.sessions = sessions;
    }
    get config() {
        return this.getConfig();
    }
    /** 会话初始化：按策略注册工具。 */
    async init() {
        // 无论哪种策略都注册激活指令（全量模式下它是幂等的状态 / 能力查询）。
        this.registerActivateOnly();
        if (this.config.loadingStrategy === 'eager') {
            // 全量预加载：一次性注册全部视觉工具。
            await this.registerFullSet();
        }
        // 渐进模式：此刻仅暴露 vision_activate；模型首次需要视觉时由 activate()
        // 调用 registerFullSet() 动态注册全套工具。
    }
    /** 渐进模式：仅注册 vision_activate。 */
    registerActivateOnly() {
        if (this.registered.has('vision_activate'))
            return;
        const def = defineTool({
            name: 'vision_activate',
            description: TOOL_DEFINITIONS.find((t) => t.name === 'vision_activate').description,
            parameters: {},
            render: renderEnvelope,
            execute: async (_args, exec) => this.activate(exec),
        });
        const dispose = this.ctx.tools.register(def);
        this.registered.set('vision_activate', dispose);
    }
    /** 注册全套视觉工具（渐进激活 / 全量预加载共用）。 */
    async registerFullSet() {
        if (this.fullRegistered)
            return;
        for (const meta of TOOL_DEFINITIONS) {
            if (meta.name === 'vision_activate')
                continue;
            if (this.registered.has(meta.name))
                continue;
            const def = defineTool({
                name: meta.name,
                description: meta.description,
                parameters: meta.parameters,
                render: renderEnvelope,
                execute: async (args, exec) => {
                    // 会话隔离门禁：渐进模式下工具表是进程级共享的，但「是否已激活」
                    // 按会话记录。未激活的会话不得绕过 vision_activate 直接使用视觉工具。
                    if (this.config.loadingStrategy === 'progressive') {
                        const key = sessionKeyOf(exec);
                        const state = await this.sessions.get(key);
                        if (!state.activated) {
                            return {
                                data: { notice: '本会话尚未激活视觉工具集，请先调用 vision_activate 激活后再使用。' },
                                confidence: 0, artifactIds: [], engine: 'none', degraded: false,
                                degradeChain: [], auditId: newAuditId(),
                            };
                        }
                    }
                    return this.scheduler.execute(meta.name, args, exec);
                },
            });
            const dispose = this.ctx.tools.register(def);
            this.registered.set(meta.name, dispose);
        }
        this.fullRegistered = true;
        // 宿主 tools 服务在 register() 内部会发出 tools/change 刷新工具表，
        // 这里无需手动 emit。
    }
    /**
     * 激活整套视觉工具集：首次需要视觉时调用；幂等。
     * 返回当前可用工具子集、引擎健康状态与能力边界说明。
     */
    async activate(exec) {
        const sessionKey = sessionKeyOf(exec);
        const state = await this.sessions.get(sessionKey);
        const caps = await this.scheduler.capabilities();
        if (this.config.loadingStrategy === 'progressive' && !this.fullRegistered) {
            await this.registerFullSet();
        }
        const firstTime = !state.activated;
        state.activated = true;
        await this.sessions.persist(sessionKey);
        // 报告本会话已登记的图片索引，供模型后续用 image_id 引用。
        const images = await this.sessions.listImages(sessionKey);
        return {
            data: {
                activated: true,
                firstTime,
                strategy: this.config.loadingStrategy,
                mode: caps.mode,
                registeredImages: images.map((r) => ({
                    id: r.id, width: r.width, height: r.height,
                    oversized: r.oversized, tiles: r.tiles,
                })),
                imageHint: images.length === 0
                    ? '当前会话尚无已登记图片。请让宿主通过图片附件摄取通道登记图片后，再用返回的 image_id 调用视觉工具。'
                    : `当前会话已登记 ${images.length} 张图片，可用其 image_id 调用视觉工具；大图(oversized=true)将自动分块采样，禁止一次性全图 glance。`,
                capableTools: caps.capableTools,
                disabledTools: caps.disabledTools,
                engines: {
                    localCv: caps.localCv,
                    customVlBackends: caps.customVlBackends,
                    builtinVl: caps.builtinVl,
                    wasmOcr: caps.wasmOcr,
                },
                notice: caps.notice,
                boundary: '主模型不具备看图能力：所有图像信息必须通过 vision_* 工具调用获取；' +
                    '原图/base64 不进入上下文，工具结果只含结构化文本、坐标、置信度与 Artifact ID。' +
                    '多图比对强制走 vision_pixel_diff 量化，禁止模糊文字对比。',
            },
            confidence: 1,
            artifactIds: [],
            engine: 'none',
            degraded: false,
            degradeChain: [],
            auditId: newAuditId(),
            capabilityNotice: caps.mode === 'route-only' ? caps.notice : undefined,
        };
    }
    /** 当前已注册的视觉工具名清单（供设置面板「已注册工具清单」展示）。 */
    registeredTools() {
        return [...this.registered.keys()];
    }
    /** 卸载全部工具注册（ctx.effect disposer 调用）。 */
    dispose() {
        for (const dispose of this.registered.values()) {
            try {
                dispose();
            }
            catch { /* 忽略重复卸载 */ }
        }
        this.registered.clear();
        this.fullRegistered = false;
    }
}
/** 渐进激活后对外暴露的工具名清单（供健康自检 / 文档使用）。 */
export { VISION_TOOL_NAMES };
