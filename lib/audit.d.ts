import type { AuditRecord, DegradeHop, EngineSource, VisionConfig } from './types.js';
/** 把工具入参转成脱敏摘要：保留结构，剥离敏感 / 大体积内容。 */
export declare function digestArgs(args: Record<string, unknown>): Record<string, unknown>;
/** 错误脱敏：去掉 URL、密钥片段、堆栈路径，只留可判因的摘要。 */
export declare function redactError(err: unknown): string;
export declare function newAuditId(): string;
/** 审计记录构造器（配合调度层的计时）。 */
export interface AuditDraft {
    auditId: string;
    toolName: string;
    argsDigest: Record<string, unknown>;
    sessionKey: string;
    startedAt: number;
    degradeChain: DegradeHop[];
}
export declare function beginAudit(toolName: string, args: Record<string, unknown>, sessionKey: string): AuditDraft;
/** 记录一次降级跳。 */
export declare function noteDegrade(draft: AuditDraft, from: EngineSource, to: EngineSource, reason: string): void;
/** 审计日志管理器：按会话隔离、单独落盘、可单独导出。 */
export declare class AuditLog {
    private readonly baseDir;
    /** 配置 getter：审计条数上限等面板字段热更新后即时生效。 */
    private readonly getConfig;
    /** 内存索引：sessionKey -> 最近 N 条（供快速导出）。 */
    private index;
    /** 提交观察者（供设置面板实时统计订阅，不改写入口语义）。 */
    private listeners;
    constructor(baseDir: string, config: VisionConfig | (() => VisionConfig));
    private get config();
    /** 订阅每次审计提交；返回取消订阅函数。 */
    onCommit(listener: (rec: AuditRecord) => void): () => void;
    /** 完成并落盘一条审计记录。 */
    commit(draft: AuditDraft, result: {
        engine: EngineSource;
        confidence: number;
        artifactIds: string[];
        status: AuditRecord['status'];
        errorDigest?: string;
    }): Promise<AuditRecord>;
    /** 正在轮转中的文件集合：去重，避免多条审计并发提交时同一文件重复轮转。 */
    private rotating;
    /** 每个 JSONL 文件自上次轮转后追加的行数（精确触发，避免字节阈值误判行数）。 */
    private fileLineCounts;
    /**
     * 单文件 JSONL 轮转：自上次轮转写入行数达到 2×上限，或文件字节超过
     * 「上限 × 4KB」（跨实例重启后内存计数丢失的兜底）时，保留最近 auditMaxEntries
     * 行。用临时文件 + rename 原子替换，任何异常都吞掉（审计落盘不得影响主流程）。
     */
    private rotateIfNeeded;
    /** 单独输出审计信息（供命令 / 健康自检调用，不污染主回答）。 */
    export(sessionKey: string): AuditRecord[];
}
