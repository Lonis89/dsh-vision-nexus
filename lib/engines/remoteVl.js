/**
 * dsh-vision-nexus — 引擎 B：远端路由引擎（通用 VL 请求转发网关）
 *
 *  - 兼容各类「OpenAI 格式」的 VL 接口（chat/completions + image_url）。
 *  - 多后端优先级配置：按 priority 升序尝试；某后端异常自动切下一个。
 *  - 内置兜底 VL 链路（builtin-vl）作为自定义后端全失败后的次级兜底。
 *  - WASM 本地 OCR 作为最低兜底（见 wasmOcr.ts），远端服务异常时自动降级，
 *    不中断会话。
 *  - 敏感配置（API Key / baseURL 明文）只通过 ctx.credentials 解析，
 *    绝不进入模型上下文、绝不出现在错误 / 审计日志里（错误脱敏）。
 */
import { promises as fs } from 'node:fs';
/** 远端 VL 路由引擎。 */
export class RemoteVlEngine {
    /** 配置用 getter 注入：设置面板 volatile 更新后无需重启即可读到新后端列表。 */
    getConfig;
    resolveCredential;
    fetchImpl;
    constructor(config, resolveCredential) {
        this.getConfig = typeof config === 'function' ? config : () => config;
        this.resolveCredential = resolveCredential;
        this.fetchImpl = globalThis.fetch;
    }
    /** 当前（热生效后的）配置。 */
    get config() {
        return this.getConfig();
    }
    /** 解析按优先级排序、已启用的自定义后端。 */
    customBackends() {
        return [...this.config.vlBackends]
            .filter((b) => b.enabled && b.id && b.baseURL && b.keyRef)
            .sort((a, b) => a.priority - b.priority);
    }
    /**
     * 是否有任何可用远端能力（不含 WASM 兜底）。
     * 内置匿名兜底：`builtinVlEnabled` 开启即视为声明可用（无需显式 keyRef/baseURL，
     * 实际端点由部署环境注入；未注入时该跳会被跳过并降级，不中断会话）。
     */
    hasRemote() {
        return this.customBackends().length > 0
            || this.config.builtinVlEnabled
            || Boolean(this.config.builtinVlKeyRef && this.config.builtinVlBaseURL);
    }
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
    async run(req, onHop, finalNext) {
        const imageInputs = await this.loadImages(req);
        const prompt = buildPrompt(req);
        const backends = this.customBackends();
        const attempts = [
            ...backends.map((b) => ({ label: b.label || b.id, engine: 'custom-vl', baseURL: b.baseURL, model: b.model, keyRef: b.keyRef })),
        ];
        // 内置兜底：显式端点 或 面板「启用内置匿名兜底 VL」开关任一满足即登记一跳。
        // 匿名模式无显式端点时保持 baseURL 为空，run 循环会因缺端点跳过该跳并降级。
        if (this.config.builtinVlEnabled || (this.config.builtinVlKeyRef && this.config.builtinVlBaseURL)) {
            attempts.push({
                label: '内置兜底 VL 链路', engine: 'builtin-vl',
                baseURL: this.config.builtinVlBaseURL,
                model: this.config.builtinVlModel,
                keyRef: this.config.builtinVlKeyRef,
            });
        }
        let lastReason = '无可用远端后端';
        for (let i = 0; i < attempts.length; i++) {
            const a = attempts[i];
            const to = attempts[i + 1]?.engine ?? finalNext;
            // 匿名兜底开启但未注入端点：跳过该跳（不发起无效请求），由降级链继续。
            if (!a.baseURL) {
                lastReason = `后端 ${a.label} 未配置接口地址`;
                if (to)
                    onHop?.(a.engine, to, lastReason);
                continue;
            }
            // eslint-disable-next-line no-await-in-loop
            const key = await this.resolveCredential(a.keyRef);
            if (!key) {
                lastReason = `后端 ${a.label} 凭据未配置`;
                if (to)
                    onHop?.(a.engine, to, lastReason);
                continue;
            }
            try {
                // req.ctx 在个别调用方（命令行自检、宿主适配器）可能缺失：直接读
                // req.ctx.signal 会抛错并被下面的 catch 吞成「后端调用失败」，
                // 把「参数不完整」误报成「后端故障」，误导降级判断。这里安全取值。
                const signal = req.ctx?.signal;
                // eslint-disable-next-line no-await-in-loop
                const reply = await this.callVl(a.baseURL, a.model, key, prompt, imageInputs, signal);
                return {
                    data: { text: reply.text, backend: a.label, prompt },
                    confidence: reply.confidence,
                    engine: a.engine,
                    artifactPaths: [],
                };
            }
            catch (e) {
                lastReason = `后端 ${a.label} 调用失败`;
                if (to)
                    onHop?.(a.engine, to, redactRemoteError(e));
            }
        }
        throw new Error(`全部远端 VL 链路不可用：${lastReason}`);
    }
    /** OpenAI 兼容 chat/completions 调用（带 image_url）。 */
    async callVl(baseURL, model, apiKey, prompt, images, signal) {
        // 与面板连通性探测（testBackend）保持一致：若 baseURL 已是完整 chat/completions
        // 端点则不再重复追加，避免「自检绿、实际 404」的不一致。
        const clean = baseURL.replace(/\/+$/, '');
        const root = clean.endsWith('/chat/completions')
            ? clean.slice(0, -'/chat/completions'.length)
            : clean;
        const url = root.replace(/\/+$/, '') + '/chat/completions';
        const content = [{ type: 'text', text: prompt }];
        // 图片以 data URL 形式发给远端 VL（仅在插件→后端链路，绝不进主 LLM 上下文）。
        for (const img of images) {
            content.push({
                type: 'image_url',
                image_url: { url: `data:${img.mediaType};base64,${img.base64}` },
            });
        }
        const body = JSON.stringify({
            model,
            messages: [{ role: 'user', content }],
            temperature: 0,
            max_tokens: 1024,
        });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.config.taskTimeoutMs);
        const onAbort = () => controller.abort();
        signal?.addEventListener('abort', onAbort, { once: true });
        let res;
        try {
            res = await this.fetchImpl(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`,
                },
                body,
                signal: controller.signal,
            });
        }
        finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
        }
        if (!res.ok) {
            // 不回传响应体（可能含敏感回显），只报状态码。
            throw new Error(`HTTP ${res.status}`);
        }
        const json = await res.json();
        const text = String(json?.choices?.[0]?.message?.content ?? '');
        if (!text)
            throw new Error('VL 返回空内容');
        return { text, confidence: inferConfidence(json) };
    }
    /** 读取托管图像字节，转 base64 供远端请求使用（仅插件内部）。 */
    async loadImages(req) {
        const out = [];
        // imageIds 是会话内 Artifact id；调度层已把其绝对路径写入 params._image_paths。
        const paths = req.params._image_paths ?? [];
        for (const p of paths) {
            try {
                // eslint-disable-next-line no-await-in-loop
                const buf = await fs.readFile(p);
                out.push({ mediaType: 'image/png', base64: buf.toString('base64') });
            }
            catch { /* 跳过读不到的图，由 prompt 文本兜底 */ }
        }
        return out;
    }
}
/** 按工具构造给 VL 的指令（模型只看到结构化文本，不会脑补图像）。 */
function buildPrompt(req) {
    const q = typeof req.params.question === 'string' ? req.params.question : '';
    const target = typeof req.params.target === 'string' ? req.params.target : '';
    switch (req.op) {
        case 'vision_glance':
            return q
                ? `请仅依据所给图像回答：${q}。不要臆测图中不存在的内容；无法确认时明确说明。`
                : '请客观描述图像主要内容、布局与关键元素；不要臆测不存在的内容。';
        case 'vision_ground':
            return `请在图像中定位：${target}。只返回一个标准化 bbox：{"x":...,"y":...,"width":...,"height":...} 与 0..1 置信度，不要输出其他内容。`;
        case 'vision_long_ocr':
            return '请对这张长图做分段结构化 OCR，输出带位置标记的 markdown，并标注每段置信度。';
        default:
            return `请依据图像完成视觉任务 ${req.op}，给出结构化结果与置信度。`;
    }
}
function inferConfidence(json) {
    // 部分兼容接口会回传 logprobs / confidence；否则给保守默认。
    const c = json?.choices?.[0]?.confidence ?? json?.confidence;
    return typeof c === 'number' && Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 0.72;
}
function redactRemoteError(e) {
    const raw = e instanceof Error ? e.message : String(e);
    return raw
        .replace(/https?:\/\/[^\s)]+/g, '<url>')
        // 键值形态保留前缀便于判因；sk 形态整体替换（无可靠边界）。函数式替换避免
        // 捕获组贪婪回溯导致密钥前段明文残留。
        .replace(/((?:api[_-]?key|access[_-]?token|bearer|token|key)\s*[=:]\s*)[A-Za-z0-9._-]{4,}|\bsk[_-][A-Za-z0-9_-]{4,}/gi, (_m, prefix) => (prefix ? `${prefix}<redacted>` : '<redacted>'))
        .slice(0, 160);
}
