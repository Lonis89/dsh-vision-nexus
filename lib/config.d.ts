/**
 * dsh-vision-nexus — 插件内部默认参数 & Config schema
 *
 * 这里集中定义所有默认参数，覆盖：运行模式总开关 / 引擎配置 / 工具调度 /
 * 任务限流与超时 / 产物与存储 / 健康自检。设置面板与 `apply()` 共用同一份
 * `DEFAULTS` 与 `resolveConfig()`，保证「重置为默认」与运行时归一化完全一致。
 *
 * 敏感配置（API Key / 后端地址明文）：后端只保存 `keyRef` 引用名，真正的值
 * 由 `ctx.credentials` 在调度层解析，不进入模型上下文、不写进 patch。
 *
 * 热生效：Config schema 的每个字段经 `volatile()` 标记，DSH 0.1.7+ 会把
 * 设置页写成 Volatile box 交给 apply；apply 每次读取都摊平为当前值，因此
 * 修改后无需重启即可生效。
 */
import type { VisionConfig, RetentionPreset } from './types.js';
export declare const DEFAULTS: {
    readonly enabled: true;
    readonly runMode: "auto";
    readonly autoTileEnabled: true;
    readonly browserRenderEnabled: true;
    readonly ocrLanguage: "mix";
    readonly confidenceAlertThreshold: 0.6;
    readonly degradeNotifyAgent: true;
    readonly autoCleanupEnabled: true;
    readonly retentionPreset: "24h";
    readonly autoSaveArtifacts: true;
    readonly loadingStrategy: "progressive";
    readonly sessionConcurrency: 1;
    readonly maxQueueLength: 32;
    readonly taskTimeoutMs: 30000;
    readonly oversizeEdgePx: 1600;
    readonly tileEdgePx: 768;
    readonly preprocessMaxEdgePx: 1280;
    readonly preprocessQuality: 82;
    readonly tempRetentionMs: number;
    readonly cleanupIntervalMs: number;
    readonly pythonPath: "";
    readonly cvRuntimePath: "";
    readonly localCvEnabled: true;
    readonly vlBackends: readonly [];
    readonly builtinVlEnabled: false;
    readonly builtinVlKeyRef: "";
    readonly builtinVlBaseURL: "";
    readonly builtinVlModel: "gpt-4o-mini";
    readonly wasmOcrEnabled: true;
    readonly auditSeparate: true;
    readonly auditMaxEntries: 500;
    readonly persistSessionState: true;
    /** 面板 Host 白名单：空=不启用额外校验；非空=仅允许列表内主机名访问设置路由。 */
    readonly panelAllowedHosts: string[];
};
/**
 * 规范化主机名（Host 头 / 白名单条目共用，单一事实来源）：
 *  - 去协议 / userinfo / 路径 / 查询 / 片段，转小写；
 *  - `[::1]:8080` → `::1`，`127.0.0.1:1234` → `127.0.0.1`，`::1` 保持；
 *  - 去末尾点。返回空串表示非法/空值。
 */
export declare function normalizeHost(input: unknown): string;
/** 保留时长档位 → 毫秒（never = 0，表示不清理）。 */
export declare const RETENTION_MS: Record<RetentionPreset, number>;
/** 归一化配置：合并默认值、钳制到合法区间，保证调度层拿到的永远是完整可用值。 */
export declare function resolveConfig(raw: Partial<VisionConfig> | undefined): VisionConfig;
/** 导出给设置面板「重置为默认」用的纯 JSON 默认值。 */
export declare function defaultPanelConfig(): VisionConfig;
/**
 * 由 schemastery 构建 Config schema（插件导出的 `Config`）。
 * 每个字段用 `volatile()` 标记 → 设置页可写、修改热生效。
 * 字段顺序与面板六大分区一致，便于设置页按声明顺序渲染表单。
 */
export declare function buildConfigSchema(z: any): any;
