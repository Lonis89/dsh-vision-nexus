/**
 * dsh-vision-nexus — 设置面板的 Host 端支撑
 *
 * 职责：
 *  - 通过 `ctx.webServer.register` 暴露同源 HTTP 路由，供设置面板调用：
 *      GET  /plugins/dsh-vision-nexus/health        -> 健康自检结果
 *      GET  /plugins/dsh-vision-nexus/status        -> 实时运行状态
 *      POST /plugins/dsh-vision-nexus/probe-python  -> 自动检测 Python 运行时
 *      POST /plugins/dsh-vision-nexus/probe-browser -> 检测浏览器渲染内核
 *      POST /plugins/dsh-vision-nexus/test-vl       -> 检测某个 VL 后端连通性
 *      GET  /plugins/dsh-vision-nexus/export        -> 导出（脱敏）配置 JSON
 *  - 这些路由只回结构化状态，绝不回传任何 API Key 明文 / 图片字节。
 *  - 同源校验（origin 必须与 host 一致），拒绝跨站调用。
 *
 * 注：设置值的读写由 DSH 设置表单（`configForms` / `settingsScope`）负责，
 * 本模块只提供「状态自检 / 连通性探测 / 配置导出」这些需要 Host 侧能力的动作。
 */
import { spawn } from 'node:child_process';
import { defaultPanelConfig, normalizeHost, resolveConfig } from '../config.js';
import { probePython, probeRuntime } from '../engines/localCv.js';
import { ROUTES } from '../routes.js';
export { ROUTES };
/**
 * 同源 / CSRF / DNS rebinding 纵深校验：
 *  1) 浏览器携带的 `Sec-Fetch-Site: cross-site` 是最可靠的跨站信号（rebinding 时
 *     攻击页发起的请求必为 cross-site），直接拒绝；同源面板为 same-origin/none。
 *  2) 有 Origin 时必须与 Host 一致（挡普通跨站）；无 Origin 且存在 Sec-Fetch-Site
 *     时要求其为 same-origin/none，挡不带 Origin 的简单跨站 GET（如 <img>）。
 *  3) 完全没有两者（curl / 本地工具 / 同源直接导航）放行——这是localhost 插件
 *     的正常访问路径，不属于浏览器跨站攻击面。
 *  4) 可选 Host 白名单（panelAllowedHosts，默认空）：DNS rebinding 时浏览器会认为
 *     攻击者域名「同源」，前 3 条信号可能被同时满足；此时若配置了白名单，则请求
 *     Host 的主机名必须命中列表才放行。白名单为空时完全跳过此检查——不改变旧版
 *     及默认部署的行为，也不会因宿主绑定地址未知而误伤真实面板。
 *
 * 注意：不强行校验 Host 必须为 loopback——DSH webServer 的实际绑定地址由宿主
 * 决定，贸然拒绝非 loopback 可能使真实面板失效；白名单把这一决策权交给部署者。
 */
