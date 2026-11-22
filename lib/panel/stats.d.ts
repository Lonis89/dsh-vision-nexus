/**
 * dsh-vision-nexus — 面板实时统计聚合
 *
 * 轻量、进程内的调用计数器：按「今日」聚合 vision_* 工具调用次数、
 * 降级次数、置信度均值、队列/运行任务数。供设置面板「当前运行状态」展示。
 * 不落盘、不含任何敏感信息；跨会话计数只汇总数量，不记录内容。
 */
import type { AuditRecord } from '../types.js';
export interface StatsSnapshot {
    todayCalls: number;
    todayDegrades: number;
    avgConfidence: number;
    sumConfidence: number;
    confidenceSamples: number;
    queuedTasks: number;
    runningTasks: number;
}
export declare class PanelStats {
    private dayKey;
    private todayCalls;
    private todayDegrades;
    private sumConfidence;
    private confidenceSamples;
    private queuedTasks;
    private runningTasks;
    /** 记录一次工具审计结果（由 AuditLog 提交后调用）。 */
    record(rec: AuditRecord): void;
    /** 由 SessionManager 的并发状态驱动。 */
    setLoad(queued: number, running: number): void;
    snapshot(): StatsSnapshot;
    private rollDay;
}
