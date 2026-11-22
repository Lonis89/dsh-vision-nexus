/**
 * dsh-vision-nexus — 设置面板的数据模型（Client 侧）
 *
 * 与 Host 侧 `config.ts` 的 DEFAULTS / resolveConfig 保持同一套字段与默认值。
 * 这里只负责：字段元数据（供表单渲染）、实时校验、导入/导出脱敏、
 * 以及「重置为默认」的纯值构造。表单读写一律走 DSH 设置表单 scope。
 *
 * 注意：本文件不得包含任何 API Key 明文；后端条目里的 `keyRef` 只是引用名。
 */
export declare const DEFAULTS: {
    readonly enabled: true;
    readonly runMode: "auto";
    readonly loadingStrategy: "progressive";
    readonly autoTileEnabled: true;
    readonly oversizeEdgePx: 1600;
    readonly pythonPath: "";
    readonly cvRuntimePath: "";
    readonly localCvEnabled: true;
    readonly browserRenderEnabled: true;
    readonly vlBackends: VlBackendRow[];
    readonly builtinVlEnabled: false;
    readonly builtinVlKeyRef: "";
    readonly builtinVlBaseURL: "";
    readonly builtinVlModel: "gpt-4o-mini";
    readonly wasmOcrEnabled: true;
    readonly ocrLanguage: "mix";
    readonly sessionConcurrency: 1;
    readonly taskTimeoutMs: 30000;
    readonly maxQueueLength: 32;
    readonly confidenceAlertThreshold: 0.6;
    readonly degradeNotifyAgent: true;
    readonly retentionPreset: "24h";
    readonly tempRetentionMs: 86400000;
    readonly cleanupIntervalMs: 1800000;
    readonly autoCleanupEnabled: true;
    readonly autoSaveArtifacts: true;
    readonly tileEdgePx: 768;
    readonly preprocessMaxEdgePx: 1280;
    readonly preprocessQuality: 82;
    readonly persistSessionState: true;
    readonly auditSeparate: true;
    readonly auditMaxEntries: 500;
    readonly panelAllowedHosts: string[];
};
export interface VlBackendRow {
    id: string;
    label: string;
    baseURL: string;
    keyRef: string;
    model: string;
    maxImageEdgePx: number;
    enabled: boolean;
}
export type FieldValue = string | number | boolean | VlBackendRow[] | string[];
export type ConfigDraft = Record<string, FieldValue>;
/** 从 scope 的 value 构造完整草稿（缺字段补默认值）。 */
export declare function draftFrom(value: Record<string, unknown> | undefined): ConfigDraft;
export declare function newBackendRow(existing: VlBackendRow[]): VlBackendRow;
export interface ValidationResult {
    /** 字段 key -> 错误信息（无错误则空）。 */
    errors: Record<string, string>;
    valid: boolean;
}
/**
 * 实时校验：非法输入立即在对应控件下方标红，且阻止写回 scope。
 * 规则与 Host 侧 resolveConfig 的钳制区间保持一致。
 */
export declare function validate(draft: ConfigDraft): ValidationResult;
/** 计算需要写回的字段差异（只写真正改过的字段，减少写放大）。 */
export declare function diffFields(draft: ConfigDraft, served: Record<string, unknown> | undefined): Array<[string, FieldValue]>;
/** 导出：生成脱敏 JSON 文本（配置里本就只有 keyRef，额外抹掉疑似密钥字段）。 */
export declare function exportConfigText(draft: ConfigDraft): string;
/** 导入：解析并校验 JSON，返回归一化草稿；失败给出可读错误。 */
export declare function parseImport(text: string): {
    ok: boolean;
    draft?: ConfigDraft;
    error?: string;
    notice?: string;
};
/** 枚举选项（value/label），贴合面板文案。 */
export declare const OPTIONS: {
    readonly runMode: readonly [{
        readonly value: "auto";
        readonly label: "自动自适应（推荐）";
    }, {
        readonly value: "local-only";
        readonly label: "仅本地CV引擎模式";
    }, {
        readonly value: "remote-only";
        readonly label: "仅远端VL路由模式";
    }];
    readonly loadingStrategy: readonly [{
        readonly value: "progressive";
        readonly label: "渐进按需激活（默认）";
    }, {
        readonly value: "eager";
        readonly label: "会话启动全量注册工具";
    }];
    readonly ocrLanguage: readonly [{
        readonly value: "zh";
        readonly label: "中文";
    }, {
        readonly value: "en";
        readonly label: "英文";
    }, {
        readonly value: "mix";
        readonly label: "中英混合";
    }];
    readonly retentionPreset: readonly [{
        readonly value: "1h";
        readonly label: "1 小时";
    }, {
        readonly value: "6h";
        readonly label: "6 小时";
    }, {
        readonly value: "24h";
        readonly label: "24 小时";
    }, {
        readonly value: "72h";
        readonly label: "3 天";
    }, {
        readonly value: "7d";
        readonly label: "7 天";
    }, {
        readonly value: "never";
        readonly label: "永不清理";
    }];
};
/** 保留档位 → 毫秒。 */
export declare const RETENTION_MS: Record<string, number>;