export function sameOrigin(req, allowedHosts = []) {
    const origin = req.headers['origin'];
    const host = req.headers['host'];
    const fetchSite = req.headers['sec-fetch-site'];
    // 浏览器明确标注跨站：直接拒绝（DNS rebinding / 跨站 CSRF）。
    if (typeof fetchSite === 'string' && fetchSite.toLowerCase() === 'cross-site')
        return false;
    // 可选白名单硬校验：DNS rebinding 时 Origin===Host 且 Sec-Fetch-Site=same-origin，
    // 前两条无法区分，只有部署者声明的可信主机名能挡住。列表规范化在 resolveConfig
    // 完成（小写 / 去端口 / 去协议），此处用同一 normalizeHost 规范化请求 Host。
    if (allowedHosts.length > 0) {
        if (typeof host !== 'string')
            return false;
        const hostName = normalizeHost(host);
        if (!hostName)
            return false;
        return allowedHosts.some((allowed) => normalizeHost(allowed) === hostName);
    }
    if (typeof origin === 'string') {
        // 有 Origin：必须与 Host 一致。
        if (typeof host !== 'string')
            return false;
        return origin === `http://${host}` || origin === `https://${host}`;
    }
    // 无 Origin 但有 Sec-Fetch-Site：要求同源 / 同站 / 无（拒绝 cross-site 已在上）。
    // same-origin / same-site / none 均可放行；未知值保守拒绝。
    if (typeof fetchSite === 'string') {
        const s = fetchSite.toLowerCase();
        return s === 'same-origin' || s === 'same-site' || s === 'none';
    }
    // 无 Origin 且无 Sec-Fetch-Site：非浏览器请求 / 同源导航，放行。
    return true;
}
function json(res, status, value) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(value));
}
const MAX_BODY_BYTES = 64 * 1024; // POST body 上限，防超大请求耗尽内存。
async function readBody(req) {
    // Node IncomingMessage 是异步可迭代对象；累计超限即抛错，避免无界缓冲。
    const chunks = [];
    let total = 0;
    const asyncReq = req;
    if (typeof asyncReq[Symbol.asyncIterator] === 'function') {
        for await (const chunk of asyncReq) {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
            total += buf.length;
            if (total > MAX_BODY_BYTES)
                throw new Error('请求体过大');
            chunks.push(buf);
        }
    }
    return Buffer.concat(chunks).toString('utf8');
}
// ───────────────────────── 自检实现 ─────────────────────────
/** 依次检测 Python 环境 / 浏览器渲染 / 远端后端 / WASM OCR。 */
export async function runHealthCheck(deps) {
    const cfg = deps.currentConfig();
    const items = [];
    // ① Python 环境
    const python = await probePython(cfg);
    const runtimeOk = python ? await probeRuntime(cfg, python, deps.pluginRoot) : false;
    if (python && runtimeOk) {
        items.push({ key: 'python', label: 'Python / CV 运行时', state: 'ok', detail: `已检测到 ${python}，cv_worker.py 可用` });
    }
    else if (cfg.localCvEnabled) {
        items.push({
            key: 'python', label: 'Python / CV 运行时', state: 'warn',
            detail: python ? '解释器存在但 cv_worker 探测失败' : '未检测到 python3 / python / py',
            fix: '安装 Python 3 并 pip install Pillow numpy，或在面板填写解释器路径后点「自动检测」。缺失时像素类工具自动禁用。',
        });
    }
    else {
        items.push({ key: 'python', label: 'Python / CV 运行时', state: 'ok', detail: '本地 CV 引擎已按配置关闭（纯路由模式）' });
    }
    // ② 浏览器渲染内核（HTML→截图依赖）
    const browser = await probeBrowser();
    if (browser.available) {
        items.push({ key: 'browser', label: '渲染截图浏览器内核', state: 'ok', detail: `${browser.name} 可用于 HTML 渲染截图` });
    }
    else if (cfg.browserRenderEnabled) {
        items.push({
            key: 'browser', label: '渲染截图浏览器内核', state: 'warn',
            detail: '未检测到可用的浏览器渲染内核',
            fix: 'pip install playwright && playwright install chromium；未安装时 html_render_snapshot 返回能力限制说明而不伪造截图。',
        });
    }
    else {
        items.push({ key: 'browser', label: '渲染截图浏览器内核', state: 'ok', detail: '已按配置关闭渲染截图检测' });
    }
    // ③ 远端后端连通性
    // 与运行时 customBackends() / capabilities() 同口径：keyRef 是后端可用性的必要条件之一，
    // 缺 keyRef 的后端运行时会被过滤，自检不应把它算作「可用」造成三向不一致。
    const enabledBackends = cfg.vlBackends.filter((b) => b.enabled && b.id && b.baseURL && b.model && b.keyRef);
    if (enabledBackends.length === 0 && !cfg.builtinVlEnabled) {
        items.push({
            key: 'vl', label: '远端 VL 后端', state: 'warn',
            detail: '未配置任何启用状态的 VL 后端',
            fix: '在「引擎 B」添加后端，或开启内置匿名兜底 VL 服务。纯本地模式可忽略。',
        });
    }
    else {
        let reachable = 0;
        const failures = [];
        for (const b of enabledBackends) {
            // eslint-disable-next-line no-await-in-loop
            const r = await testBackend(b.baseURL, b.model, b.keyRef ? await deps.resolveCredential(b.keyRef) : undefined);
            if (r.ok)
                reachable++;
            else
                failures.push(`${b.label || b.id}: ${r.detail}`);
        }
        if (cfg.builtinVlEnabled)
            reachable++; // 内置兜底按配置声明可用（实际连通性由运行时降级链验证）
        if (reachable > 0) {
            items.push({
                key: 'vl', label: '远端 VL 后端', state: failures.length ? 'warn' : 'ok',
                detail: failures.length ? `${reachable} 条可用，${failures.length} 条异常：${failures.join('；')}` : `${reachable} 条后端可用`,
                ...(failures.length ? { fix: '检查异常后端的接口地址 / 凭据引用名 / 模型名称与网络连通性。' } : {}),
            });
        }
        else {
            items.push({
                key: 'vl', label: '远端 VL 后端', state: 'warn',
                detail: `全部 ${failures.length} 条后端不可达：${failures.join('；')}`,
                fix: '检查接口地址、网络与 API Key；运行时会自动降级到 WASM 本地 OCR，不中断会话。',
            });
        }
    }
    // ④ WASM 本地 OCR
    if (cfg.wasmOcrEnabled) {
        const loaded = deps.wasmOcrLoaded();
        items.push({
            key: 'wasm', label: 'WASM 本地 OCR 兜底', state: loaded ? 'ok' : 'warn',
            detail: loaded ? '已装载 OCR 适配器' : '开关已开但未装载 OCR 适配器（仅结构化降级占位）',
            ...(!loaded ? { fix: '装载 WASM OCR 适配器后可离线识别文字；未装载时工具返回低置信度能力限制说明，绝不编造内容。' } : {}),
        });
    }
    else {
        items.push({ key: 'wasm', label: 'WASM 本地 OCR 兜底', state: 'ok', detail: '已按配置关闭' });
    }
    // ⑤ 配置合法性
    const cfgIssues = [];
    if (cfg.sessionConcurrency < 1 || cfg.sessionConcurrency > 5)
        cfgIssues.push('并发数超出 1~5');
    if (cfg.preprocessQuality < 1 || cfg.preprocessQuality > 100)
        cfgIssues.push('压缩质量超出 1~100');
    if (cfg.taskTimeoutMs < 1000)
        cfgIssues.push('超时时间过短');
    items.push({
        key: 'config', label: '配置合法性', state: cfgIssues.length ? 'error' : 'ok',
        detail: cfgIssues.length ? cfgIssues.join('；') : '全部参数在合法区间内',
        ...(cfgIssues.length ? { fix: '在面板中修正标红字段后自动重新校验。' } : {}),
    });
    const ok = items.every((i) => i.state === 'ok');
    return { ok, items, checkedAt: Date.now() };
}
/** 探测浏览器渲染内核：优先 python playwright，其次系统 chromium/chrome。 */
export async function probeBrowser() {
    // 先查常见可执行文件。
    for (const exe of ['chromium', 'chromium-browser', 'google-chrome', 'chrome']) {
        // eslint-disable-next-line no-await-in-loop
        if (await canSpawn(exe, ['--version']))
            return { available: true, name: exe };
    }
    // 再查 python playwright。
    const py = await probePython(defaultPanelConfig());
    if (py && await canSpawn(py, ['-c', 'import playwright; print("playwright-ok")'])) {
        return { available: true, name: 'python playwright' };
    }
    return { available: false, name: '' };
}
/** 检测单个 VL 后端连通性：只发最小 models 列表请求，不回传密钥。 */
export async function testBackend(baseURL, model, apiKey) {
    void model; // 连通性只看端点可达；模型名用于 chat/completions 调用阶段。
    const clean = baseURL.replace(/\/+$/, '');
    // 已是完整 chat/completions 端点时改探测其 /models 基路径，避免拼出错误 URL。
    const root = clean.endsWith('/chat/completions')
        ? clean.slice(0, -'/chat/completions'.length)
        : clean;
    const url = root.replace(/\/+$/, '') + '/models';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
        const res = await fetch(url, {
            method: 'GET',
            headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
            signal: controller.signal,
        });
        if (res.ok)
            return { ok: true, detail: `HTTP ${res.status}` };
        // 部分兼容端点没有 /models，401/404 也说明网络可达（只是需 chat/completions）。
        if (res.status === 401 || res.status === 403 || res.status === 404) {
            return { ok: true, detail: `端点可达(HTTP ${res.status})，实际调用走 chat/completions` };
        }
        return { ok: false, detail: `HTTP ${res.status}` };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, detail: msg.replace(/https?:\/\/[^\s)]+/g, '<url>').slice(0, 120) };
    }
    finally {
        clearTimeout(timer);
    }
}
function canSpawn(cmd, args) {
    return new Promise((resolve) => {
        let done = false;
        const finish = (v) => { if (!done) {
            done = true;
            resolve(v);
        } };
        try {
            const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
            const timer = setTimeout(() => { child.kill(); finish(false); }, 4000);
            child.on('error', () => { clearTimeout(timer); finish(false); });
            child.on('close', (code) => { clearTimeout(timer); finish(code === 0); });
        }
        catch {
            finish(false);
        }
    });
}
/** 脱敏导出配置：剥离 keyRef 指向的明文（配置里本就只有引用名），并标注来源。 */
export function exportSanitizedConfig(deps) {
    const raw = deps.rawConfig();
    // 后端条目里可能带 keyRef；明文密钥不在配置中，但额外抹掉任何疑似密钥字段。
    const clone = JSON.parse(JSON.stringify(raw));
    const backends = clone.vlBackends;
    if (Array.isArray(backends)) {
        clone.vlBackends = backends.map((b) => {
            const c = { ...b };
            for (const k of Object.keys(c))
                if (/apiKey|token|secret|password/i.test(k))
                    delete c[k];
            return c;
        });
    }
    return {
        _plugin: 'dsh-vision-nexus',
        _version: 1,
        _notice: '导出内容不含 API Key 明文；凭据请在目标机器通过凭证服务重新登记 keyRef。',
        config: clone,
    };
}
// ───────────────────────── 路由注册 ─────────────────────────
/** 把所有面板路由挂到 ctx.webServer，并通过 ctx.effect 返回 disposer。 */
export function registerPanelRoutes(ctx, deps) {
    // 必须用 ctx.get 探测：未 inject 的服务直接下标读取会抛
    // `cannot get property "webServer" without inject`，使整个插件激活失败。
    // webServer 缺失（无 HTTP 宿主）时面板路由整体降级为不挂载。
    let ws;
    try {
        ws = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined;
    }
    catch {
        ws = undefined;
    }
    if (!ws || typeof ws.register !== 'function')
        return () => { };
    const disposers = [];
    const mount = (path, handler, method) => {
        disposers.push(ws.register({
            kind: 'exact',
            path,
            handler: async (req, res) => {
                // 用热生效后的当前配置取白名单（volatile 字段改后无需重启）。
                if (!sameOrigin(req, deps.currentConfig().panelAllowedHosts))
                    return json(res, 403, { error: 'origin-rejected' });
                if ((req.method ?? 'GET').toUpperCase() !== method)
                    return json(res, 405, { error: 'method-not-allowed' });
                try {
                    await handler(req, res);
                }
                catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    json(res, 500, { error: msg.replace(/https?:\/\/[^\s)]+/g, '<url>').slice(0, 200) });
                }
            },
        }));
    };
    mount(ROUTES.health, async (_req, res) => {
        json(res, 200, await runHealthCheck(deps));
    }, 'GET');
    mount(ROUTES.status, (_req, res) => {
        const cfg = deps.currentConfig();
        const reg = deps.toolRegistration();
        const s = deps.stats();
        const mode = cfg.runMode === 'local-only' ? '仅本地CV' : cfg.runMode === 'remote-only' ? '仅远端VL' : '自动自适应';
        const activeEngine = cfg.runMode === 'local-only' ? 'local-cv'
            : cfg.runMode === 'remote-only' ? (cfg.vlBackends[0]?.label || 'custom-vl')
                : (cfg.localCvEnabled ? 'local-cv → custom-vl → wasm-ocr' : 'custom-vl → wasm-ocr');
        const status = {
            pluginEnabled: cfg.enabled,
            activeEngine,
            activeEngineLabel: mode,
            registeredTools: reg.registered,
            queuedTasks: s.queuedTasks,
            runningTasks: s.runningTasks,
            todayCalls: s.todayCalls,
            todayDegrades: s.todayDegrades,
            avgConfidence: Number(s.avgConfidence.toFixed(2)),
            mode,
        };
        json(res, 200, status);
    }, 'GET');
    mount(ROUTES.probePython, async (_req, res) => {
        const cfg = deps.currentConfig();
        const python = await probePython(cfg);
        const runtimeOk = python ? await probeRuntime(cfg, python, deps.pluginRoot) : false;
        json(res, 200, { found: Boolean(python), path: python ?? '', runtimeOk });
    }, 'POST');
    mount(ROUTES.probeBrowser, async (_req, res) => {
        json(res, 200, await probeBrowser());
    }, 'POST');
    mount(ROUTES.testVl, async (req, res) => {
        let body = {};
        try {
            body = JSON.parse(await readBody(req));
        }
        catch { /* 空体 */ }
        if (!body.baseURL || !body.model)
            return json(res, 400, { ok: false, detail: '缺少 baseURL / model' });
        // 安全：只探测「已在配置里登记」的后端，且 keyRef 必须与该条一致。
        // 否则任意同源请求可拿任意 keyRef 的明文去打任意 URL，造成凭据外泄。
        const cfg = deps.currentConfig();
        const match = cfg.vlBackends.find((b) => b.enabled
            && b.baseURL.replace(/\/+$/, '') === body.baseURL.replace(/\/+$/, '')
            && b.model === body.model
            && (body.keyRef === undefined || body.keyRef === b.keyRef));
        if (!match) {
            return json(res, 403, { ok: false, detail: '该后端未在插件配置中登记，拒绝连通性探测' });
        }
        // 只允许用该条已登记的 keyRef 解析凭据。
        const key = match.keyRef ? await deps.resolveCredential(match.keyRef) : undefined;
        json(res, 200, await testBackend(match.baseURL, match.model, key));
    }, 'POST');
    mount(ROUTES.export, (_req, res) => {
        json(res, 200, exportSanitizedConfig(deps));
    }, 'GET');
    return () => {
        for (const d of disposers) {
            try {
                d();
            }
            catch { /* ignore */ }
        }
    };
}
/** 供面板导入时使用：把导入的 JSON 归一化并给出「需重新登记凭据」提示。 */
export function describeImport(raw) {
    try {
        const payload = raw;
        const configPart = (payload && typeof payload === 'object' && 'config' in payload)
            ? payload.config
            : payload;
        if (!configPart || typeof configPart !== 'object')
            return { ok: false, error: 'JSON 中未找到配置对象' };
        return {
            ok: true,
            config: resolveConfig(configPart),
            notice: '导入成功：明文 API Key 不会随 JSON 迁移，请在目标机器通过凭证服务重新登记各后端的 keyRef。',
        };
    }
    catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}
