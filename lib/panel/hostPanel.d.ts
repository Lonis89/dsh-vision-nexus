import type { Context } from '@deepseek-ai/cordis';
import type { VisionConfig } from '../types.js';
import { ROUTES } from '../routes.js';
export { ROUTES };
/** 健康自检结果：每项带 正常 / 警告 / 异常 + 原因 + 修复指引。 */
export interface HealthItem {
    key: string;
    label: string;
    state: 'ok' | 'warn' | 'error';
    detail: string;
    fix?: string;
}
export interface HealthReport {
    ok: boolean;
    items: HealthItem[];
    checkedAt: number;
}
/** 实时运行状态（面板「当前运行状态」展示）。 */
export interface LiveStatus {
    pluginEnabled: boolean;
    activeEngine: string;
    activeEngineLabel: string;
    registeredTools: string[];
    queuedTasks: number;
    runningTasks: number;
    todayCalls: number;
    todayDegrades: number;
    avgConfidence: number;
    mode: string;
}
/** 面板可调用的 Host 动作聚合，传给路由处理器。 */
export interface PanelHostDeps {
    /** 读取当前（热生效后的）配置。 */
    currentConfig: () => VisionConfig;
    /** 当前是否已完成整套工具注册（渐进模式下激活后为 true）。 */
    toolRegistration: () => {
        registered: string[];
    };
    /** 会话统计快照。 */
    stats: () => {
        queuedTasks: number;
        runningTasks: number;
        todayCalls: number;
        todayDegrades: number;
        avgConfidence: number;
    };
    /** 插件根目录（定位 cv_worker.py）。 */
    pluginRoot: string;
    /** 解析凭据引用名 → 明文（仅 Host 内部用于连通性探测，绝不回传）。 */
    resolveCredential: (ref: string) => Promise<string | undefined>;
    /** WASM OCR 适配器是否已装载。 */
    wasmOcrLoaded: () => boolean;
    /** 导出用的原始配置（脱敏前）。 */
    rawConfig: () => Record<string, unknown>;
}
type Req = {
    method?: string;
    url?: string;
    headers: Record<string, unknown>;
};
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
export declare function sameOrigin(req: Req, allowedHosts?: readonly string[]): boolean;
/** 依次检测 Python 环境 / 浏览器渲染 / 远端后端 / WASM OCR。 */
export declare function runHealthCheck(deps: PanelHostDeps): Promise<HealthReport>;
/** 探测浏览器渲染内核：优先 python playwright，其次系统 chromium/chrome。 */
export declare function probeBrowser(): Promise<{
    available: boolean;
    name: string;
}>;
/** 检测单个 VL 后端连通性：只发最小 models 列表请求，不回传密钥。 */
export declare function testBackend(baseURL: string, model: string, apiKey?: string): Promise<{
    ok: boolean;
    detail: string;
}>;
/** 脱敏导出配置：剥离 keyRef 指向的明文（配置里本就只有引用名），并标注来源。 */
export declare function exportSanitizedConfig(deps: PanelHostDeps): Record<string, unknown>;
/** 把所有面板路由挂到 ctx.webServer，并通过 ctx.effect 返回 disposer。 */
export declare function registerPanelRoutes(ctx: Context, deps: PanelHostDeps): () => void;
/** 供面板导入时使用：把导入的 JSON 归一化并给出「需重新登记凭据」提示。 */
export declare function describeImport(raw: unknown): {
    ok: boolean;
    config?: VisionConfig;
    error?: string;
    notice?: string;
};
